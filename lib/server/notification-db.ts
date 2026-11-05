import { expandEvents, type CalendarEvent, type MemberSlot, type StoredEvent } from "../domain/calendar.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationKind, type NotificationPreferences } from "../domain/notifications.ts";

export type PreferenceRow = {
  user_id: string; partner_changes: number; reminders: number; include_partner: number; minutes: number;
  all_day_time: string; quiet_enabled: number; quiet_start: string; quiet_end: string; preview: number;
  revision: number; enabled_at: string; updated_at: string;
};
export type ReminderCandidate = { occurrence: CalendarEvent; startAt: string; dueAt: string; dedupeKey: string; expiresAt: string };
const DAY = 86_400_000;
export const kstDate = (date: Date) => new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

export function preferencesFromRow(row: PreferenceRow | null): NotificationPreferences {
  return row ? { partnerChanges: !!row.partner_changes, reminders: !!row.reminders, includePartner: !!row.include_partner, minutes: row.minutes as NotificationPreferences["minutes"], allDayTime: row.all_day_time, quietEnabled: !!row.quiet_enabled, quietStart: row.quiet_start, quietEnd: row.quiet_end, preview: !!row.preview, revision: row.revision } : { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

export function isQuietTime(preferences: NotificationPreferences, now: Date): boolean {
  if (!preferences.quietEnabled) return false;
  const time = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
  return preferences.quietStart < preferences.quietEnd ? time >= preferences.quietStart && time < preferences.quietEnd : time >= preferences.quietStart || time < preferences.quietEnd;
}

export function reminderCandidates(events: StoredEvent[], slot: MemberSlot, preferences: NotificationPreferences, now: Date, enabledAt?: string): ReminderCandidate[] {
  if (!preferences.reminders) return [];
  const from = kstDate(new Date(now.getTime() - DAY));
  const to = kstDate(new Date(now.getTime() + DAY));
  const cutoff = Math.max(now.getTime() - DAY, enabledAt ? Date.parse(enabledAt) : 0);
  const result: ReminderCandidate[] = [];
  for (const occurrence of expandEvents(events, from, to)) {
    if (!preferences.includePartner && occurrence.ownerScope !== "both" && occurrence.ownerScope !== slot) continue;
    const startAt = new Date(`${occurrence.startDate}T${occurrence.allDay ? preferences.allDayTime : occurrence.startTime}:00+09:00`).toISOString();
    const dueAt = new Date(Date.parse(startAt) - (occurrence.allDay ? 0 : preferences.minutes * 60_000)).toISOString();
    // Newly created or newly enabled near-future events still need a reminder
    // when their configured lead time has already passed. Do not backfill old
    // events when notification preferences are first created or re-enabled.
    if (Date.parse(dueAt) > now.getTime() || (Date.parse(dueAt) < cutoff && Date.parse(startAt) <= now.getTime())) continue;
    const expiresAt = occurrence.allDay ? new Date(Date.parse(`${occurrence.startDate}T00:00:00+09:00`) + DAY).toISOString() : startAt;
    result.push({ occurrence, startAt, dueAt, expiresAt, dedupeKey: `reminder:${occurrence.id}:${occurrence.startDate}:${occurrence.allDay ? "all-day" : occurrence.startTime}` });
  }
  return result;
}

export function queueNotificationStatement(db: D1Database, key: { id?: string; recipientId?: string; dedupeKey?: string }, now: string): D1PreparedStatement {
  const condition = key.id ? "n.id = ?" : "n.recipient_id = ? AND n.dedupe_key = ?";
  const bindings = key.id ? [key.id] : [key.recipientId!, key.dedupeKey!];
  return db.prepare(`INSERT INTO notification_deliveries (id, notification_id, subscription_id, status, attempts, next_attempt_at, created_at) SELECT lower(hex(randomblob(16))), n.id, s.id, 'queued', 0, ?, ? FROM notifications n JOIN push_subscriptions s ON s.user_id = n.recipient_id WHERE ${condition} AND n.read_at IS NULL AND (s.expiration_time IS NULL OR s.expiration_time > ?) AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = n.recipient_id AND m.household_id = n.household_id) ON CONFLICT(notification_id, subscription_id) DO UPDATE SET status = 'queued', attempts = 0, next_attempt_at = excluded.next_attempt_at, lease_until = NULL, lease_token = NULL WHERE notification_deliveries.status = 'cancelled'`).bind(now, now, ...bindings, Date.parse(now));
}

export function eventNotificationStatements(db: D1Database, value: {
  kind: Exclude<NotificationKind, "reminder">; eventId: string; householdId: string; actorId: string;
  actorSlot: MemberSlot; guardRevision: number; sourceRevision: number; eventTitle: string;
  occurrenceDate: string; now: string;
}): D1PreparedStatement[] {
  const id = crypto.randomUUID();
  const verb = value.kind === "event_created" ? "추가" : value.kind === "event_updated" ? "수정" : "삭제";
  const dedupe = `${value.kind}:${value.eventId}:${value.sourceRevision}`;
  return [
    db.prepare(`INSERT INTO notifications (id, household_id, recipient_id, kind, title, body, event_id, occurrence_date, source_revision, dedupe_key, created_at) SELECT ?, m.household_id, m.user_id, ?, ?, (CASE WHEN ? = 'a' THEN h.a_name ELSE h.b_name END) || ' · ' || ?, ?, ?, ?, ?, ? FROM members m JOIN households h ON h.id = m.household_id LEFT JOIN notification_preferences p ON p.user_id = m.user_id WHERE m.household_id = ? AND m.user_id != ? AND COALESCE(p.partner_changes, 1) = 1 AND EXISTS (SELECT 1 FROM events e WHERE e.id = ? AND e.household_id = m.household_id AND e.revision = ? AND (? != 'event_created' OR e.created_by = ?)) ON CONFLICT(recipient_id, dedupe_key) DO NOTHING`).bind(id, value.kind, `짝꿍이 일정을 ${verb}했어요`, value.actorSlot, value.eventTitle, value.eventId, value.occurrenceDate, value.sourceRevision, dedupe, value.now, value.householdId, value.actorId, value.eventId, value.guardRevision, value.kind, value.actorId),
    queueNotificationStatement(db, { id }, value.now),
  ];
}
