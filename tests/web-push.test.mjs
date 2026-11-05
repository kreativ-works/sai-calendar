import assert from 'node:assert/strict';
import test from 'node:test';
import { createECDH, hkdfSync, createDecipheriv } from 'node:crypto';
import { generateKeyPair, exportJWK, jwtVerify } from 'jose';
import { encryptWebPush, getPublicPushConfig, isAllowedPushEndpoint, parsePushSubscription, sendWebPush } from '../lib/server/web-push.ts';

function subscription() {
  const client = createECDH('prime256v1'); client.generateKeys();
  return { client, value: { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-test', keys: { p256dh: client.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') } } };
}
async function environment() {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(pair.privateKey);
  return { pair, env: { SAI_WEB_PUSH_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'), SAI_WEB_PUSH_PRIVATE_JWK: JSON.stringify(jwk), SAI_WEB_PUSH_SUBJECT: 'mailto:hello@kreativ.works', SAI_NOTIFICATION_CRON_REPOSITORY_ID: '1446425062', SAI_NOTIFICATION_CRON_OWNER_ID: '352708191' } };
}
test('Web Push refuses arbitrary, loopback, credentialed and redirected targets', () => {
  for (const url of ['http://fcm.googleapis.com/send/x', 'https://fcm.googleapis.com.evil.test/send/x', 'https://127.0.0.1/send/x', 'https://metadata.google.internal/x', 'https://user:pass@fcm.googleapis.com/send/x', 'https://web.push.apple.com:8080/x', 'https://web.push.apple.com/x#secret', 'https://fcm.googleapis.com/']) assert.equal(isAllowedPushEndpoint(url), false);
  for (const url of ['https://web.push.apple.com/QPush/opaque', 'https://updates.push.services.mozilla.com/wpush/v2/opaque', 'https://fcm.googleapis.com/fcm/send/opaque', 'https://wns2-a.notify.windows.com/w/?token=opaque']) assert.equal(isAllowedPushEndpoint(url), true);
});
test('Subscriptions require a valid curve point and exact authentication secret', async () => {
  const { value } = subscription(); assert.deepEqual(await parsePushSubscription(value), value);
  for (const bad of [{ ...value, endpoint: 'https://example.com/private' }, { ...value, keys: { ...value.keys, p256dh: Buffer.alloc(65, 4).toString('base64url') } }, { ...value, keys: { ...value.keys, auth: 'short' } }, { ...value, expirationTime: 1 }]) await assert.rejects(parsePushSubscription(bad), { code: 'INVALID_PUSH_SUBSCRIPTION' });
});
test('RFC8291 encrypted record decrypts using independent Node crypto recipient', async () => {
  const { client, value } = subscription(); const message = '사이 알림 · 저녁 약속';
  const record = Buffer.from(await encryptWebPush(value, message));
  assert.equal(record.readUInt32BE(16), 4096); assert.equal(record[20], 65);
  const serverPublic = record.subarray(21, 86); const shared = client.computeSecret(serverPublic);
  const input = Buffer.from(hkdfSync('sha256', shared, Buffer.from(value.keys.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), client.getPublicKey(), serverPublic]), 32));
  const salt = record.subarray(0, 16);
  const key = hkdfSync('sha256', input, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', input, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createDecipheriv('aes-128-gcm', key, nonce); cipher.setAuthTag(record.subarray(-16));
  const plain = Buffer.concat([cipher.update(record.subarray(86, -16)), cipher.final()]);
  assert.equal(plain.at(-1), 2); assert.equal(plain.subarray(0, -1).toString(), message);
});
test('VAPID is signed for exact push service; no cookies, manual redirects and bounded TTL', async () => {
  const { env, pair } = await environment(); const { value } = subscription();
  assert.equal(getPublicPushConfig(env).configured, true);
  assert.equal(getPublicPushConfig({ ...env, SAI_WEB_PUSH_PRIVATE_JWK: '{}' }).configured, false);
  const result = await sendWebPush(value, { title: '사이', body: '알림', url: '/app', tag: 'one', ttlSeconds: 600 }, env, async (url, init) => {
    assert.equal(url, value.endpoint); assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.TTL, '600'); assert.equal(init.headers.Cookie, undefined);
    const token = /^vapid t=([^,]+), k=/.exec(init.headers.Authorization)[1];
    const { payload } = await jwtVerify(token, pair.publicKey, { audience: 'https://fcm.googleapis.com', algorithms: ['ES256'] });
    assert.equal(payload.sub, 'mailto:hello@kreativ.works'); assert.ok(payload.exp < Date.now() / 1000 + 86400);
    return new Response(null, { status: 201 });
  }); assert.deepEqual(result, { ok: true, gone: false, retryable: false });
});
test('Gone subscriptions, retryable failures and redirects have distinct delivery outcomes', async () => {
  const { env } = await environment(); const { value } = subscription();
  const message = { title: '사이', body: '알림', url: '/app', tag: 'two' };
  for (const [status, expected] of [[410, { ok: false, gone: true, retryable: false }], [429, { ok: false, gone: false, retryable: true }], [503, { ok: false, gone: false, retryable: true }], [302, { ok: false, gone: false, retryable: false }]]) assert.deepEqual(await sendWebPush(value, message, env, async () => new Response(null, { status })), expected);
});
