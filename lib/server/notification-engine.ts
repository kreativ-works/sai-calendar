import { CalendarError, expandEvents, type MemberSlot, type StoredEvent } from "../domain/calendar.ts";
import type { NotificationItem, NotificationPreferences, PushPayload, WebPushSubscription } from "../domain/notifications.ts";
import { getPublicPushConfig, isAllowedPushEndpoint, sendWebPush } from "./web-push.ts";
import { isQuietTime, kstDate, preferencesFromRow, queueNotificationStatement, reminderCandidates, type PreferenceRow } from "./notification-db.ts";

export type Member = { user_id: string; household_id: string; slot: MemberSlot };
type EventRow = { id: string; household_id: string; title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null; all_day: number; owner_scope: StoredEvent["ownerScope"]; category: StoredEvent["category"]; location: string; note: string; repeat_rule: StoredEvent["repeat"]; repeat_until: string | null; revision: number };
export type NoticeRow = { id: string; household_id: string; recipient_id: string; kind: NotificationItem["kind"]; title: string; body: string; event_id: string | null; occurrence_date: string | null; reminder_start_at: string | null; reminder_all_day: number; source_revision: number | null; created_at: string; read_at: string | null };
export type SubscriptionRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; expiration_time: number | null };
type DeliveryRow = NoticeRow & { delivery_id: string; subscription_id: string; subscription_user: string; endpoint: string; p256dh: string; auth: string; expiration_time: number | null; attempts: number };
const DAY = 86_400_000;

export function notificationDatabase(environment: object): D1Database {
  const db = (environment as { DB?: D1Database }).DB;
  if (!db) throw new CalendarError(503, "DATABASE_UNAVAILABLE", "알림 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return db;
}
function stored(row: EventRow): StoredEvent {
  return { id: row.id, title: row.title, startDate: row.start_date, endDate: row.end_date, startTime: row.start_time, endTime: row.end_time, allDay: !!row.all_day, ownerScope: row.owner_scope, category: row.category, location: row.location, note: row.note, repeat: row.repeat_rule, repeatUntil: row.repeat_until, revision: row.revision };
}
export async function ensurePreferences(db: D1Database, userId: string, now: string): Promise<PreferenceRow> {
  await db.prepare("INSERT INTO notification_preferences (user_id, enabled_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING").bind(userId, now, now).run();
  return (await db.prepare("SELECT * FROM notification_preferences WHERE user_id = ?").bind(userId).first<PreferenceRow>())!;
}
export function subscription(row: SubscriptionRow | DeliveryRow): WebPushSubscription {
  return { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth }, expirationTime: row.expiration_time };
}
export function item(row: NoticeRow): NotificationItem {
  return { id: row.id, kind: row.kind, title: row.title, body: row.body, eventId: row.event_id, occurrenceDate: row.occurrence_date, createdAt: row.created_at, readAt: row.read_at };
}

export async function materializeUserReminders(db: D1Database, member: Member, now: Date): Promise<number> {
  const prefRow = await ensurePreferences(db, member.user_id, now.toISOString());
  const prefs = preferencesFromRow(prefRow);
  if (!prefs.reminders) return 0;
  const from = kstDate(new Date(now.getTime() - DAY)), to = kstDate(new Date(now.getTime() + DAY));
  const result = await db.prepare("SELECT * FROM events WHERE household_id = ? AND start_date <= ? AND (repeat_rule != 'none' OR end_date >= ?) ORDER BY start_date LIMIT 2001").bind(member.household_id, to, from).all<EventRow>();
  if (result.results.length > 2000) return 0;
  const candidates = reminderCandidates(result.results.map(stored), member.slot, prefs, now, prefRow.enabled_at).slice(0, 100);
  if (!candidates.length) return 0;
  const statements: D1PreparedStatement[] = [];
  for (const candidate of candidates) {
    const event = candidate.occurrence;
    const body = `${event.startDate} ${event.allDay ? "종일" : event.startTime} · ${event.title}`;
    statements.push(db.prepare("INSERT INTO notifications (id, household_id, recipient_id, kind, title, body, event_id, occurrence_date, reminder_start_at, reminder_all_day, source_revision, dedupe_key, created_at) SELECT ?, ?, ?, 'reminder', ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND household_id = ? AND revision = ?) AND EXISTS (SELECT 1 FROM members WHERE user_id = ? AND household_id = ?) AND EXISTS (SELECT 1 FROM notification_preferences WHERE user_id = ? AND revision = ? AND reminders = 1) ON CONFLICT(recipient_id, dedupe_key) DO UPDATE SET title = excluded.title, body = excluded.body, source_revision = excluded.source_revision, reminder_start_at = excluded.reminder_start_at WHERE notifications.read_at IS NULL").bind(crypto.randomUUID(), member.household_id, member.user_id, "일정이 곧 시작돼요", body, event.id, event.startDate, candidate.startAt, +event.allDay, event.revision, candidate.dedupeKey, now.toISOString(), event.id, member.household_id, event.revision, member.user_id, member.household_id, member.user_id, prefRow.revision));
    if (Date.parse(candidate.expiresAt) > now.getTime()) statements.push(queueNotificationStatement(db, { recipientId: member.user_id, dedupeKey: candidate.dedupeKey }, now.toISOString()));
  }
  const results = await db.batch(statements);
  return results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
}

async function validateReminder(db: D1Database, row: DeliveryRow, prefs: NotificationPreferences, now: Date): Promise<{ valid: boolean; payload?: { title: string; body: string; ttl: number } }> {
  if (!prefs.reminders || !row.event_id || !row.occurrence_date) return { valid: false };
  const [event, member] = await Promise.all([
    db.prepare("SELECT * FROM events WHERE id = ? AND household_id = ?").bind(row.event_id, row.household_id).first<EventRow>(),
    db.prepare("SELECT user_id, household_id, slot FROM members WHERE user_id = ? AND household_id = ?").bind(row.recipient_id, row.household_id).first<Member>(),
  ]);
  if (!event || !member || (!prefs.includePartner && event.owner_scope !== "both" && event.owner_scope !== member.slot)) return { valid: false };
  const occurrence = expandEvents([stored(event)], row.occurrence_date, row.occurrence_date).find((entry) => entry.startDate === row.occurrence_date);
  if (!occurrence) return { valid: false };
  const start = new Date(`${occurrence.startDate}T${occurrence.allDay ? prefs.allDayTime : occurrence.startTime}:00+09:00`).toISOString();
  // A title-only edit stays eligible; a date/time/ownership/repeat change cannot
  // deliver the previous schedule. Current content is refreshed before sending.
  if (start !== row.reminder_start_at || !!row.reminder_all_day !== occurrence.allDay) return { valid: false };
  const due = Date.parse(start) - (occurrence.allDay ? 0 : prefs.minutes * 60_000);
  const expires = occurrence.allDay ? Date.parse(`${occurrence.startDate}T00:00:00+09:00`) + DAY : Date.parse(start);
  if (due > now.getTime() || expires <= now.getTime()) return { valid: false };
  const body = `${occurrence.startDate} ${occurrence.allDay ? "종일" : occurrence.startTime} · ${occurrence.title}`;
  await db.prepare("UPDATE notifications SET body = ?, source_revision = ? WHERE id = ? AND read_at IS NULL").bind(body, event.revision, row.id).run();
  return { valid: true, payload: { title: row.title, body, ttl: Math.max(1, Math.min(3600, Math.ceil((expires - now.getTime()) / 1000))) } };
}

export async function flushNotificationDeliveries(environment: object, now = new Date(), limit = 12, sender: typeof sendWebPush = sendWebPush): Promise<{ sent: number; cancelled: number; retried: number }> {
  const db = notificationDatabase(environment);
  const counts = { sent: 0, cancelled: 0, retried: 0 };
  if (!getPublicPushConfig(environment).configured) return counts;
  const candidates = await db.prepare("SELECT d.id AS delivery_id, d.subscription_id, d.attempts, n.*, s.user_id AS subscription_user, s.endpoint, s.p256dh, s.auth, s.expiration_time FROM notification_deliveries d JOIN notifications n ON n.id = d.notification_id JOIN push_subscriptions s ON s.id = d.subscription_id WHERE ((d.status = 'queued' AND d.next_attempt_at <= ?) OR (d.status = 'sending' AND d.lease_until <= ?)) ORDER BY d.next_attempt_at LIMIT ?").bind(now.toISOString(), now.toISOString(), Math.min(30, Math.max(1, limit))).all<DeliveryRow>();
  const token = crypto.randomUUID(), lease = new Date(now.getTime() + 120_000).toISOString();
  if (!candidates.results.length) return counts;
  const claims = await db.batch(candidates.results.map((row) => db.prepare("UPDATE notification_deliveries SET status = 'sending', lease_until = ?, lease_token = ?, attempts = attempts + 1 WHERE id = ? AND ((status = 'queued' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until <= ?))").bind(lease, token, row.delivery_id, now.toISOString(), now.toISOString())));
  const claimed = candidates.results.filter((_row, index) => claims[index].meta.changes);
  const complete = async (row: DeliveryRow) => {
    const setStatus = (status: string) => db.prepare("UPDATE notification_deliveries SET status = ?, lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ?").bind(status, row.delivery_id, token).run();
    const member = await db.prepare("SELECT user_id FROM members WHERE user_id = ? AND household_id = ?").bind(row.recipient_id, row.household_id).first();
    const prefs = preferencesFromRow(await db.prepare("SELECT * FROM notification_preferences WHERE user_id = ?").bind(row.recipient_id).first<PreferenceRow>());
    if (row.subscription_user !== row.recipient_id || !member || row.read_at || (row.expiration_time !== null && row.expiration_time <= now.getTime()) || Date.parse(row.created_at) < now.getTime() - DAY || !isAllowedPushEndpoint(row.endpoint)) { await setStatus("cancelled"); counts.cancelled++; return; }
    if (isQuietTime(prefs, now)) { await setStatus("suppressed"); counts.cancelled++; return; }
    let title = row.title, body = row.body, ttl = 3600;
    if (row.kind === "reminder") {
      const reminder = await validateReminder(db, row, prefs, now);
      if (!reminder.valid || !reminder.payload) { await setStatus("cancelled"); counts.cancelled++; return; }
      ({ title, body, ttl } = reminder.payload);
    } else if (!prefs.partnerChanges) { await setStatus("suppressed"); counts.cancelled++; return; }
    // The browser may have reassigned an endpoint or read the notice while a
    // previous batch was being processed. Recheck ownership/lease immediately.
    const current = await db.prepare("SELECT d.id FROM notification_deliveries d JOIN push_subscriptions s ON s.id = d.subscription_id JOIN notifications n ON n.id = d.notification_id WHERE d.id = ? AND d.lease_token = ? AND d.status = 'sending' AND s.user_id = n.recipient_id AND n.read_at IS NULL").bind(row.delivery_id, token).first();
    if (!current) { await setStatus("cancelled"); counts.cancelled++; return; }
    const target = new URL("/app", "https://app.invalid");
    target.searchParams.set("notification", row.id);
    if (row.event_id) target.searchParams.set("event", row.event_id);
    if (row.occurrence_date) target.searchParams.set("date", row.occurrence_date);
    const payload: PushPayload = { title: prefs.preview ? title : "사이", body: prefs.preview ? body : "새 일정 알림이 도착했어요. 앱에서 확인해 주세요.", tag: `sai-${row.id}`, url: `${target.pathname}${target.search}`, ttlSeconds: ttl };
    const result = await sender(subscription(row), payload, environment);
    if (result.gone) { await db.prepare("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?").bind(row.subscription_id, row.recipient_id).run(); counts.cancelled++; }
    else if (result.ok) { await db.prepare("UPDATE notification_deliveries SET status = 'sent', sent_at = ?, lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ?").bind(now.toISOString(), row.delivery_id, token).run(); counts.sent++; }
    else if (result.retryable && row.attempts < 4) {
      const next = new Date(now.getTime() + Math.min(3_600_000, 60_000 * 2 ** row.attempts)).toISOString();
      await db.prepare("UPDATE notification_deliveries SET status = 'queued', next_attempt_at = ?, lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ?").bind(next, row.delivery_id, token).run(); counts.retried++;
    } else { await setStatus("failed"); counts.cancelled++; }
  };
  for (let start = 0; start < claimed.length; start += 4) await Promise.all(claimed.slice(start, start + 4).map(complete));
  return counts;
}

async function pruneNotifications(db: D1Database, now: Date): Promise<void> {
  const before = new Date(now.getTime() - 90 * DAY).toISOString();
  await db.batch([
    db.prepare("DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at < ? ORDER BY created_at LIMIT 100)").bind(before),
    db.prepare("DELETE FROM push_subscriptions WHERE id IN (SELECT id FROM push_subscriptions WHERE expiration_time IS NOT NULL AND expiration_time <= ? LIMIT 100)").bind(now.getTime()),
  ]);
}

export async function dispatchNotifications(environment: object, now = new Date()): Promise<{ scanned: number; generated: number; sent: number; cancelled: number; retried: number; hasMore: boolean; busy?: boolean }> {
  const db = notificationDatabase(environment);
  const empty = { scanned: 0, generated: 0, sent: 0, cancelled: 0, retried: 0, hasMore: false };
  const token = crypto.randomUUID(), value = JSON.stringify({ token, until: now.getTime() + 180_000 });
  const lock = await db.prepare("INSERT INTO notification_dispatch_state (key, value) VALUES ('dispatch_lease', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(json_extract(notification_dispatch_state.value, '$.until') AS INTEGER) <= ?").bind(value, now.getTime()).run();
  if (!lock.meta.changes) return { ...empty, busy: true };
  try {
    const cursor = await db.prepare("SELECT value FROM notification_dispatch_state WHERE key = 'member_cursor'").first<{ value: string }>();
    let members = await db.prepare("SELECT user_id, household_id, slot FROM members WHERE user_id > ? ORDER BY user_id LIMIT 51").bind(cursor?.value ?? "").all<Member>();
    if (!members.results.length && cursor?.value) members = await db.prepare("SELECT user_id, household_id, slot FROM members ORDER BY user_id LIMIT 51").all<Member>();
    const batch = members.results.slice(0, 50);
    let generated = 0;
    for (const member of batch) generated += await materializeUserReminders(db, member, now);
    const memberHasMore = members.results.length > 50;
    await db.batch([
      db.prepare("INSERT INTO notification_dispatch_state (key, value) VALUES ('member_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(memberHasMore ? batch[batch.length - 1].user_id : ""),
      db.prepare("INSERT INTO notification_dispatch_state (key, value) VALUES ('last_dispatch_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(now.toISOString()),
    ]);
    const flushed = await flushNotificationDeliveries(environment, now);
    await pruneNotifications(db, now);
    const pending = await db.prepare("SELECT id FROM notification_deliveries WHERE (status = 'queued' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_until <= ?) LIMIT 1").bind(now.toISOString(), now.toISOString()).first();
    return { scanned: batch.length, generated, ...flushed, hasMore: memberHasMore || !!pending };
  } finally { await db.prepare("DELETE FROM notification_dispatch_state WHERE key = 'dispatch_lease' AND value = ?").bind(value).run(); }
}
