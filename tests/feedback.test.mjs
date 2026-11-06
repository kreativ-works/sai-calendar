import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { feedbackCursor, isAllowedFeedbackAdmin, parseFeedback, parseFeedbackId, parseFeedbackQuery, parseFeedbackUpdate } from "../lib/domain/feedback.ts";
import { changeFeedback, getFeedbackItem, listFeedback, storeFeedback } from "../lib/server/feedback-db.ts";

const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
const migrations = await Promise.all(journal.entries.map(({ tag }) => readFile(new URL(`../drizzle/${tag}.sql`, import.meta.url), "utf8")));
const now = new Date("2026-11-06T15:00:00.000Z");
const reporter = { userId: "reporter-a", displayName: "테스트 사용자", email: "test@example.invalid" };
const input = (patch = {}) => ({ id: randomUUID(), category: "bug", message: "달력을 넘길 때 선택한 날짜를 유지해 주세요.", page: "/app", ...patch });
const query = (params = {}) => parseFeedbackQuery(new URLSearchParams(params));
const errorCode = (code) => (error) => error?.code === code;

function fixture(context) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const migration of migrations) sqlite.exec(migration);
  context.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      let values = [];
      return {
        bind(...bindings) { values = bindings; return this; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async run() { return { success: true, results: [], meta: { changes: sqlite.prepare(sql).run(...values).changes } }; },
      };
    },
  };
  return { db, sqlite };
}

test("feedback parser bounds text, accepts only declared categories and keeps URL parameters out of context", () => {
  const id = randomUUID();
  assert.deepEqual(parseFeedback({ ...input({ id }), message: "  첫 번째 줄의 의견\r\n두 번째 줄입니다.  ", reporterEmail: "spoof@example.invalid", status: "done" }), {
    id, category: "bug", message: "첫 번째 줄의 의견\n두 번째 줄입니다.", page: "/app",
  });
  for (const patch of [{ message: "너무 짧음" }, { message: "가".repeat(2001) }, { message: "긴 피드백에 제어\0문자 넣기" }, { category: "admin" }, { page: "https://evil.example/app" }, { page: "/app?join=secret" }, { page: "/app#secret" }, { page: "//evil.example" }, { page: "/../private" }, { page: "/app%3Fjoin" }, { id: "not-a-uuid" }]) assert.throws(() => parseFeedback(input(patch)), errorCode("INVALID_FEEDBACK"));
  assert.equal(parseFeedback(input({ message: "가".repeat(2000) })).message.length, 2000);
  assert.equal(parseFeedbackId(id.toUpperCase()), id);
});

test("admin allowlist is explicit, exact, case-insensitive and fails closed on missing or malformed configuration", () => {
  const admin = { email: "Hello@Example.invalid" };
  assert.equal(isAllowedFeedbackAdmin(admin, " other@example.invalid, hello@example.invalid "), true);
  for (const setting of [undefined, null, "", "   ", "*", "@example.invalid", "hello@example.invalid.evil", "hello@example.invalid,not-an-email"]) assert.equal(isAllowedFeedbackAdmin(admin, setting), false);
  assert.equal(isAllowedFeedbackAdmin(null, "hello@example.invalid"), false);
  assert.equal(isAllowedFeedbackAdmin({ email: "hello+alias@example.invalid" }, "hello@example.invalid"), false);
  assert.equal(isAllowedFeedbackAdmin({ email: "attacker@example.invalid" }, "hello@example.invalid"), false);
});

test("update and list query parsers reject unsafe versions, unbounded input, duplicate filters and invalid cursors", () => {
  const valid = { revision: 1, status: "planned", priority: "high", internalNote: " 검토 메모 " };
  assert.deepEqual(parseFeedbackUpdate(valid), { ...valid, internalNote: "검토 메모" });
  for (const patch of [{ revision: 0 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER }, { status: "deleted" }, { priority: "urgent" }, { internalNote: "가".repeat(2001) }]) assert.throws(() => parseFeedbackUpdate({ ...valid, ...patch }), errorCode("INVALID_FEEDBACK"));
  for (const params of [{ status: "deleted" }, { priority: "urgent" }, { category: "anything" }, { q: "가".repeat(101) }, { cursor: "bad-cursor" }, { cursor: "A".repeat(201) }, { unknown: "value" }]) assert.throws(() => query(params), errorCode("INVALID_FEEDBACK"));
  assert.throws(() => parseFeedbackQuery(new URLSearchParams("status=new&status=done")), errorCode("INVALID_FEEDBACK"));
  const item = { id: randomUUID(), createdAt: now.toISOString() };
  assert.deepEqual(query({ cursor: feedbackCursor(item) }).cursor, item);
  const invalidDate = Buffer.from(JSON.stringify(["2026-02-30T00:00:00.000Z", item.id])).toString("base64url");
  assert.throws(() => query({ cursor: invalidDate }), errorCode("INVALID_FEEDBACK"));
});

test("feedback persists independently of household membership and derives reporter fields and title server-side", async (context) => {
  const { db, sqlite } = fixture(context), value = input({ message: "🙂 ".repeat(50).trim() });
  const result = await storeFeedback(db, reporter, value, now);
  assert.equal(result.created, true);
  assert.deepEqual(Object.keys(result.receipt).sort(), ["createdAt", "id", "ok"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM members").get().n, 0);
  const item = await getFeedbackItem(db, value.id);
  assert.equal(item.reporterName, reporter.displayName);
  assert.equal(item.reporterEmail, reporter.email);
  assert.equal(item.title, Array.from(value.message).slice(0, 80).join(""));
  assert.equal(item.revision, 1);
  assert.equal(item.status, "new");
  assert.equal(item.priority, "none");
  assert.equal(item.internalNote, "");
});

test("simultaneous feedback retries create one row and return the same limited receipt", async (context) => {
  const { db, sqlite } = fixture(context), value = input();
  const results = await Promise.all([storeFeedback(db, reporter, value, now), storeFeedback(db, reporter, value, now)]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.deepEqual(results[0].receipt, results[1].receipt);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get().n, 1);
});

test("idempotency rejects another reporter or changed payload without exposing the stored report", async (context) => {
  const { db } = fixture(context), value = input();
  await storeFeedback(db, reporter, value, now);
  await changeFeedback(db, value.id, { revision: 1, status: "planned", priority: "high", internalNote: "관리자 비공개 검토 내용" }, now);
  for (const [user, changed] of [[{ ...reporter, userId: "other-user" }, value], [reporter, { ...value, message: "바꾼 내용으로 같은 ID 재사용하기" }], [reporter, { ...value, category: "idea" }], [reporter, { ...value, page: "/login" }]]) await assert.rejects(() => storeFeedback(db, user, changed, now), (error) => {
    assert.equal(error.code, "FEEDBACK_REQUEST_CONFLICT");
    assert.equal(error.status, 409);
    assert.doesNotMatch(error.message, /관리자|example|테스트/);
    return true;
  });
  const retry = await storeFeedback(db, { ...reporter, displayName: "바뀐 이름" }, value, now);
  assert.deepEqual(Object.keys(retry.receipt).sort(), ["createdAt", "id", "ok"]);
});

test("the short quota is atomic under concurrent submissions, scoped per reporter, and permits saved retries", async (context) => {
  const { db, sqlite } = fixture(context), requests = Array.from({ length: 8 }, () => input());
  const results = await Promise.allSettled(requests.map((value) => storeFeedback(db, reporter, value, now)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
  for (const result of results.filter((result) => result.status === "rejected")) assert.equal(result.reason.code, "FEEDBACK_RATE_LIMIT");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback WHERE reporter_id = ?").get(reporter.userId).n, 5);
  assert.equal((await storeFeedback(db, reporter, requests[0], now)).created, false);
  assert.equal((await storeFeedback(db, { ...reporter, userId: "reporter-b" }, input(), now)).created, true);
  assert.equal((await storeFeedback(db, reporter, input(), new Date(now.getTime() + 600_000))).created, true);
});

test("the rolling daily quota cannot be bypassed by spreading requests and expires at the boundary", async (context) => {
  const { db } = fixture(context), saved = [];
  for (let index = 0; index < 20; index++) {
    const value = input(), time = new Date(now.getTime() - (20 - index) * 1_200_000);
    await storeFeedback(db, reporter, value, time); saved.push({ value, time });
  }
  await assert.rejects(() => storeFeedback(db, reporter, input(), now), errorCode("FEEDBACK_RATE_LIMIT"));
  assert.equal((await storeFeedback(db, reporter, saved[0].value, now)).created, false);
  assert.equal((await storeFeedback(db, reporter, input(), new Date(saved[0].time.getTime() + 86_400_000))).created, true);
});

test("backlog keyset pagination covers tied creation times once and excludes newer inserts on subsequent pages", async (context) => {
  const { db } = fixture(context), ids = [];
  for (let index = 0; index < 61; index++) { const value = input(); ids.push(value.id); await storeFeedback(db, { ...reporter, userId: `reporter-${index}` }, value, now); }
  const first = await listFeedback(db, query());
  assert.equal(first.items.length, 50);
  assert.equal(first.counts.all, 61);
  assert.ok(first.nextCursor);
  await storeFeedback(db, { ...reporter, userId: "newer-reporter" }, input(), new Date(now.getTime() + 1));
  const second = await listFeedback(db, query({ cursor: first.nextCursor }));
  assert.equal(second.items.length, 11);
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items].map((item) => item.id), ids.sort().reverse());
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 61);
});

test("search treats SQL and wildcard characters literally while counts honor search/category/priority across statuses", async (context) => {
  const { db, sqlite } = fixture(context), needle = "' OR 1=1 -- %_";
  for (const [index, patch] of [{ category: "bug", message: `특수 문자를 검색해요 ${needle}` }, { category: "bug", message: `다른 상태의 내용입니다 ${needle}` }, { category: "idea", message: "검색에 포함되면 안 되는 아이디어" }].entries()) {
    const value = input(patch); await storeFeedback(db, reporter, value, now);
    await changeFeedback(db, value.id, { revision: 1, status: index === 0 ? "new" : "done", priority: index < 2 ? "high" : "low", internalNote: "" }, now);
  }
  const backlog = await listFeedback(db, query({ q: needle, category: "bug", priority: "high", status: "new" }));
  assert.equal(backlog.items.length, 1);
  assert.equal(backlog.counts.all, 2);
  assert.equal(backlog.counts.new, 1);
  assert.equal(backlog.counts.done, 1);
  assert.equal((await listFeedback(db, query({ q: "nothing' UNION SELECT 1--" }))).items.length, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get().n, 3);
});

test("optimistic admin writes return the exact saved row and prevent lost updates and accidental creation", async (context) => {
  const { db } = fixture(context), value = input();
  await storeFeedback(db, reporter, value, now);
  const update = { revision: 1, status: "in_progress", priority: "medium", internalNote: "다음 버전에서 검토하기" };
  const results = await Promise.allSettled([changeFeedback(db, value.id, update, now), changeFeedback(db, value.id, { ...update, status: "declined" }, now)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const saved = results.find((result) => result.status === "fulfilled").value;
  assert.equal(saved.revision, 2);
  assert.equal(saved.status, "in_progress");
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "REVISION_CONFLICT");
  assert.deepEqual(await getFeedbackItem(db, value.id), saved);
  await assert.rejects(() => changeFeedback(db, randomUUID(), update, now), errorCode("FEEDBACK_NOT_FOUND"));
  await assert.rejects(() => getFeedbackItem(db, randomUUID()), errorCode("FEEDBACK_NOT_FOUND"));
});
