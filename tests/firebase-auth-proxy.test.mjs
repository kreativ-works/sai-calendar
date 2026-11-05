import assert from "node:assert/strict";
import test from "node:test";
import { proxyFirebaseAuthRequest } from "../lib/server/firebase-auth-proxy.ts";

const origin = "https://sai.example.test";
const project = "sai-proxy-tests";
const env = { SAI_FIREBASE_PROJECT_ID: project };
const upstreamOrigin = `https://${project}.firebaseapp.com`;
const request = (path, options) => new Request(`${origin}${path}`, options);
const neverFetch = async () => { throw new Error("Unexpected upstream request"); };

test("Firebase helper proxy does not intercept application or arbitrary Hosting routes", async () => {
  for (const path of ["/", "/app", "/api/state", "/__/authx/handler", "/__/firebase/init.js", "/something?url=https://evil.test"]) {
    assert.equal(await proxyFirebaseAuthRequest(request(path), env, neverFetch), null);
  }
});

test("Firebase helper proxy requires a strict runtime project ID", async () => {
  for (const projectId of [undefined, "", "bad.project", "https://evil.test", "good-project.evil.test/path", "bad-project-", "../bad-project"]) {
    const response = await proxyFirebaseAuthRequest(request("/__/auth/handler"), { SAI_FIREBASE_PROJECT_ID: projectId }, neverFetch);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("Firebase helper GET preserves OAuth parameters while stripping app credentials and Referer", async () => {
  const response = await proxyFirebaseAuthRequest(request("/__/auth/iframe?apiKey=public-key&appName=%5BDEFAULT%5D&target=https%3A%2F%2Fevil.test", { headers: {
    Cookie: "sai_session=private-cookie; other=private", Authorization: "Bearer private",
    Referer: `${origin}/?join=private-invitation`, "oai-authenticated-user-id": "private-user",
    "oai-authenticated-user-email": "private@example.test", "X-Forwarded-Host": "evil.test",
    Accept: "text/html", "Accept-Language": "ko", "Content-Type": "text/plain", Origin: origin, "User-Agent": "Test browser",
  } }), env, async (url, init) => {
    assert.equal(url.origin, upstreamOrigin);
    assert.equal(url.pathname, "/__/auth/iframe");
    assert.equal(url.searchParams.get("appName"), "[DEFAULT]");
    assert.equal(url.searchParams.get("target"), "https://evil.test");
    assert.equal(init.redirect, "manual");
    assert.deepEqual([...init.headers.keys()].sort(), ["accept", "accept-language", "content-type", "origin", "user-agent"]);
    assert.equal(init.headers.get("origin"), origin);
    return new Response("<html>Firebase helper</html>", { headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "upstream-cookie=value", "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'self'" } });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'");
  assert.equal(await response.text(), "<html>Firebase helper</html>");
});

test("Firebase helper POST transparently forwards form payload without site cookies", async () => {
  const payload = "state=opaque-oauth-state&code=synthetic-provider-code";
  const response = await proxyFirebaseAuthRequest(request("/__/auth/handler", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: "sai_session=private" }, body: payload }), env, async (url, init) => {
    assert.equal(url.href, `${upstreamOrigin}/__/auth/handler`);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(init.headers.get("cookie"), null);
    assert.equal(await new Response(init.body).text(), payload);
    return new Response("handler", { headers: { "Content-Type": "text/html" } });
  });
  assert.equal(await response.text(), "handler");
});

test("Firebase helper rejects declared and actual oversized POST bodies before forwarding", async () => {
  let forwarded = false;
  const fetcher = async () => { forwarded = true; return new Response("unexpected"); };
  const declared = await proxyFirebaseAuthRequest(request("/__/auth/handler", { method: "POST", headers: { "Content-Length": String(128 * 1024 + 1) }, body: "small" }), env, fetcher);
  assert.equal(declared.status, 413);
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(80 * 1024)); controller.enqueue(new Uint8Array(49 * 1024)); },
    cancel() { canceled = true; },
  });
  const actual = await proxyFirebaseAuthRequest(request("/__/auth/handler?code=private", { method: "POST", body: stream, duplex: "half" }), env, fetcher);
  assert.equal(actual.status, 413);
  assert.equal(actual.headers.get("cache-control"), "no-store");
  assert.equal(canceled, true);
  assert.equal(forwarded, false);
  assert.doesNotMatch(await actual.text(), /private/);
});

test("Firebase helper permits a complete POST body at the 128KB limit", async () => {
  const bytes = new Uint8Array(128 * 1024).fill(65);
  const response = await proxyFirebaseAuthRequest(request("/__/auth/handler", { method: "POST", body: bytes }), env, async (_url, init) => {
    const received = new Uint8Array(await new Response(init.body).arrayBuffer());
    assert.deepEqual(received, bytes);
    return new Response("bounded complete request");
  });
  assert.equal(response.status, 200);
});

test("Firebase helper cancels a hanging POST body at the read deadline without forwarding", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let canceled = false, forwarded = false;
  const stream = new ReadableStream({ cancel() { canceled = true; } });
  const pending = proxyFirebaseAuthRequest(request("/__/auth/handler", { method: "POST", body: stream, duplex: "half" }), env, async () => { forwarded = true; return new Response("unexpected"); });
  context.mock.timers.tick(15_000);
  const response = await pending;
  assert.equal(response.status, 408);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(canceled, true);
  assert.equal(forwarded, false);
});

test("Firebase helper allows the exact public SDK init JSON endpoint", async () => {
  const response = await proxyFirebaseAuthRequest(request("/__/firebase/init.json"), env, async (url) => {
    assert.equal(url.href, `${upstreamOrigin}/__/firebase/init.json`);
    return Response.json({ projectId: project });
  });
  assert.deepEqual(await response.json(), { projectId: project });
});

test("Firebase helper rejects encoded path separators and unsupported methods without fetching", async () => {
  assert.equal((await proxyFirebaseAuthRequest(request("/__/auth/%2e%2e%2fprivate"), env, neverFetch)).status, 400);
  assert.equal((await proxyFirebaseAuthRequest(request("/__/auth/handler%5cprivate"), env, neverFetch)).status, 400);
  const response = await proxyFirebaseAuthRequest(request("/__/auth/handler", { method: "DELETE" }), env, neverFetch);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD, POST");
});

test("Firebase helper rewrites only its own helper redirects back to the app origin", async () => {
  for (const location of [`${upstreamOrigin}/__/auth/handler?state=test#return`, "/__/auth/handler?state=test#return"]) {
    const response = await proxyFirebaseAuthRequest(request("/__/auth/iframe"), env, async () => new Response(null, { status: 302, headers: { Location: location } }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `${origin}/__/auth/handler?state=test#return`);
  }
  for (const location of ["https://accounts.google.com/o/oauth2/auth?state=test", `${upstreamOrigin}/unrelated`, "https://sai-proxy-tests.firebaseapp.com.evil.test/__/auth/handler"]) {
    const response = await proxyFirebaseAuthRequest(request("/__/auth/handler"), env, async () => new Response(null, { status: 302, headers: { Location: location } }));
    assert.equal(response.headers.get("location"), location);
  }
});

test("Firebase helper HEAD has no body and preserves the JavaScript content type", async () => {
  const response = await proxyFirebaseAuthRequest(request("/__/auth/iframe.js", { method: "HEAD" }), env, async (_url, init) => {
    assert.equal(init.method, "HEAD");
    return new Response(null, { headers: { "Content-Type": "application/javascript" } });
  });
  assert.equal(response.headers.get("content-type"), "application/javascript");
  assert.equal(await response.text(), "");
});

test("Firebase helper network failures return a private generic error without leaking credentials", async () => {
  const response = await proxyFirebaseAuthRequest(request("/__/auth/handler?code=private-code"), env, async () => { throw new Error("Upstream error containing private-code"); });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await response.text(), /private-code/);
});
