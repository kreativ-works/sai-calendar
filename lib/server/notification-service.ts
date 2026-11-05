import { env } from "cloudflare:workers";
import { authBody, getAppUser } from "./app-auth";
import { CalendarError } from "../domain/calendar";
import { parseNotificationPreferences, type NotificationPreferences, type NotificationsState } from "../domain/notifications";
import { getPublicPushConfig, isAllowedPushEndpoint, parsePushSubscription, sendWebPush } from "./web-push";
import { kstDate, preferencesFromRow } from "./notification-db";
import { ensurePreferences, item, materializeUserReminders, notificationDatabase, subscription, type Member, type NoticeRow, type SubscriptionRow } from "./notification-engine";
export { dispatchNotifications, flushNotificationDeliveries } from "./notification-engine";
const database = () => notificationDatabase(env);

async function context(requireMember = false) {
  const user = await getAppUser();
  if (!user) throw new CalendarError(401, "SIGN_IN_REQUIRED", "로그인 후 알림을 확인해 주세요.");
  const db = database();
  const member = await db.prepare("SELECT user_id, household_id, slot FROM members WHERE user_id = ?").bind(user.userId).first<Member>();
  if (requireMember && !member) throw new CalendarError(403, "HOUSEHOLD_REQUIRED", "캘린더에 연결한 후 기기 알림을 설정해 주세요.");
  return { db, user, member };
}
export async function readNotifications(): Promise<NotificationsState> {
  const { db, user, member } = await context();
  const now = new Date();
  const pref = await ensurePreferences(db, user.userId, now.toISOString());
  if (member) await materializeUserReminders(db, member, now);
  const [list, unread, lastTick] = await Promise.all([
    member ? db.prepare("SELECT * FROM notifications WHERE recipient_id = ? AND household_id = ? ORDER BY created_at DESC, id DESC LIMIT 50").bind(user.userId, member.household_id).all<NoticeRow>() : Promise.resolve({ results: [] as NoticeRow[] }),
    member ? db.prepare("SELECT COUNT(*) AS total FROM notifications WHERE recipient_id = ? AND household_id = ? AND read_at IS NULL").bind(user.userId, member.household_id).first<{ total: number }>() : Promise.resolve(null),
    db.prepare("SELECT value FROM notification_dispatch_state WHERE key = 'last_dispatch_at'").first<{ value: string }>(),
  ]);
  const config = getPublicPushConfig(env);
  const tickAge = lastTick ? now.getTime() - Date.parse(lastTick.value) : Infinity;
  return { items: list.results.map(item), unreadCount: unread?.total ?? 0, preferences: preferencesFromRow(pref), push: { ...config, schedulerReady: config.schedulerReady && tickAge >= 0 && tickAge < 20 * 60_000 } };
}

export async function markNotificationsRead(request: Request): Promise<{ ok: true }> {
  const { db, user, member } = await context();
  const data = await authBody(request);
  if (!member) return { ok: true };
  const now = new Date().toISOString();
  if (data.ids !== undefined) {
    if (!Array.isArray(data.ids) || data.ids.length < 1 || data.ids.length > 100 || !data.ids.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))) throw new CalendarError(422, "INVALID_NOTIFICATION_IDS", "읽음 처리할 알림을 다시 선택해 주세요.");
    const ids = [...new Set(data.ids as string[])];
    await db.prepare(`UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE recipient_id = ? AND household_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(now, user.userId, member.household_id, ...ids).run();
  } else if (typeof data.allBefore === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.allBefore) && Number.isFinite(Date.parse(data.allBefore)) && new Date(data.allBefore).toISOString() === data.allBefore && data.allBefore <= now) {
    await db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE recipient_id = ? AND household_id = ? AND created_at <= ?").bind(now, user.userId, member.household_id, data.allBefore).run();
  } else throw new CalendarError(422, "INVALID_NOTIFICATION_READ", "읽음 처리할 알림을 다시 선택해 주세요.");
  return { ok: true };
}

export async function updateNotificationPreferences(request: Request): Promise<{ ok: true; preferences: NotificationPreferences }> {
  const { db, user } = await context();
  const value = parseNotificationPreferences(await authBody(request));
  const now = new Date().toISOString();
  const previous = await ensurePreferences(db, user.userId, now);
  const enabledAt = !previous.reminders && value.reminders ? now : previous.enabled_at;
  const result = await db.prepare("UPDATE notification_preferences SET partner_changes = ?, reminders = ?, include_partner = ?, minutes = ?, all_day_time = ?, quiet_enabled = ?, quiet_start = ?, quiet_end = ?, preview = ?, revision = revision + 1, enabled_at = ?, updated_at = ? WHERE user_id = ? AND revision = ?").bind(+value.partnerChanges, +value.reminders, +value.includePartner, value.minutes, value.allDayTime, +value.quietEnabled, value.quietStart, value.quietEnd, +value.preview, enabledAt, now, user.userId, value.revision).run();
  if (!result.meta.changes) throw new CalendarError(409, "REVISION_CONFLICT", "다른 기기에서 알림 설정이 바뀌었어요. 다시 열어 확인해 주세요.");
  return { ok: true, preferences: { ...value, revision: value.revision + 1 } };
}

export async function registerPushSubscription(request: Request): Promise<{ ok: true }> {
  const { db, user } = await context(true);
  const data = await authBody(request);
  const value = await parsePushSubscription(data.subscription);
  if (!getPublicPushConfig(env).configured) throw new CalendarError(503, "PUSH_NOT_CONFIGURED", "기기 알림을 준비하고 있어요. 잠시 후 다시 시도해 주세요.");
  const now = new Date().toISOString();
  const result = await db.prepare("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, expiration_time, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ? AND endpoint != ?) < 5 ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, expiration_time = excluded.expiration_time, updated_at = excluded.updated_at, last_test_day = CASE WHEN push_subscriptions.user_id = excluded.user_id THEN push_subscriptions.last_test_day ELSE NULL END").bind(crypto.randomUUID(), user.userId, value.endpoint, value.keys.p256dh, value.keys.auth, value.expirationTime ?? null, now, now, user.userId, value.endpoint).run();
  if (!result.meta.changes) throw new CalendarError(422, "PUSH_DEVICE_LIMIT", "알림은 최대 5개 기기에서 받을 수 있어요. 사용하지 않는 기기의 알림을 해제해 주세요.");
  return { ok: true };
}

export async function deletePushSubscription(request: Request): Promise<{ ok: true }> {
  const { db, user } = await context();
  const value = await authBody(request);
  if (!isAllowedPushEndpoint(value.endpoint)) throw new CalendarError(422, "INVALID_PUSH_SUBSCRIPTION", "이 기기의 알림 연결을 다시 확인해 주세요.");
  await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").bind(user.userId, value.endpoint).run();
  return { ok: true };
}

export async function testPushSubscription(request: Request): Promise<{ ok: true }> {
  const { db, user } = await context(true);
  const value = await authBody(request);
  if (!isAllowedPushEndpoint(value.endpoint)) throw new CalendarError(422, "INVALID_PUSH_SUBSCRIPTION", "이 기기의 알림 연결을 다시 확인해 주세요.");
  const row = await db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").bind(user.userId, value.endpoint).first<SubscriptionRow>();
  if (!row) throw new CalendarError(404, "PUSH_SUBSCRIPTION_NOT_FOUND", "먼저 이 기기의 알림을 켜 주세요.");
  if (!getPublicPushConfig(env).configured) throw new CalendarError(503, "PUSH_NOT_CONFIGURED", "기기 알림을 준비하고 있어요. 잠시 후 다시 시도해 주세요.");
  const day = kstDate(new Date());
  const claim = await db.prepare("UPDATE push_subscriptions SET last_test_day = ? WHERE id = ? AND user_id = ? AND (last_test_day IS NULL OR last_test_day != ?)").bind(day, row.id, user.userId, day).run();
  if (!claim.meta.changes) throw new CalendarError(429, "PUSH_TEST_LIMIT", "테스트 알림은 기기마다 하루 한 번 보낼 수 있어요.");
  const result = await sendWebPush(subscription(row), { title: "사이 알림이 연결됐어요", body: "이 기기에서 두 분의 일정 알림을 받을 수 있어요.", tag: `sai-test-${day}`, url: "/app", ttlSeconds: 60 }, env);
  if (result.gone) await db.prepare("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?").bind(row.id, user.userId).run();
  if (!result.ok) {
    throw new CalendarError(503, "PUSH_SEND_FAILED", "알림을 보내지 못했어요. 기기 알림 권한을 확인하고 다시 시도해 주세요.");
  }
  return { ok: true };
}

