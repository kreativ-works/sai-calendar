import assert from "node:assert/strict";
import test from "node:test";
import { createSessionCoordinator, SessionCancelledError } from "../lib/client/session-coordinator.ts";
import { createApiClient, ApiError, isProtectedApiPath } from "../lib/client/api.ts";
import { sameSessionForRetry } from "../lib/client/session-context.ts";

const alice = { uid: "firebase-alice", emailVerified: true };
const aliceSession = { user: { id: "app-alice" }, legacyAvailable: false };
const bobSession = { user: { id: "app-bob" }, legacyAvailable: false };
const anonymous = { user: null, legacyAvailable: false };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function coordinator(overrides = {}) {
  const calls = [];
  const dependencies = {
    readServer: async () => { calls.push("read-server"); return anonymous; },
    readIdentity: async () => { calls.push("read-identity"); return alice; },
    token: async (user, force) => { calls.push(["token", user.uid, force]); return "fresh-token"; },
    writeServer: async token => { calls.push(["write-server", token]); return aliceSession; },
    clearServer: async () => { calls.push("clear-server"); },
    signOut: async () => { calls.push("sign-out"); },
    onAuthenticated: session => { calls.push(["authenticated", session.user?.id]); },
    onLogout: () => { calls.push("logout"); },
    isPermanent: error => error?.code === "INVALID_TOKEN",
    ...overrides,
  };
  return { session: createSessionCoordinator(dependencies), calls };
}

test("restoration keeps a valid server session without requiring an SDK store", async () => {
  const { session, calls } = coordinator({ readServer: async () => aliceSession });
  assert.deepEqual(await session.restore(), { status: "authenticated", session: aliceSession });
  assert.deepEqual(calls, [["authenticated", "app-alice"]]);
});

test("expired cookies restore once from persistent Firebase identity with a refreshed token", async () => {
  const { session, calls } = coordinator();
  const first = session.restore();
  const second = session.restore();
  assert.equal(first, second);
  assert.deepEqual(await first, { status: "authenticated", session: aliceSession });
  assert.deepEqual(calls, ["read-server", "read-identity", ["token", alice.uid, true], ["write-server", "fresh-token"], ["authenticated", "app-alice"]]);
});

test("unverified and absent persistent identities never receive an app session", async () => {
  for (const user of [null, { ...alice, emailVerified: false }]) {
    const { session, calls } = coordinator({ readIdentity: async () => user });
    assert.equal((await session.restore()).status, user ? "unverified" : "anonymous");
    assert.deepEqual(calls, ["read-server"]);
  }
});

test("a temporary provider error keeps identity intact and allows a later retry", async () => {
  let attempts = 0;
  const { session, calls } = coordinator({ token: async () => { if (++attempts === 1) throw new Error("offline"); return "new-token"; } });
  await assert.rejects(session.restore(), /offline/);
  assert.equal(session.isBlocked(), false);
  assert.equal((await session.restore()).status, "authenticated");
  assert.equal(calls.includes("sign-out"), false);
});

test("a revoked identity is cleared and remains signed out until an explicit sign-in", async () => {
  let revoked = true;
  const { session, calls } = coordinator({ token: async () => { if (revoked) throw { code: "INVALID_TOKEN" }; return "new-token"; } });
  assert.deepEqual(await session.restore(), { status: "anonymous" });
  assert.equal(session.isBlocked(), true);
  assert.equal(calls.filter(call => call === "clear-server").length, 1);
  const before = calls.length;
  assert.deepEqual(await session.restore(), { status: "anonymous" });
  assert.equal(calls.length, before);
  revoked = false;
  session.beginSignIn();
  assert.equal((await session.sync(alice)).user.id, "app-alice");
});

test("logout waits behind a pending session POST and prevents it from restoring authentication", async () => {
  const posted = deferred(), finish = deferred();
  const { session, calls } = coordinator({ writeServer: async () => { calls.push("post-start"); posted.resolve(); await finish.promise; calls.push("post-end"); return aliceSession; } });
  const oldSync = session.sync(alice);
  await posted.promise;
  const cancelled = assert.rejects(oldSync, SessionCancelledError);
  const loggedOut = session.logout();
  assert.throws(() => session.beginSignIn(), /로그아웃을 마무리/);
  finish.resolve();
  await Promise.all([cancelled, loggedOut]);
  assert.ok(calls.indexOf("post-end") < calls.indexOf("clear-server"));
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "authenticated"), false);
  assert.deepEqual(await session.restore(), { status: "anonymous" });
  session.beginSignIn();
  assert.equal((await session.sync(alice)).user.id, "app-alice");
});

test("a sign-in generation change prevents an older delayed token from reaching the cookie endpoint", async () => {
  const waiting = deferred(), finish = deferred();
  const { session, calls } = coordinator({ token: async () => { waiting.resolve(); await finish.promise; return "old-token"; } });
  const oldSync = session.sync(alice);
  await waiting.promise;
  const cancelled = assert.rejects(oldSync, SessionCancelledError);
  session.beginSignIn();
  finish.resolve();
  await cancelled;
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === "write-server"), false);
});

function client({ initial = "app-alice", responses = [], restore = async () => ({ status: "authenticated", session: aliceSession }) } = {}) {
  let context = { userId: initial, version: 1, changing: false };
  let restores = 0, changes = 0;
  const requests = [];
  const request = createApiClient({
    origin: () => "https://sai.day",
    capture: () => ({ ...context }),
    bind: userId => { context = { ...context, userId }; },
    changed: () => { changes++; context = { ...context, changing: true, version: context.version + 1 }; },
    restore: async () => { restores++; return restore(); },
    fetch: async (path, init) => {
      requests.push({ path, method: init.method || "GET", expected: init.headers.get("X-Sai-Expected-User"), body: init.body });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (typeof response === "function") return response();
      return Response.json(response?.body ?? {}, { status: response?.status ?? 200 });
    },
  });
  return { request, requests, setContext: value => { context = value; }, stats: () => ({ restores, changes }) };
}

test("protected API 401 retries once with the same account and reusable mutation body", async () => {
  const body = JSON.stringify({ title: "우리 약속", clientRequestId: "same-id" });
  const { request, requests, stats } = client({ responses: [{ status: 401 }, { body: { saved: true } }] });
  assert.deepEqual(await request("/api/events", { method: "POST", body }), { saved: true });
  assert.equal(stats().restores, 1);
  assert.deepEqual(requests.map(item => [item.expected, item.body]), [["app-alice", body], ["app-alice", body]]);
});

test("unknown-account mutations and auth endpoints are never automatically replayed", async () => {
  for (const [path, initial] of [["/api/events", null], ["/api/auth/session", "app-alice"]]) {
    const { request, requests, stats } = client({ initial, responses: [{ status: 401 }] });
    await assert.rejects(request(path, { method: "POST", body: "{}" }), error => error instanceof ApiError && error.status === 401);
    assert.equal(requests.length, 1);
    assert.equal(stats().restores, 0);
  }
});

test("restoring another account rejects a pending write instead of applying it to that account", async () => {
  const { request, requests, stats } = client({ responses: [{ status: 401 }], restore: async () => ({ status: "authenticated", session: bobSession }) });
  await assert.rejects(request("/api/events", { method: "POST", body: "{}" }), error => error.code === "SESSION_CHANGED");
  assert.equal(requests.length, 1);
  assert.deepEqual(stats(), { restores: 1, changes: 1 });
});

test("an initial read can recover, but a second 401 never starts a retry loop", async () => {
  const { request, requests, stats } = client({ initial: null, responses: [{ status: 401 }, { status: 401 }] });
  await assert.rejects(request("/api/state"), error => error.status === 401);
  assert.equal(requests.length, 2);
  assert.equal(stats().restores, 1);
});

test("server account-change rejection stops immediately and does not try token restoration", async () => {
  const { request, stats } = client({ responses: [{ status: 409, body: { error: { code: "SESSION_CHANGED" } } }] });
  await assert.rejects(request("/api/events", { method: "POST", body: "{}" }), error => error.code === "SESSION_CHANGED");
  assert.deepEqual(stats(), { restores: 0, changes: 1 });
});

test("offline writes fail once and retain a clear retryable error", async () => {
  const { request, requests, stats } = client({ responses: [new TypeError("offline")] });
  await assert.rejects(request("/api/events", { method: "POST", body: "{}" }), error => error.status === 0 && /작성한 내용은 그대로/.test(error.message));
  assert.equal(requests.length, 1);
  assert.equal(stats().restores, 0);
});

test("retry identity checks include the generation, and only same-origin application APIs qualify", () => {
  const before = { userId: "app-alice", version: 1, changing: false };
  assert.equal(sameSessionForRetry(before, { ...before, version: 2 }, "app-alice", false), false);
  assert.equal(sameSessionForRetry(before, { ...before, changing: true }, "app-alice", true), false);
  assert.equal(isProtectedApiPath("/api/events", "https://sai.day"), true);
  assert.equal(isProtectedApiPath("https://elsewhere.example/api/events", "https://sai.day"), false);
  assert.equal(isProtectedApiPath("/api/auth/session", "https://sai.day"), false);
});
