import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve, relative, isAbsolute, sep } from "node:path";

// Local synthetic fixtures only. This script never calls a model provider.
const base = new URL(process.argv[2] || "http://127.0.0.1:5173");
const emulator = new URL(process.argv[3] || "http://127.0.0.1:9099");
for (const url of [base, emulator]) assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/" && !url.search && !url.username && !url.password, "Use loopback-only test servers.");
const dbPath = resolve(process.argv[4] || ""), inside = relative(resolve(".wrangler/state"), dbPath);
assert.ok(inside && !inside.startsWith(`..${sep}`) && !isAbsolute(inside) && dbPath.endsWith(".sqlite") && !dbPath.endsWith("metadata.sqlite"), "Pass this app's local SQLite database.");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_settings").get().n, 0, "Refusing to replace an existing local AI configuration.");
const actors = [], households = new Set(), checks = [];
let managedSettings = false;
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
const fakeApiKey = `synthetic-ai-key-${randomUUID()}`;

async function request(path, actor, options = {}) {
  const headers = new Headers(options.headers);
  if (actor?.cookie) headers.set("Cookie", actor.cookie);
  return fetch(new URL(path, base), { ...options, headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
}
async function call(path, actor, method = "GET", value, extraHeaders = {}) {
  const response = await request(path, actor, {
    method, headers: { ...(method !== "GET" ? { Origin: base.origin, "Content-Type": "application/json" } : {}), ...extraHeaders },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { assert.equal(response.status, 403, "Only the framework cross-origin boundary may return non-JSON."); data = { error: { code: "ORIGIN_DENIED" } }; }
  return { status: response.status, value: data, headers: response.headers };
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
  await auth("accounts:update", { localId: user.uid, emailVerified: true, displayName: "AI 합성 검증" }, true);
  const signed = await auth("accounts:signInWithPassword", { email, password, returnSecureToken: true });
  const session = await call("/api/auth/session", null, "POST", { idToken: signed.idToken });
  assert.equal(session.status, 200);
  user.idToken = signed.idToken; user.cookie = session.headers.get("set-cookie").split(";")[0]; user.appId = session.value.user.id;
  return user;
}
function privateResponse(response) {
  assert.match(response.headers.get("cache-control") || "", /(?:^|[,\s])no-store(?:$|[,\s])/i, "Private responses must not be cached.");
  assert.ok((response.headers.get("vary") || "").toLowerCase().split(/\s*,\s*/).includes("cookie"), "Private responses must vary by Cookie.");
}
async function page(path, actor, headers = {}) {
  const response = await request(path, actor, { headers });
  const text = await response.text();
  assert.equal(response.status, 200, `Expected SSR page ${path}.`);
  privateResponse(response);
  if (actor?.idToken) assert.ok(!text.includes(actor.idToken), "A raw Firebase bearer token must never appear in SSR/RSC.");
  assert.ok(!text.includes(fakeApiKey), "An API key must never appear in SSR/RSC.");
  return { response, text };
}
async function share(actor, text, options = {}) {
  return request("/share", actor, { method: "POST", headers: { Origin: base.origin, ...options.headers }, body: options.body ?? new URLSearchParams({ text, ...(options.title ? { title: options.title } : {}) }) });
}
function shareLocation(response) {
  assert.equal(response.status, 303);
  privateResponse(response);
  const location = new URL(response.headers.get("location"), base);
  assert.equal(location.origin, base.origin); assert.equal(location.pathname, "/assistant");
  return location;
}
function noSharedRow(actor) { return db.prepare("SELECT COUNT(*) AS n FROM assistant_handoffs WHERE user_id=?").get(actor.appId).n; }

try {
  const config = await call("/api/auth/config");
  assert.equal(config.value.firebase.projectId, "demo-sai-calendar");
  assert.equal(config.value.firebase.apiKey, "fake-api-key");
  assert.equal(config.value.emulatorUrl, emulator.origin);
  const user = await actor(`sai-assistant-${randomUUID()}@example.invalid`);
  const other = await actor(`sai-assistant-other-${randomUUID()}@example.invalid`);
  const admin = await actor("sai-feedback-admin-qa@example.invalid");
  for (const [path, method, value] of [["/api/assistant/config", "GET"], ["/api/assistant/extract", "POST", { text: "내일 저녁 약속", source: "paste" }], ["/api/admin/ai", "GET"], ["/api/admin/ai", "PUT", {}], ["/api/admin/ai", "DELETE", {}]]) assert.equal((await call(path, null, method, value)).status, 401);
  for (const [method, value] of [["GET"], ["PUT", { provider: "gemini", model: "gemini-flash-latest", apiKey: fakeApiKey }], ["DELETE", {}]]) assert.equal((await call("/api/admin/ai", user, method, value)).status, 403);
  passed("anonymous assistant access and ordinary-user AI administration are denied");

  const created = await call("/api/household", user, "POST", { name: "AI 합성 통합 검증 캘린더", aName: "검증 하나", bName: "검증 둘" });
  assert.equal(created.status, 200);
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const statePath = `/api/state?from=${today}&to=${today}`;
  const current = await call(statePath, user);
  assert.equal(current.status, 200); households.add(current.value.household.id);
  const title = `합성 일정 확인 ${randomUUID().slice(0, 8)}`;
  const event = { title, startDate: today, endDate: today, startTime: "14:00", endTime: "15:00", allDay: false, ownerScope: "both", category: "date", location: "로컬 테스트", note: "합성 테스트 메모", repeat: "none", repeatUntil: null, clientRequestId: randomUUID() };
  assert.equal((await call("/api/events", user, "POST", event)).status, 200);
  assert.deepEqual((await call("/api/assistant/config", user)).value, { configured: false, provider: null, model: null });
  const disabled = await call("/api/assistant/extract", user, "POST", { text: "내일 오후 2시 함께 산책", source: "paste" });
  assert.equal(disabled.status, 503); assert.equal(disabled.value.error.code, "AI_NOT_CONFIGURED");
  passed("a real synthetic calendar is authorized while an unconfigured provider returns an honest 503");

  assert.equal((await call("/api/assistant/extract", user, "POST", { text: "가".repeat(6000), source: "paste" })).status, 503);
  assert.equal((await call("/api/assistant/extract", user, "POST", { text: "가".repeat(6001), source: "paste" })).status, 422);
  assert.equal((await call("/api/assistant/extract", user, "POST", { text: "x".repeat(26000), source: "paste" })).status, 413);
  assert.equal((await call("/api/assistant/extract", user, "POST", { text: "내일 약속", source: "paste" }, { Origin: "https://untrusted.invalid" })).status, 403);
  passed("extract enforces same-origin requests and accepts 6000 Korean characters within its byte bound");

  const initial = await call("/api/admin/ai", admin); privateResponse(initial);
  assert.deepEqual(initial.value, { configured: false, provider: null, model: null });
  const saved = await call("/api/admin/ai", admin, "PUT", { provider: "gemini", model: "gemini-flash-latest", apiKey: fakeApiKey });
  assert.equal(saved.status, 200); managedSettings = true;
  const publicConfig = await call("/api/assistant/config", user), adminConfig = await call("/api/admin/ai", admin);
  for (const response of [saved, publicConfig, adminConfig]) { privateResponse(response); assert.deepEqual(Object.keys(response.value).sort(), ["configured", "model", "provider"]); assert.ok(!JSON.stringify(response.value).includes(fakeApiKey)); assert.equal(response.value.configured, true); }
  const encrypted = db.prepare("SELECT * FROM ai_settings WHERE id=1").get();
  assert.equal(encrypted.updated_by, admin.appId); assert.ok(!JSON.stringify(encrypted).includes(fakeApiKey)); assert.match(encrypted.ciphertext, /^v1\./);
  assert.equal((await call("/api/admin/ai", admin, "PUT", { provider: "gemini", model: "https://evil.invalid/model", apiKey: fakeApiKey })).status, 422);
  assert.equal((await call("/api/admin/ai", admin, "PUT", { provider: "openai", model: "", apiKey: fakeApiKey })).status, 422);
  assert.equal((await call("/api/admin/ai", admin, "DELETE", {}, { "X-Sai-Expected-User": user.appId })).status, 409);
  // Never extract while this synthetic API key is saved: no provider network calls are permitted.
  const settingsPage = await page("/admin/ai", admin);
  assert.ok(settingsPage.text.includes("일정 도우미 연결")); assert.ok(settingsPage.text.includes(admin.email));
  assert.equal((await call("/api/admin/ai", admin, "DELETE", {})).status, 200); managedSettings = false;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ai_settings").get().n, 0);
  assert.equal((await call("/api/assistant/config", user)).value.configured, false);
  passed("admin provider settings are encrypted, metadata-only, account-bound and removable without model calls");

  const sharedText = "내일 오후 2시에 함께 산책하자. 원문은 서버 로그와 URL에 남기지 않는 합성 내용입니다.";
  const incoming = await share(user, sharedText), location = shareLocation(incoming), id = location.searchParams.get("share");
  assert.match(id || "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual([...location.searchParams.keys()], ["share"]); assert.ok(!location.href.includes(encodeURIComponent(sharedText)));
  const handoff = db.prepare("SELECT * FROM assistant_handoffs WHERE id=?").get(id);
  assert.equal(handoff.user_id, user.appId); assert.ok(!JSON.stringify(handoff).includes(sharedText));
  assert.equal((await call(`/api/assistant/shared/${id}`, other)).status, 404);
  assert.ok(db.prepare("SELECT id FROM assistant_handoffs WHERE id=?").get(id), "Another account must not consume the owner's share.");
  const consumed = await call(`/api/assistant/shared/${id}`, user);
  assert.equal(consumed.status, 200); assert.equal(consumed.value.text, sharedText); privateResponse(consumed);
  assert.equal((await call(`/api/assistant/shared/${id}`, user)).status, 404);
  passed("shares carry only an opaque URL ID and encrypted owner-bound text, consumed exactly once");

  const expiring = shareLocation(await share(user, "다음 주 금요일에 저녁 식사하자는 합성 공유입니다."));
  const expiredId = expiring.searchParams.get("share");
  db.prepare("UPDATE assistant_handoffs SET expires_at=? WHERE id=? AND user_id=?").run(new Date(Date.now() - 1).toISOString(), expiredId, user.appId);
  assert.equal((await call(`/api/assistant/shared/${expiredId}`, user)).status, 404);
  const beforeAnonymous = db.prepare("SELECT COUNT(*) AS n FROM assistant_handoffs").get().n;
  assert.equal(shareLocation(await share(null, sharedText)).searchParams.get("shareError"), "signin");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assistant_handoffs").get().n, beforeAnonymous);
  const maxText = "가".repeat(6000), maximum = shareLocation(await share(user, maxText));
  const maxId = maximum.searchParams.get("share"); assert.ok(maxId);
  assert.equal((await call(`/api/assistant/shared/${maxId}`, user)).value.text, maxText);
  const beforeRejected = noSharedRow(user);
  for (const rejected of [await share(user, "가".repeat(6001)), await share(user, "x".repeat(70000))]) assert.ok(shareLocation(rejected).searchParams.has("shareError"));
  const file = new FormData(); file.append("text", new Blob(["not plain text"]), "message.txt");
  assert.ok(shareLocation(await share(user, "", { body: file })).searchParams.has("shareError"));
  const crossOrigin = await share(user, sharedText, { headers: { Origin: "https://untrusted.invalid" } });
  if (crossOrigin.status === 403) {
    // Vinext's DEV origin boundary rejects this request before the share route runs.
    assert.ok(!(await crossOrigin.text()).includes(sharedText));
  } else assert.ok(shareLocation(crossOrigin).searchParams.has("shareError"));
  assert.equal(noSharedRow(user), beforeRejected);
  passed("share expiry, anonymous discard, 6000-character decoding and malformed/oversized inputs are enforced");

  for (const path of ["/assistant", "/admin/ai"]) {
    const anonymous = await page(path);
    assert.ok(anonymous.text.includes("우리의 시간을 불러오고 있어요"));
    assert.ok(!anonymous.text.includes(title)); assert.ok(!anonymous.text.includes(admin.email));
  }
  const denied = await page("/admin/ai", user);
  assert.ok(denied.text.includes("운영자 전용 공간")); assert.ok(!denied.text.includes(admin.email));
  const assistant = await page("/assistant", user);
  assert.ok(assistant.text.includes("사이 일정 도우미")); assert.ok(assistant.text.includes(title));
  passed("assistant and AI administration SSR recover anonymous sessions and isolate admin access");

  for (const headers of [{}, { RSC: "1", Accept: "text/x-component" }]) {
    // Vinext's Flight transport requires its canonical cache-busting query even when the hash is empty.
    const rsc = headers.RSC === "1";
    const app = await page(rsc ? "/app?_rsc" : "/app", user, headers);
    assert.ok((app.response.headers.get("content-type") || "").startsWith(rsc ? "text/x-component" : "text/html"));
    assert.ok(app.text.includes("initialCalendar")); assert.ok(app.text.includes(title));
    const demo = await page(rsc ? "/app?demo=1&_rsc" : "/app?demo=1", user, headers);
    assert.ok(!demo.text.includes(title)); assert.ok(!demo.text.includes(user.email));
  }
  const privateState = await call(statePath, user); privateResponse(privateState);
  assert.ok(privateState.value.events.some(item => item.id === event.clientRequestId));
  assert.equal((await call(statePath, other, "GET", undefined, { "X-Sai-Expected-User": user.appId })).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM assistant_usage WHERE user_id IN (?,?,?)").get(user.appId, other.appId, admin.appId).n, 0, "Unconfigured requests must not consume provider quota.");
  passed("SSR hydrates private calendar data without raw tokens; demo, HTML/RSC cache headers and API guards remain safe");
  console.log(`Assistant + Share + SSR integration: ${checks.length} checks passed.`);
} finally {
  const syntheticIds = actors.map(actor => actor.appId).filter(Boolean);
  for (const actor of actors) {
    if (actor.appId) {
      const member = db.prepare("SELECT household_id FROM members WHERE user_id=?").get(actor.appId);
      if (member) households.add(member.household_id);
      db.prepare("DELETE FROM assistant_handoffs WHERE user_id=?").run(actor.appId);
      db.prepare("DELETE FROM assistant_usage WHERE user_id=?").run(actor.appId);
      db.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(actor.appId);
      db.prepare("DELETE FROM ai_settings WHERE updated_by=?").run(actor.appId);
    }
  }
  if (managedSettings) assert.ok(!db.prepare("SELECT id FROM ai_settings WHERE updated_by IN (SELECT user_id FROM auth_identities WHERE provider='firebase:demo-sai-calendar')").get(), "Synthetic settings cleanup failed.");
  for (const household of households) {
    db.prepare("DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE household_id=?)").run(household);
    db.prepare("DELETE FROM notifications WHERE household_id=?").run(household);
    db.prepare("DELETE FROM push_subscriptions WHERE user_id IN (SELECT user_id FROM members WHERE household_id=?)").run(household);
    db.prepare("DELETE FROM invitations WHERE household_id=?").run(household);
    db.prepare("DELETE FROM events WHERE household_id=?").run(household);
    db.prepare("DELETE FROM members WHERE household_id=?").run(household);
    db.prepare("DELETE FROM households WHERE id=?").run(household);
  }
  for (const actor of actors) {
    db.prepare("DELETE FROM auth_identities WHERE provider=? AND subject=?").run("firebase:demo-sai-calendar", actor.uid);
    try { await auth("projects/demo-sai-calendar/accounts:delete", { localId: actor.uid }, true); }
    catch { console.warn("A synthetic local account could not be removed; stopping the emulator discards it."); }
  }
  assert.equal(syntheticIds.filter(id => db.prepare("SELECT user_id FROM members WHERE user_id=?").get(id)).length, 0);
  db.close();
}
