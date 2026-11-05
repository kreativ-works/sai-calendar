import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, relative, resolve, sep } from "node:path";

// Auth emulator + DEV Worker only. No real cloud project or production data.
// Start `firebase emulators:start --only auth --project demo-sai-calendar`,
// configure the matching .dev.vars, then run:
// node scripts/smoke-firebase-auth.mjs http://127.0.0.1:5173 \
//   http://127.0.0.1:9099 --legacy-db .wrangler/state/v3/d1/.../database.sqlite
const args = process.argv.slice(2);
const base = new URL(args[0] ?? "http://127.0.0.1:5173");
const emulator = new URL(args[1] ?? "http://127.0.0.1:9099");
for (const url of [base, emulator]) {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Smoke tests are restricted to loopback hosts.");
  assert.equal(url.protocol, "http:", "Use local HTTP test servers only.");
  assert.ok(!url.username && !url.password && url.pathname === "/" && !url.search, "Use a plain local origin.");
}
const dbIndex = args.indexOf("--legacy-db");
assert.ok(dbIndex >= 0 && args[dbIndex + 1], "Pass --legacy-db with the local D1 SQLite file for explicit migration coverage.");
const dbPath = resolve(args[dbIndex + 1]);
const localState = resolve(".wrangler/state");
const stateRelative = relative(localState, dbPath);
assert.ok(stateRelative && !stateRelative.startsWith(`..${sep}`) && !isAbsolute(stateRelative) && dbPath.endsWith(".sqlite") && !dbPath.endsWith(`${sep}metadata.sqlite`), "The fixture database must be inside this app's .wrangler/state.");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

const tag = `sai-auth-qa-${randomUUID()}`;
const project = "demo-sai-calendar";
const fakeApiKey = "fake-api-key";
const createdSubjects = new Set();
const createdHouseholds = new Set();
const checks = [];
const statePath = "/api/state?from=2026-11-01&to=2026-12-31";
const legacyCookie = "__sites_local_auth=1";
const legacyId = "local_seedy"; // The starter's loopback-only Sites sign-in fixture.
let legacyFixture;
const passed = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const describe = (result) => `${result.status}: ${result.value?.error?.code ?? result.value?.error?.message ?? "unexpected response"}`;

async function appRequest(path, actor = null, method = "GET", value, options = {}) {
  const headers = { ...(actor?.cookie ? { Cookie: actor.cookie } : {}), ...options.headers };
  if (value !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method) && options.origin !== null) headers.Origin = options.origin ?? base.origin;
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(new URL(path, base), { method, headers, ...(value !== undefined ? { body: JSON.stringify(value) } : {}), redirect: "error", signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    // Vinext may reject cross-origin traffic before the app route is reached.
    if (options.allowBoundary403 && response.status === 403) parsed = { error: { code: "BOUNDARY_ORIGIN_DENIED" } };
    else throw new Error(`Expected JSON from local app at ${path}; received HTTP ${response.status}.`);
  }
  return { status: response.status, value: parsed, headers: response.headers };
}

async function authRequest(method, value, admin = false) {
  const response = await fetch(`${emulator.origin}/identitytoolkit.googleapis.com/v1/${method}?key=${fakeApiKey}`, { method: "POST", headers: { "Content-Type": "application/json", ...(admin ? { Authorization: "Bearer owner" } : {}) }, body: JSON.stringify(value), signal: AbortSignal.timeout(10_000) });
  const result = { status: response.status, value: await response.json() };
  assert.equal(result.status, 200, `Local Firebase ${method} failed: ${describe(result)}`);
  return result.value;
}

async function emailUser(label, emailOverride) {
  const email = emailOverride ?? `${tag}-${label}@example.invalid`;
  const password = `Local-sai!${randomUUID()}`;
  const result = await authRequest("accounts:signUp", { email, password, returnSecureToken: true });
  createdSubjects.add(result.localId);
  return { email, password, uid: result.localId, idToken: result.idToken, cookie: null };
}

async function verifyEmail(actor) {
  await authRequest("accounts:sendOobCode", { requestType: "VERIFY_EMAIL", idToken: actor.idToken });
  const response = await fetch(`${emulator.origin}/emulator/v1/projects/${project}/oobCodes`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, "Emulator OOB test endpoint must be available.");
  const result = await response.json();
  const code = result.oobCodes?.findLast((item) => item.email === actor.email && item.requestType === "VERIFY_EMAIL");
  assert.ok(code?.oobCode, "A verification email action must be generated.");
  await authRequest("accounts:update", { oobCode: code.oobCode });
  const signedIn = await authRequest("accounts:signInWithPassword", { email: actor.email, password: actor.password, returnSecureToken: true });
  actor.idToken = signedIn.idToken;
  return actor;
}

async function googleUser(label) {
  const now = Math.floor(Date.now() / 1000);
  const email = `${tag}-${label}@example.invalid`;
  // Firebase's Auth Emulator accepts simulated IdP credentials. This unsigned
  // Google token is sent exclusively to the loopback emulator, never the app.
  const credential = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: "fake-google-client", sub: `${tag}-${label}`, email, email_verified: true, name: "테스트 Google 계정", iat: now, exp: now + 3_600 })).toString("base64url")}.`;
  const result = await authRequest("accounts:signInWithIdp", { postBody: new URLSearchParams({ providerId: "google.com", id_token: credential }).toString(), requestUri: base.origin, returnSecureToken: true });
  assert.equal(result.providerId, "google.com");
  createdSubjects.add(result.localId);
  return { email, uid: result.localId, idToken: result.idToken, cookie: null };
}

async function establish(actor) {
  const result = await appRequest("/api/auth/session", null, "POST", { idToken: actor.idToken });
  assert.equal(result.status, 200, describe(result));
  const cookie = result.headers.get("set-cookie");
  assert.ok(cookie?.startsWith("sai_session="), "A host-only app session cookie must be set.");
  assert.match(cookie, /; HttpOnly(?:;|$)/i);
  assert.match(cookie, /; SameSite=Lax(?:;|$)/i);
  assert.match(cookie, /; Path=\/(?:;|$)/i);
  assert.doesNotMatch(cookie, /; Domain=/i);
  const maxAge = Number(/; Max-Age=(\d+)/i.exec(cookie)?.[1]);
  assert.ok(maxAge > 0 && maxAge <= 3_600, "Cookie lifetime must not exceed the ID token lifetime.");
  actor.cookie = cookie.split(";")[0];
  actor.appId = result.value.user.id;
  return result;
}

async function state(actor, options) {
  const result = await appRequest(statePath, actor, "GET", undefined, options);
  assert.equal(result.status, 200, describe(result));
  return result.value;
}

function prepareLegacyFixture() {
  const existingMapping = db.prepare("SELECT subject FROM auth_identities WHERE provider = ? AND user_id = ?").get(`firebase:${project}`, legacyId);
  assert.equal(existingMapping, undefined, "The local legacy fixture is already connected; use an isolated local database.");
  let member = db.prepare("SELECT * FROM members WHERE user_id = ?").get(legacyId);
  if (!member) {
    const id = `${tag}-legacy-household`;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO households (id, name, a_name, b_name, anniversary, revision, created_at) VALUES (?, ?, ?, ?, NULL, 1, ?)").run(id, "인증 전환 테스트", "기존 나", "짝꿍", now);
    db.prepare("INSERT INTO members (user_id, household_id, slot, email, joined_at) VALUES (?, ?, 'a', 'seedy@sites.test', ?)").run(legacyId, id, now);
    createdHouseholds.add(id);
    member = db.prepare("SELECT * FROM members WHERE user_id = ?").get(legacyId);
  }
  return { member, eventCount: db.prepare("SELECT COUNT(*) AS total FROM events WHERE household_id = ?").get(member.household_id).total };
}

try {
  const config = await appRequest("/api/auth/config");
  assert.equal(config.status, 200);
  assert.equal(config.value.configured, true);
  assert.equal(config.value.firebase.projectId, project, "This suite only runs against the demo project.");
  assert.equal(config.value.firebase.apiKey, fakeApiKey, "Use the fake local key only.");
  assert.equal(config.value.emulatorUrl, emulator.origin, "Unsigned emulator tokens require the app's DEV-only loopback configuration.");
  passed("DEV config is restricted to the loopback demo Auth Emulator");

  assert.equal((await appRequest("/api/auth/session")).value.user, null);
  assert.equal((await appRequest(statePath)).status, 401);
  assert.equal((await appRequest(statePath, null, "GET", undefined, { cookie: legacyCookie })).status, 401);
  passed("anonymous and legacy Sites login alone cannot open a calendar");

  const a = await emailUser("a");
  const unverified = await appRequest("/api/auth/session", null, "POST", { idToken: a.idToken });
  assert.equal(unverified.status, 403, describe(unverified));
  assert.equal(unverified.value.error.code, "EMAIL_UNVERIFIED");
  assert.equal(unverified.headers.get("set-cookie"), null);
  passed("email signup requires the real verification action before a session is issued");
  await verifyEmail(a);

  for (const origin of [null, "https://untrusted.invalid"]) {
    const denied = await appRequest("/api/auth/session", null, "POST", { idToken: a.idToken }, { origin, allowBoundary403: true });
    assert.equal(denied.status, 403, describe(denied));
  }
  passed("session login rejects missing and cross-site Origin headers");

  const oversized = await appRequest("/api/auth/session", null, "POST", { idToken: "x".repeat(8_500) });
  assert.equal(oversized.status, 413, describe(oversized));
  passed("session body limit rejects oversized input");

  await establish(a);
  assert.notEqual(a.appId, a.uid, "The app must use a canonical ID rather than trust an input user ID.");
  assert.equal((await appRequest("/api/auth/session", a)).value.user.id, a.appId);
  const originalId = a.appId;
  await establish(a);
  assert.equal(a.appId, originalId);
  passed("verified session uses an HttpOnly host-only cookie and stable canonical identity");

  assert.equal((await state(a)).household, null);
  const profile = { name: "인증 통합 검증 캘린더", aName: "테스트 하나", bName: "테스트 둘", anniversary: "2020-05-16" };
  const created = await appRequest("/api/household", a, "POST", profile);
  assert.equal(created.status, 200, describe(created));
  const aState = await state(a);
  createdHouseholds.add(aState.household.id);
  assert.equal(aState.viewerSlot, "a");
  passed("verified email user creates and reads a persisted calendar");

  const eventId = randomUUID();
  const event = { title: "인증 테스트 함께 산책", startDate: "2026-11-05", endDate: "2026-11-05", startTime: "18:00", endTime: "19:00", allDay: false, ownerScope: "both", category: "date", location: "테스트 장소", note: "합성 인증 검증용 일정", repeat: "none", repeatUntil: null, clientRequestId: eventId };
  assert.equal((await appRequest("/api/events", a, "POST", event)).status, 200);
  assert.ok((await state(a)).events.some((item) => item.id === eventId));
  passed("Firebase cookie authorizes persisted event creation and reload");

  const b = await verifyEmail(await emailUser("b"));
  await establish(b);
  const invitation = await appRequest("/api/invites", a, "POST", {});
  assert.equal(invitation.status, 200, describe(invitation));
  assert.equal((await appRequest("/api/invites/join", b, "POST", { code: invitation.value.code })).status, 200);
  const bState = await state(b);
  assert.equal(bState.household.id, aState.household.id);
  assert.equal(bState.viewerSlot, "b");
  assert.ok(bState.events.some((item) => item.id === eventId));
  passed("second verified account accepts an invitation and reads shared events");

  assert.equal((await appRequest(`/api/events/${eventId}`, b, "PATCH", { ...event, title: "짝꿍이 바꾼 일정", revision: 1 })).status, 200);
  assert.equal((await state(a)).events.find((item) => item.id === eventId).title, "짝꿍이 바꾼 일정");
  passed("partner edits propagate across separate authenticated cookies");

  assert.equal((await appRequest("/api/notifications")).status, 401);
  let aNotices = (await appRequest("/api/notifications", a)).value;
  const changedNotice = aNotices.items.find(item => item.eventId === eventId && item.kind === "event_updated");
  assert.ok(changedNotice);
  assert.ok(!(await appRequest("/api/notifications", b)).value.items.some(item => item.eventId === eventId && item.kind === "event_updated"));
  passed("notification inbox authenticates the recipient and excludes self edits");
  assert.equal((await appRequest("/api/notifications", b, "PATCH", { ids: [changedNotice.id] })).status, 200);
  assert.equal((await appRequest("/api/notifications", a)).value.items.find(item => item.id === changedNotice.id).readAt, null);
  assert.equal((await appRequest("/api/notifications", a, "PATCH", { ids: [changedNotice.id] })).status, 200);
  assert.ok((await appRequest("/api/notifications", a)).value.items.find(item => item.id === changedNotice.id).readAt);
  passed("read state is persisted and cannot mark another member's notice read");

  const near = new Date(Date.now() + 15 * 60_000 + 9 * 3_600_000).toISOString();
  const end = new Date(Date.now() + 25 * 60_000 + 9 * 3_600_000).toISOString();
  const nearId = randomUUID();
  const nearEvent = { ...event, clientRequestId: nearId, title: "곧 시작하는 내 합성 일정", startDate: near.slice(0, 10), endDate: end.slice(0, 10), startTime: near.slice(11, 16), endTime: end.slice(11, 16), ownerScope: "a" };
  assert.equal((await appRequest("/api/events", b, "POST", nearEvent)).status, 200);
  aNotices = (await appRequest("/api/notifications", a)).value;
  assert.ok(aNotices.items.some(item => item.eventId === nearId && item.kind === "event_created"));
  assert.ok(aNotices.items.some(item => item.eventId === nearId && item.kind === "reminder"));
  assert.ok(!(await appRequest("/api/notifications", b)).value.items.some(item => item.eventId === nearId && item.kind === "reminder"));
  const noticeCount = aNotices.items.filter(item => item.eventId === nearId).length;
  assert.equal((await appRequest("/api/events", b, "POST", nearEvent)).status, 200);
  assert.equal((await appRequest("/api/notifications", a)).value.items.filter(item => item.eventId === nearId).length, noticeCount);
  passed("near-future owner reminders and partner creation notices persist without retry duplicates");

  const prefs = aNotices.preferences;
  assert.equal((await appRequest("/api/notifications/preferences", a, "PATCH", { ...prefs, partnerChanges: false, quietEnabled: true, quietStart: "22:00", quietEnd: "08:00" })).status, 200);
  assert.equal((await appRequest("/api/notifications/preferences", a, "PATCH", prefs)).status, 409);
  const savedPrefs = (await appRequest("/api/notifications", a)).value.preferences;
  assert.equal(savedPrefs.partnerChanges, false);
  assert.equal((await appRequest("/api/notifications", b)).value.preferences.partnerChanges, true);
  assert.equal((await appRequest("/api/notifications/preferences", a, "PATCH", { ...savedPrefs, quietEnd: savedPrefs.quietStart })).status, 422);
  assert.equal((await appRequest("/api/notifications/preferences", a, "PATCH", { ...savedPrefs, partnerChanges: true, quietEnabled: false })).status, 200);
  passed("personal notification settings persist, validate quiet hours and reject stale revisions");
  assert.equal((await appRequest("/api/notifications/subscriptions", a, "POST", { subscription: { endpoint: "http://127.0.0.1/private", keys: { p256dh: "bad", auth: "bad" } } })).status, 422);
  assert.equal((await appRequest("/api/internal/notifications/dispatch", null, "POST", {})).status, 401);
  assert.equal((await appRequest(`/api/events/${nearId}`, b, "DELETE", { revision: 1 })).status, 200);
  assert.ok((await appRequest("/api/notifications", a)).value.items.some(item => item.eventId === nearId && item.kind === "event_deleted"));
  passed("push subscriptions reject arbitrary targets, cron rejects anonymous calls and partner deletions are recorded");

  const c = await googleUser("google-c");
  await establish(c);
  assert.equal((await state(c)).household, null);
  assert.deepEqual((await appRequest("/api/notifications", c)).value.items, []);
  assert.notEqual((await appRequest("/api/invites/join", c, "POST", { code: invitation.value.code })).status, 200);
  assert.equal((await appRequest(`/api/events/${eventId}`, c, "PATCH", { ...event, revision: 2 })).status, 403);
  assert.equal((await appRequest("/api/invites", a, "POST", {})).status, 409);
  passed("emulated Google login works while a third account cannot join or edit the couple calendar");

  const loggedOut = await appRequest("/api/auth/session", b, "DELETE", {});
  assert.equal(loggedOut.status, 200, describe(loggedOut));
  assert.match(loggedOut.headers.get("set-cookie"), /Max-Age=0/);
  b.cookie = null;
  assert.equal((await appRequest("/api/auth/session", b)).value.user, null);
  assert.equal((await appRequest(statePath, b)).status, 401);
  passed("logout clears the app cookie and closes calendar access");
  await establish(b);
  await authRequest("accounts:update", { localId: b.uid, validSince: String(Math.floor(Date.now() / 1000) + 1) }, true);
  assert.equal((await appRequest("/api/auth/session", b)).value.user, null);
  assert.equal((await appRequest(statePath, b)).status, 401);
  passed("Firebase token revocation closes an existing calendar session");

  await authRequest("accounts:update", { localId: c.uid, disableUser: true }, true);
  assert.equal((await appRequest("/api/auth/session", c)).value.user, null);
  assert.equal((await appRequest(statePath, c)).status, 401);
  passed("disabled Firebase accounts lose access despite an existing cookie");

  legacyFixture = prepareLegacyFixture();
  const d = await verifyEmail(await emailUser("legacy-d", legacyFixture.member.email));
  const e = await verifyEmail(await emailUser("legacy-e"));
  await establish(d);
  await establish(e);
  assert.equal((await state(d)).household, null);
  assert.equal((await state(d, { cookie: `${d.cookie}; ${legacyCookie}` })).household, null);
  assert.equal((await appRequest("/api/auth/session", d)).value.legacyAvailable, false);
  assert.equal((await appRequest("/api/auth/session", d, "GET", undefined, { cookie: `${d.cookie}; ${legacyCookie}` })).value.legacyAvailable, true);
  passed("matching email and both logins do not automatically attach a legacy calendar");

  assert.equal((await appRequest("/api/auth/link-legacy", null, "POST", {}, { cookie: legacyCookie })).status, 401);
  assert.equal((await appRequest("/api/auth/link-legacy", d, "POST", {})).status, 401);
  assert.equal((await appRequest("/api/auth/link-legacy", a, "POST", {}, { cookie: `${a.cookie}; ${legacyCookie}` })).status, 409);
  passed("legacy linking requires both identities and refuses an existing new household");

  const concurrentLinks = await Promise.all([d, e].map((actor) => appRequest("/api/auth/link-legacy", actor, "POST", {}, { cookie: `${actor.cookie}; ${legacyCookie}` })));
  assert.deepEqual(concurrentLinks.map((item) => item.status).sort(), [200, 409]);
  const winner = concurrentLinks[0].status === 200 ? d : e;
  const loser = winner === d ? e : d;
  const linked = await state(winner);
  assert.equal(linked.user.id, legacyId);
  assert.equal(linked.household.id, legacyFixture.member.household_id);
  assert.equal((await state(loser)).household, null);
  assert.deepEqual(db.prepare("SELECT * FROM members WHERE user_id = ?").get(legacyId), legacyFixture.member);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM events WHERE household_id = ?").get(legacyFixture.member.household_id).total, legacyFixture.eventCount);
  passed("concurrent explicit legacy links allow one identity and preserve original membership and events");

  console.log(`Firebase Auth + Calendar integration: ${checks.length} checks passed.`);
} finally {
  // Remove exactly the synthetic identities/households from this run. The
  // existing local legacy member and events remain intact after link coverage.
  for (const subject of createdSubjects) db.prepare("DELETE FROM auth_identities WHERE provider = ? AND subject = ?").run(`firebase:${project}`, subject);
  for (const household of createdHouseholds) {
    db.prepare("DELETE FROM notifications WHERE household_id = ?").run(household);
    db.prepare("DELETE FROM push_subscriptions WHERE user_id IN (SELECT user_id FROM members WHERE household_id = ?)").run(household);
    db.prepare("DELETE FROM notification_preferences WHERE user_id IN (SELECT user_id FROM members WHERE household_id = ?)").run(household);
    db.prepare("DELETE FROM invitations WHERE household_id = ?").run(household);
    db.prepare("DELETE FROM events WHERE household_id = ?").run(household);
    db.prepare("DELETE FROM members WHERE household_id = ?").run(household);
    db.prepare("DELETE FROM households WHERE id = ?").run(household);
  }
  db.close();
  for (const subject of createdSubjects) {
    try { await authRequest(`projects/${project}/accounts:delete`, { localId: subject }, true); }
    catch { console.warn("A synthetic Auth Emulator account could not be removed; stopping the emulator discards it."); }
  }
}
