import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyGithubNotificationCron, verifyGithubNotificationCronToken } from "../lib/server/notification-cron.ts";

const now = Math.floor(Date.now() / 1000);
const environment = { SAI_NOTIFICATION_CRON_REPOSITORY_ID: "123456789", SAI_NOTIFICATION_CRON_OWNER_ID: "987654321" };
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), alg: "RS256", kid: "github-test-key", use: "sig" };
const keys = createLocalJWKSet({ keys: [jwk] });
const baseline = {
  iss: "https://token.actions.githubusercontent.com",
  aud: "https://sai-our-calendar.seonguk.chatgpt.site/notifications",
  sub: "repo:kreativ-works@987654321/sai-calendar@123456789:ref:refs/heads/main",
  iat: now - 30, nbf: now - 30, exp: now + 270,
  repository: "kreativ-works/sai-calendar", repository_owner: "kreativ-works",
  repository_id: environment.SAI_NOTIFICATION_CRON_REPOSITORY_ID,
  repository_owner_id: environment.SAI_NOTIFICATION_CRON_OWNER_ID,
  workflow_ref: "kreativ-works/sai-calendar/.github/workflows/notifications.yml@refs/heads/main",
  ref: "refs/heads/main", event_name: "schedule",
};
async function token(overrides = {}, omitted = []) {
  const payload = { ...baseline, ...overrides };
  for (const claim of omitted) delete payload[claim];
  return new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "JWT" }).sign(privateKey);
}
async function verified(overrides = {}, omitted = [], env = environment) {
  return verifyGithubNotificationCronToken(await token(overrides, omitted), env, keys, now);
}

test("Notification cron accepts only the expected signed scheduled or manual main workflow", async () => {
  assert.equal(await verified(), true);
  assert.equal(await verified({ event_name: "workflow_dispatch" }), true);
  // Immutable IDs are checked directly, independently of GitHub subject formats.
  assert.equal(await verified({ sub: "repo:kreativ-works/sai-calendar:ref:refs/heads/main" }), true);
});

test("Notification cron rejects another audience, issuer or repository owner/name", async () => {
  for (const change of [
    { aud: "https://other.example/notifications" },
    { aud: [baseline.aud, "https://other.example"] },
    { iss: "https://attacker.example" },
    { repository: "another-owner/sai-calendar" },
    { repository_owner: "another-owner" },
    { repository: "kreativ-works/another-repo" },
  ]) assert.equal(await verified(change), false);
});

test("Notification cron pins immutable repository and owner IDs with fail-closed runtime configuration", async () => {
  for (const change of [{ repository_id: "123456788" }, { repository_owner_id: "987654320" }, { repository_id: 123456789 }]) assert.equal(await verified(change), false);
  for (const env of [{}, { ...environment, SAI_NOTIFICATION_CRON_REPOSITORY_ID: "" }, { ...environment, SAI_NOTIFICATION_CRON_OWNER_ID: " 987654321" }, { ...environment, SAI_NOTIFICATION_CRON_OWNER_ID: 987654321 }]) assert.equal(await verified({}, [], env), false);
});

test("Notification cron rejects forks, alternate files/branches and unapproved trigger events", async () => {
  for (const change of [
    { workflow_ref: "kreativ-works/sai-calendar/.github/workflows/another.yml@refs/heads/main" },
    { workflow_ref: "kreativ-works/sai-calendar/.github/workflows/notifications.yml@refs/heads/feature" },
    { workflow_ref: "fork/sai-calendar/.github/workflows/notifications.yml@refs/heads/main" },
    { ref: "refs/heads/feature" }, { ref: "refs/pull/1/merge" },
    { event_name: "push" }, { event_name: "pull_request" }, { event_name: "pull_request_target" }, { event_name: "workflow_call" },
  ]) assert.equal(await verified(change), false);
});

test("Notification cron rejects stale, expired, future, long-lived and incomplete claims", async () => {
  for (const change of [
    { exp: now }, { iat: now - 601 }, { iat: now + 6 },
    { nbf: now + 6 }, { exp: baseline.iat + 601 },
    { iat: "invalid" }, { exp: "invalid" }, { sub: "" },
  ]) assert.equal(await verified(change), false);
  for (const claim of ["exp", "iat", "sub", "repository_id", "repository_owner_id", "workflow_ref", "ref", "event_name"]) assert.equal(await verified({}, [claim]), false);
});

test("Notification cron rejects forged, unsigned and symmetric signatures", async () => {
  const otherKeys = await generateKeyPair("RS256");
  const forged = await new SignJWT(baseline).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(otherKeys.privateKey);
  assert.equal(await verifyGithubNotificationCronToken(forged, environment, keys, now), false);
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(baseline)).toString("base64url")}.`;
  assert.equal(await verifyGithubNotificationCronToken(unsigned, environment, keys, now), false);
  const symmetric = await new SignJWT(baseline).setProtectedHeader({ alg: "HS256", kid: jwk.kid }).sign(new Uint8Array(32).fill(1));
  assert.equal(await verifyGithubNotificationCronToken(symmetric, environment, keys, now), false);
});

test("Notification cron rejects malformed and oversized bearer requests before network access", async () => {
  for (const authorization of [null, "", "Basic abc", "Bearer abc", "Bearer a.b.", "Bearer a.b.c extra", `Bearer ${"x".repeat(8193)}`]) {
    const request = new Request("https://sai.example.test/api/internal/notifications/dispatch", { method: "POST", headers: authorization === null ? {} : { Authorization: authorization } });
    assert.equal(await verifyGithubNotificationCron(request, environment), false);
  }
  assert.equal(await verifyGithubNotificationCronToken("x".repeat(8193), environment, keys, now), false);
  assert.equal(await verifyGithubNotificationCronToken(await token(), {}, keys, now), false);
});
