import assert from "node:assert/strict";
import test from "node:test";
import { canReuseServerBootstrap, hasActiveBootstrapIntent, isFreshServerBootstrap, tokenFingerprint } from "../lib/client/session-bootstrap.ts";

const now = 1_800_000_000;
const identity = { uid: "synthetic-firebase-user", emailVerified: true };
const token = "synthetic.id.token.not-a-credential";
const bootstrap = async (overrides = {}) => ({ subject: identity.uid, expiresAt: now + 3600, tokenFingerprint: await tokenFingerprint(token), ...overrides });

test("a fresh SSR hint reuses only the exact SDK token and contains no bearer credential", async () => {
  const value = await bootstrap();
  assert.equal(value.tokenFingerprint.length, 64);
  assert.equal(JSON.stringify(value).includes(token), false);
  let tokenReads = 0;
  assert.equal(await canReuseServerBootstrap(value, identity, { now: () => now, active: () => true, token: async () => { tokenReads++; return token; } }), true);
  assert.equal(tokenReads, 1);
  assert.equal(await canReuseServerBootstrap(value, identity, { now: () => now, active: () => true, token: async () => "new.synthetic.token" }), false);
});

test("account changes, absent/unverified SDK identities and expired hints take the normal sync path", async () => {
  const value = await bootstrap();
  const options = { now: () => now, active: () => true, token: async () => { throw new Error("Must not read an ineligible identity's token"); } };
  for (const user of [null, { ...identity, uid: "another-firebase-user" }, { ...identity, emailVerified: false }]) {
    assert.equal(await canReuseServerBootstrap(value, user, options), false);
  }
  for (const invalid of [undefined, { ...value, subject: "" }, { ...value, tokenFingerprint: "invalid" }, { ...value, expiresAt: now + 300 }, { ...value, expiresAt: now - 1 }]) {
    assert.equal(isFreshServerBootstrap(invalid, now), false);
    assert.equal(await canReuseServerBootstrap(invalid, identity, options), false);
  }
});

test("logout, blocked generations and account-switch intents prevent reuse before and during token reads", async () => {
  const value = await bootstrap();
  let active = false, reads = 0;
  const options = { now: () => now, active: () => active, token: async () => { reads++; active = false; return token; } };
  assert.equal(await canReuseServerBootstrap(value, identity, options), false);
  assert.equal(reads, 0);
  active = true;
  assert.equal(await canReuseServerBootstrap(value, identity, options), false);
  assert.equal(reads, 1);
});

test("the live logout and account generation gate rejects an old bootstrap after any account transition", () => {
  const before = { userId: "app-alice", version: 1, changing: false };
  const intent = { logout: false, blocked: false, context: before };
  assert.equal(hasActiveBootstrapIntent(intent, before), true);
  for (const changed of [
    { ...intent, logout: true },
    { ...intent, blocked: true },
    { ...intent, context: { ...before, changing: true } },
    { ...intent, context: { ...before, version: 2 } },
    { ...intent, context: { ...before, userId: "app-bob" } },
    { ...intent, context: { ...before, userId: null } },
  ]) assert.equal(hasActiveBootstrapIntent(changed, before), false);
});

test("a hint expiring while the SDK resolves cannot bypass the normal server synchronization", async () => {
  const value = await bootstrap();
  let current = now;
  assert.equal(await canReuseServerBootstrap(value, identity, { now: () => current, active: () => true, token: async () => { current = value.expiresAt; return token; } }), false);
});
