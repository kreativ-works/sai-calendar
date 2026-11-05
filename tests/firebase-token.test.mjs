import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { FirebaseTokenError, validateFirebaseAccount, verifyFirebaseJwt } from "../lib/server/firebase-token.ts";

const project = "sai-auth-tests";
const now = Math.floor(Date.now() / 1000);
const { privateKey, publicKey } = await generateKeyPair("RS256");
const key = { ...await exportJWK(publicKey), kid: "test-google-key", alg: "RS256", use: "sig" };
const resolver = createLocalJWKSet({ keys: [key] });
const baseline = { sub: "firebase-uid-1", email: "test@example.com", email_verified: true, name: "사이", auth_time: now - 60, iat: now - 30, exp: now + 3_000, aud: project, iss: `https://securetoken.google.com/${project}` };
async function token(overrides = {}, omit = []) {
  const claims = { ...baseline, ...overrides };
  for (const field of omit) delete claims[field];
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: key.kid }).sign(privateKey);
}
const reject = async (value, code = "INVALID_TOKEN") => assert.rejects(() => verifyFirebaseJwt(value, project, resolver, now), (error) => error instanceof FirebaseTokenError && error.code === code);

test("Firebase signed token yields the verified subject and profile", async () => {
  assert.deepEqual(await verifyFirebaseJwt(await token(), project, resolver, now), { subject: baseline.sub, email: baseline.email, name: baseline.name, expiresAt: baseline.exp, authenticatedAt: baseline.auth_time });
});

test("Firebase token rejects another project's audience and issuer", async () => {
  await reject(await token({ aud: "other-project" }));
  await reject(await token({ iss: "https://securetoken.google.com/other-project" }));
});

test("Firebase token rejects expiration, missing claims and future authentication", async () => {
  await reject(await token({ exp: now }));
  await reject(await token({}, ["exp"]));
  await reject(await token({}, ["auth_time"]));
  await reject(await token({ iat: now + 1 }));
  await reject(await token({ auth_time: now + 1 }));
  await reject(await token({ auth_time: now - 10, iat: now - 30 }));
  await reject(await token({ sub: "" }));
});

test("Firebase token requires a verified email", async () => {
  await reject(await token({ email_verified: false }), "EMAIL_UNVERIFIED");
  await reject(await token({}, ["email_verified"]), "EMAIL_UNVERIFIED");
  await reject(await token({}, ["email"]));
});

test("Firebase token rejects forged signatures and unsigned or symmetric tokens", async () => {
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT(baseline).setProtectedHeader({ alg: "RS256", kid: key.kid }).sign(other.privateKey);
  await reject(forged);
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(baseline)).toString("base64url")}.`;
  await reject(unsigned);
  const symmetric = await new SignJWT(baseline).setProtectedHeader({ alg: "HS256", kid: key.kid }).sign(new Uint8Array(32).fill(1));
  await reject(symmetric);
});

test("Firebase current account rejects revocation, disabled, deleted or changed-email identities", async () => {
  const identity = await verifyFirebaseJwt(await token(), project, resolver, now);
  const account = { localId: identity.subject, email: identity.email, emailVerified: true, validSince: String(now - 100) };
  assert.equal(validateFirebaseAccount(identity, account).subject, identity.subject);
  for (const override of [{ disabled: true }, { validSince: String(now - 10) }, { localId: "someone-else" }, { email: "changed@example.com" }, { validSince: "invalid" }]) {
    assert.throws(() => validateFirebaseAccount(identity, { ...account, ...override }), (error) => error instanceof FirebaseTokenError && error.code === "INVALID_TOKEN");
  }
  assert.throws(() => validateFirebaseAccount(identity, { ...account, emailVerified: false }), (error) => error instanceof FirebaseTokenError && error.code === "EMAIL_UNVERIFIED");
});
