import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { DEFAULT_NOTIFICATION_PREFERENCES as defaults } from "../lib/domain/notifications.ts";
import { eventNotificationStatements, isQuietTime, reminderCandidates, queueNotificationStatement } from "../lib/server/notification-db.ts";
import { flushNotificationDeliveries, materializeUserReminders } from "../lib/server/notification-engine.ts";

const migrations = await Promise.all(["0000_tan_randall_flagg", "0001_amazing_jetstream", "0002_small_gabe_jones"].map((name) => readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8")));
const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", vapid.publicKey)).toString("base64url");
const now = new Date("2026-11-05T00:40:00.000Z"); // 09:40 Asia/Seoul.
const event = (patch = {}) => ({ id: "event-1", revision: 1, title: "함께 산책", startDate: "2026-11-05", endDate: "2026-11-05", startTime: "10:00", endTime: "11:00", allDay: false, ownerScope: "both", category: "date", location: "", note: "", repeat: "none", repeatUntil: null, ...patch });

function fixture(context) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migration of migrations) sqlite.exec(migration);
  context.after(() => sqlite.close());
  const adapter = {
    prepare(sql) {
      let bindings = [];
      return {
        sql, get bindings() { return bindings; },
        bind(...values) { bindings = values; return this; },
        async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
        async run() { const result = sqlite.prepare(sql).run(...bindings); return { success: true, meta: { changes: result.changes }, results: [] }; },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => ({ success: true, meta: { changes: sqlite.prepare(statement.sql).run(...statement.bindings).changes }, results: [] }));
        sqlite.exec("COMMIT");
        this.afterBatch?.(statements);
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  sqlite.prepare("INSERT INTO households VALUES ('household-1', '우리', '나', '너', NULL, 1, ?)").run(now.toISOString());
  sqlite.prepare("INSERT INTO households VALUES ('household-other', '다른 집', '다른 나', '다른 너', NULL, 1, ?)").run(now.toISOString());
  for (const [id, household, slot] of [["a", "household-1", "a"], ["b", "household-1", "b"], ["c", "household-other", "a"]]) {
    sqlite.prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?)").run(id, household, slot, `${id}@example.invalid`, now.toISOString());
  }
  sqlite.prepare("INSERT INTO events (id,household_id,title,start_date,end_date,start_time,end_time,all_day,owner_scope,category,location,note,repeat_rule,repeat_until,revision,created_by,updated_at) VALUES ('event-1','household-1','함께 산책','2026-11-05','2026-11-05','10:00','11:00',0,'both','date','','','none',NULL,1,'a',?)").run(now.toISOString());
  sqlite.prepare("INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth,created_at,updated_at) VALUES ('sub-b','b','https://fcm.googleapis.com/fcm/send/synthetic','synthetic-key','synthetic-auth',?,?)").run(now.toISOString(), now.toISOString());
  const environment = { DB: adapter, SAI_WEB_PUSH_PUBLIC_KEY: publicKey, SAI_WEB_PUSH_PRIVATE_JWK: JSON.stringify(privateJwk), SAI_WEB_PUSH_SUBJECT: "mailto:test@example.invalid" };
  return { sqlite, adapter, environment, async partnerNotice(kind = "event_created", time = now) {
    await adapter.batch(eventNotificationStatements(adapter, { kind, eventId: "event-1", householdId: "household-1", actorId: "a", actorSlot: "a", guardRevision: 1, sourceRevision: 1, eventTitle: "함께 산책", occurrenceDate: "2026-11-05", now: time.toISOString() }));
  } };
}

test("reminders use canonical own/both scope and can explicitly include the partner", () => {
  const events = [event({ id: "own", ownerScope: "b" }), event({ id: "both" }), event({ id: "partner", ownerScope: "a" })];
  assert.deepEqual(reminderCandidates(events, "b", defaults, now).map((entry) => entry.occurrence.id), ["both", "own"]);
  assert.equal(reminderCandidates(events, "b", { ...defaults, includePartner: true }, now).length, 3);
  assert.equal(reminderCandidates(events, "b", { ...defaults, reminders: false }, now).length, 0);
});

test("new near-future events inside the configured lead time get an immediate reminder without old backlog", () => {
  const enabled = now.toISOString();
  assert.equal(reminderCandidates([event({ startTime: "09:50" })], "b", defaults, now, enabled).length, 1);
  assert.equal(reminderCandidates([event({ startTime: "09:00", endTime: "09:30" })], "b", defaults, now, enabled).length, 0);
});

test("all-day reminders occur at 09:00 KST without a 30-minute subtraction", () => {
  const allDay = event({ allDay: true, startTime: null, endTime: null });
  assert.equal(reminderCandidates([allDay], "b", defaults, new Date("2026-11-04T23:59:00Z")).length, 0);
  const [candidate] = reminderCandidates([allDay], "b", defaults, new Date("2026-11-05T00:00:00Z"));
  assert.equal(candidate.dueAt, "2026-11-05T00:00:00.000Z");
  assert.equal(candidate.expiresAt, "2026-11-05T15:00:00.000Z");
});

test("reminder recurrence preserves weekly dates, absent month days and leap years", () => {
  const weekly = reminderCandidates([event({ startDate: "2026-10-29", endDate: "2026-10-29", repeat: "weekly" })], "b", defaults, now);
  assert.equal(weekly[0].occurrence.startDate, "2026-11-05");
  assert.equal(reminderCandidates([event({ startDate: "2026-10-31", endDate: "2026-10-31", repeat: "monthly" })], "b", defaults, new Date("2026-11-30T00:40:00Z")).length, 0);
  assert.equal(reminderCandidates([event({ startDate: "2024-02-29", endDate: "2024-02-29", repeat: "yearly" })], "b", defaults, new Date("2028-02-29T00:40:00Z")).length, 1);
});

test("overnight and daytime quiet boundaries use Seoul time and exclusive end", () => {
  const overnight = { ...defaults, quietEnabled: true };
  for (const [time, quiet] of [["12:59", false], ["13:00", true], ["22:59", true], ["23:00", false]]) assert.equal(isQuietTime(overnight, new Date(`2026-11-05T${time}:00Z`)), quiet);
  const daytime = { ...overnight, quietStart: "12:00", quietEnd: "13:00" };
  for (const [time, quiet] of [["02:59", false], ["03:00", true], ["03:59", true], ["04:00", false]]) assert.equal(isQuietTime(daytime, new Date(`2026-11-05T${time}:00Z`)), quiet);
});

test("partner change SQL never notifies self/another household and retry deduplicates inbox and outbox", async (context) => {
  const f = fixture(context);
  await f.partnerNotice(); await f.partnerNotice();
  assert.deepEqual(f.sqlite.prepare("SELECT recipient_id FROM notifications").all().map((row) => row.recipient_id), ["b"]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").get().n, 1);
});

test("partner change SQL respects disabled preferences and cannot impersonate an existing event creator", async (context) => {
  const f = fixture(context);
  f.sqlite.prepare("INSERT INTO notification_preferences (user_id,partner_changes,enabled_at,updated_at) VALUES ('b',0,?,?)").run(now.toISOString(), now.toISOString());
  await f.partnerNotice();
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 0);
  f.sqlite.prepare("UPDATE notification_preferences SET partner_changes=1 WHERE user_id='b'").run();
  await f.adapter.batch(eventNotificationStatements(f.adapter, { kind: "event_created", eventId: "event-1", householdId: "household-1", actorId: "b", actorSlot: "b", guardRevision: 1, sourceRevision: 1, eventTitle: "조작된 제목", occurrenceDate: "2026-11-05", now: now.toISOString() }));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 0);
});

test("notification SQL rolls back with a failed calendar mutation", async (context) => {
  const f = fixture(context);
  const statements = eventNotificationStatements(f.adapter, { kind: "event_updated", eventId: "event-1", householdId: "household-1", actorId: "a", actorSlot: "a", guardRevision: 1, sourceRevision: 2, eventTitle: "변경", occurrenceDate: "2026-11-05", now: now.toISOString() });
  await assert.rejects(() => f.adapter.batch([...statements, f.adapter.prepare("INSERT INTO nonexistent_table VALUES (1)")]));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").get().n, 0);
});

test("concurrent outbox drains claim one delivery and send exactly once", async (context) => {
  const f = fixture(context); await f.partnerNotice(); let sends = 0;
  const sender = async () => { sends++; await Promise.resolve(); return { ok: true, gone: false, retryable: false }; };
  await Promise.all([flushNotificationDeliveries(f.environment, now, 12, sender), flushNotificationDeliveries(f.environment, now, 12, sender)]);
  assert.equal(sends, 1);
  assert.equal(f.sqlite.prepare("SELECT status FROM notification_deliveries").get().status, "sent");
});

test("outbox rechecks an endpoint reassigned after its lease was claimed", async (context) => {
  const f = fixture(context); await f.partnerNotice(); let sends = 0;
  f.adapter.afterBatch = (statements) => { if (statements.some((statement) => statement.sql.includes("status = 'sending'"))) f.sqlite.prepare("UPDATE push_subscriptions SET user_id='c' WHERE id='sub-b'").run(); };
  await flushNotificationDeliveries(f.environment, now, 12, async () => { sends++; return { ok: true, gone: false, retryable: false }; });
  assert.equal(sends, 0);
  assert.equal(f.sqlite.prepare("SELECT status FROM notification_deliveries").get().status, "cancelled");
});

test("quiet hours suppress push permanently while keeping the unread inbox item", async (context) => {
  const f = fixture(context); const quietNow = new Date("2026-11-05T14:00:00Z");
  await f.partnerNotice("event_created", quietNow);
  f.sqlite.prepare("INSERT INTO notification_preferences (user_id,quiet_enabled,enabled_at,updated_at) VALUES ('b',1,?,?)").run(now.toISOString(), now.toISOString());
  let sends = 0; const sender = async () => { sends++; return { ok: true, gone: false, retryable: false }; };
  await flushNotificationDeliveries(f.environment, quietNow, 12, sender);
  const notice = f.sqlite.prepare("SELECT id,read_at FROM notifications").get();
  assert.equal(notice.read_at, null);
  assert.equal(f.sqlite.prepare("SELECT status FROM notification_deliveries").get().status, "suppressed");
  await f.adapter.batch([queueNotificationStatement(f.adapter, { id: notice.id }, "2026-11-05T23:00:00.000Z")]);
  await flushNotificationDeliveries(f.environment, new Date("2026-11-05T23:00:00Z"), 12, sender);
  assert.equal(sends, 0);
});

test("title-only reminder edits refresh one existing notice and deliver current content", async (context) => {
  const f = fixture(context); await materializeUserReminders(f.adapter, { user_id: "b", household_id: "household-1", slot: "b" }, now);
  f.sqlite.prepare("UPDATE notification_preferences SET preview=1 WHERE user_id='b'").run();
  f.sqlite.prepare("UPDATE events SET title='새 제목',revision=2 WHERE id='event-1'").run();
  let payload;
  await flushNotificationDeliveries(f.environment, now, 12, async (_subscription, value) => { payload = value; return { ok: true, gone: false, retryable: false }; });
  assert.match(payload.body, /새 제목/);
  assert.equal(payload.ttlSeconds, 1200);
  assert.match(payload.url, /event=event-1/);
  assert.match(payload.url, /date=2026-11-05/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT source_revision FROM notifications").get().source_revision, 2);
});

test("deleted, rescheduled, or no-longer-owned reminders are cancelled before provider send", async (context) => {
  for (const sql of ["DELETE FROM events WHERE id='event-1'", "UPDATE events SET start_time='11:00',end_time='12:00',revision=2 WHERE id='event-1'", "UPDATE events SET owner_scope='a',revision=2 WHERE id='event-1'"]) {
    const f = fixture(context); await materializeUserReminders(f.adapter, { user_id: "b", household_id: "household-1", slot: "b" }, now); f.sqlite.exec(sql); let sends = 0;
    await flushNotificationDeliveries(f.environment, now, 12, async () => { sends++; return { ok: true, gone: false, retryable: false }; });
    assert.equal(sends, 0); assert.equal(f.sqlite.prepare("SELECT status FROM notification_deliveries").get().status, "cancelled");
  }
});

test("retry backoff prevents immediate resend and expired subscriptions are removed", async (context) => {
  const f = fixture(context); await f.partnerNotice(); let sends = 0;
  await flushNotificationDeliveries(f.environment, now, 12, async () => { sends++; return { ok: false, gone: false, retryable: true }; });
  await flushNotificationDeliveries(f.environment, now, 12, async () => { sends++; return { ok: true, gone: false, retryable: false }; });
  assert.equal(sends, 1);
  assert.equal(f.sqlite.prepare("SELECT attempts FROM notification_deliveries").get().attempts, 1);
  await flushNotificationDeliveries(f.environment, new Date(now.getTime() + 61_000), 12, async () => ({ ok: false, gone: true, retryable: false }));
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notification_deliveries").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications").get().n, 1);
});

test("expired send leases recover without letting the prior lease finalize the new attempt", async (context) => {
  const f = fixture(context); await f.partnerNotice();
  const oldToken = randomUUID();
  f.sqlite.prepare("UPDATE notification_deliveries SET status='sending',lease_until=?,lease_token=?").run(new Date(now.getTime() - 1).toISOString(), oldToken);
  const result = await flushNotificationDeliveries(f.environment, now, 12, async () => ({ ok: true, gone: false, retryable: false }));
  assert.equal(result.sent, 1);
  assert.equal(f.sqlite.prepare("UPDATE notification_deliveries SET status='failed' WHERE lease_token=?").run(oldToken).changes, 0);
});
