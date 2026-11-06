import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve, relative, isAbsolute, sep } from "node:path";

// Local Auth Emulator + DEV Worker only. No production user or feedback data.
const base = new URL(process.argv[2] || "http://127.0.0.1:5173");
const emulator = new URL(process.argv[3] || "http://127.0.0.1:9099");
for (const url of [base, emulator]) assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/" && !url.search && !url.username && !url.password, "Use plain loopback origins only.");
const dbPath = resolve(process.argv[4] || "");
const inside = relative(resolve(".wrangler/state"), dbPath);
assert.ok(inside && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) && dbPath.endsWith(".sqlite") && !dbPath.endsWith("metadata.sqlite"), "Pass this app's local SQLite database.");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
const actors = [], ids = [], checks = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };

async function call(path, actor, method = "GET", value, headers = {}) {
  const response = await fetch(new URL(path, base), { method, headers: { ...(actor?.cookie ? { Cookie: actor.cookie } : {}), ...(method !== "GET" ? { Origin: base.origin, "Content-Type": "application/json" } : {}), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), redirect: "error", signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { assert.equal(response.status, 403, "Only the framework origin boundary may return non-JSON."); parsed = { error: { code: "ORIGIN_DENIED" } }; }
  return { status: response.status, value: parsed, headers: response.headers };
}
async function auth(route, value, admin = false) {
  const response = await fetch(`${emulator.origin}/identitytoolkit.googleapis.com/v1/${route}?key=fake-api-key`, { method: "POST", headers: { "Content-Type": "application/json", ...(admin ? { Authorization: "Bearer owner" } : {}) }, body: JSON.stringify(value), signal: AbortSignal.timeout(10_000) });
  const result = await response.json();
  assert.equal(response.status, 200, `Local Auth fixture ${route} failed.`);
  return result;
}
async function actor(email) {
  const password = `Local-Sai!${randomUUID()}`;
  const created = await auth("accounts:signUp", { email, password, returnSecureToken: true });
  const user = { email, uid: created.localId }; actors.push(user);
  await auth("accounts:update", { localId: user.uid, emailVerified: true, displayName: "피드백 검증" }, true);
  const signedIn = await auth("accounts:signInWithPassword", { email, password, returnSecureToken: true });
  const session = await call("/api/auth/session", null, "POST", { idToken: signedIn.idToken });
  assert.equal(session.status, 200);
  user.cookie = session.headers.get("set-cookie").split(";")[0]; user.appId = session.value.user.id;
  return user;
}

try {
  const config = await call("/api/auth/config");
  assert.equal(config.value.firebase.projectId, "demo-sai-calendar");
  assert.equal(config.value.firebase.apiKey, "fake-api-key");
  const user = await actor(`sai-feedback-${randomUUID()}@example.invalid`);
  const admin = await actor("sai-feedback-admin-qa@example.invalid");
  const id = randomUUID(); ids.push(id);
  const input = { id, category: "idea", message: "함께 쓰는 캘린더에 바라는 기능을 남기는 합성 피드백입니다.", page: "/app", reporterEmail: admin.email, reporterId: admin.appId, status: "done", internalNote: "클라이언트가 보낸 권한·메모는 무시돼야 합니다." };
  assert.equal((await call("/api/feedback")).status, 401);
  assert.equal((await call("/api/feedback", null, "POST", input)).status, 401);
  assert.equal((await call(`/api/feedback/${id}`)).status, 401);
  assert.equal((await call(`/api/feedback/${id}`, null, "PATCH", {})).status, 401);
  assert.equal((await call("/api/feedback", user)).status, 403);
  assert.equal((await call(`/api/feedback/${id}`, user)).status, 403);
  passed("anonymous access and ordinary-user backlog reads are denied");

  const created = await call("/api/feedback", user, "POST", input);
  assert.equal(created.status, 201);
  assert.equal(created.value.id, id);
  const retried = await call("/api/feedback", user, "POST", input);
  assert.equal(retried.status, 200);
  assert.equal(retried.value.id, id);
  assert.equal(db.prepare("SELECT count(*) AS n FROM feedback WHERE id=?").get(id).n, 1);
  passed("a user without a calendar can submit durable feedback and retry without duplication");

  assert.equal((await call("/api/feedback", user, "POST", { ...input, message: "변경된 내용으로 같은 번호를 다시 전송하는 검증입니다." })).status, 409);
  assert.equal((await call("/api/feedback", admin, "POST", input)).status, 409);
  passed("a submission ID cannot replace content or another reporter's feedback");

  assert.equal((await call("/api/feedback", user, "POST", { ...input, id: randomUUID(), category: "invalid" })).status, 422);
  assert.equal((await call("/api/feedback", user, "POST", { ...input, id: randomUUID(), page: "/app?join=private-code" })).status, 422);
  assert.equal((await call("/api/feedback", user, "POST", { ...input, id: randomUUID(), message: "짧음" })).status, 422);
  assert.equal((await call("/api/feedback", user, "POST", { ...input, id: randomUUID() }, { Origin: "https://untrusted.invalid" })).status, 403);
  passed("invalid categories, short messages and query-bearing page paths are rejected");

  const list = await call("/api/feedback", admin);
  assert.equal(list.status, 200, "Set local SAI_FEEDBACK_ADMIN_EMAILS to sai-feedback-admin-qa@example.invalid.");
  const item = list.value.items.find(item => item.id === id);
  assert.ok(item); assert.equal(item.reporterEmail, user.email); assert.equal(item.status, "new");
  assert.equal(item.internalNote, ""); assert.equal(list.value.items.filter(item => item.id === id).length, 1);
  passed("only the configured admin can read reporter details and new backlog items");

  const change = { revision: item.revision, status: "done", priority: "high", internalNote: "내부 검토 완료 · 합성 검증 메모" };
  assert.equal((await call(`/api/feedback/${id}`, user, "PATCH", change)).status, 403);
  assert.equal((await call(`/api/feedback/${id}`, admin, "PATCH", change)).status, 200);
  assert.equal((await call(`/api/feedback/${id}`, admin, "PATCH", change)).status, 409);
  const done = await call("/api/feedback?status=done&priority=high&q=" + encodeURIComponent(user.email), admin);
  assert.equal(done.status, 200); assert.equal(done.value.items.length, 1);
  assert.equal(done.value.items[0].internalNote, change.internalNote);
  assert.equal(done.value.items[0].revision, item.revision + 1);
  passed("admin state, priority and private notes persist with stale-edit protection and filtering");

  const deniedPage = await fetch(new URL("/backlog", base), { headers: { Cookie: user.cookie }, signal: AbortSignal.timeout(15_000) });
  const deniedHtml = await deniedPage.text();
  assert.equal(deniedPage.status, 200); assert.ok(deniedHtml.includes("운영자 전용 공간")); assert.ok(!deniedHtml.includes(input.message));
  const adminPage = await fetch(new URL("/backlog", base), { headers: { Cookie: admin.cookie }, signal: AbortSignal.timeout(15_000) });
  assert.equal(adminPage.status, 200); assert.ok((await adminPage.text()).includes("함께 만드는 사이"));
  assert.equal((await call(`/api/feedback/${id}`, admin, "PATCH", { ...change, revision: item.revision + 1 }, { "X-Sai-Expected-User": user.appId })).status, 409);
  passed("the admin page and account-switch guard do not expose or mutate feedback for another account");

  console.log(`Feedback integration: ${checks.length} checks passed.`);
} finally {
  for (const id of ids) db.prepare("DELETE FROM feedback WHERE id=?").run(id);
  for (const user of actors) { if (user.appId) db.prepare("DELETE FROM auth_identities WHERE provider=? AND subject=?").run("firebase:demo-sai-calendar", user.uid); try { await auth("projects/demo-sai-calendar/accounts:delete", { localId: user.uid }, true); } catch { /* Stopping the local emulator also discards its accounts. */ } }
  db.close();
}
