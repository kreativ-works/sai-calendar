import { importJWK, SignJWT, type JWK } from "jose";
import { CalendarError } from "../domain/calendar.ts";
import type { PushPayload, WebPushSubscription } from "../domain/notifications.ts";

type Environment = object;
const encoder = new TextEncoder();
const read = (env: Environment, name: string): string => {
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
};
const concat = (...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
};
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

// Push subscription URLs are bearer capabilities, never arbitrary fetch targets.
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const allowed = host === "fcm.googleapis.com" || host === "web.push.apple.com"
      || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com")
      || host.endsWith(".notify.windows.com");
    return allowed && url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443") && url.pathname !== "/";
  } catch { return false; }
}

export async function parsePushSubscription(value: unknown): Promise<WebPushSubscription> {
  const invalid = (): never => { throw new CalendarError(422, "INVALID_PUSH_SUBSCRIPTION", "이 기기의 알림 연결을 다시 시작해 주세요."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  if (!isAllowedPushEndpoint(data.endpoint) || !data.keys || typeof data.keys !== "object") return invalid();
  const keys = data.keys as Record<string, unknown>;
  try {
    if (typeof keys.p256dh !== "string" || keys.p256dh.length !== 87 || typeof keys.auth !== "string" || keys.auth.length !== 22) return invalid();
    const publicKey = decode(keys.p256dh);
    if (publicKey.length !== 65 || publicKey[0] !== 4 || decode(keys.auth).length !== 16) return invalid();
    await crypto.subtle.importKey("raw", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
    if (data.expirationTime != null && (typeof data.expirationTime !== "number" || !Number.isFinite(data.expirationTime) || data.expirationTime <= Date.now())) return invalid();
  } catch { return invalid(); }
  return { endpoint: data.endpoint, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string }, ...(data.expirationTime === undefined ? {} : { expirationTime: data.expirationTime as number | null }) };
}

function vapidConfig(env: Environment): { publicKey: string; privateJwk: JWK; subject: string } | null {
  try {
    const publicKey = read(env, "SAI_WEB_PUSH_PUBLIC_KEY");
    const raw = decode(publicKey);
    const privateJwk = JSON.parse(read(env, "SAI_WEB_PUSH_PRIVATE_JWK")) as JWK;
    const subject = read(env, "SAI_WEB_PUSH_SUBJECT");
    if (raw.length !== 65 || raw[0] !== 4 || privateJwk.kty !== "EC" || privateJwk.crv !== "P-256" || !privateJwk.d || !privateJwk.x || !privateJwk.y || !/^mailto:[^\s@]+@[^\s@]+$/.test(subject)) return null;
    if (privateJwk.x !== publicKeyPart(raw.slice(1, 33)) || privateJwk.y !== publicKeyPart(raw.slice(33))) return null;
    return { publicKey, privateJwk, subject };
  } catch { return null; }
}
function publicKeyPart(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function getPublicPushConfig(env: Environment) {
  const config = vapidConfig(env);
  return {
    configured: !!config,
    publicKey: config?.publicKey ?? null,
    schedulerReady: /^\d+$/.test(read(env, "SAI_NOTIFICATION_CRON_REPOSITORY_ID")) && /^\d+$/.test(read(env, "SAI_NOTIFICATION_CRON_OWNER_ID")),
  };
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, input: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", input, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// RFC 8291, one aes128gcm record. VAPID and encryption use independent keys.
export async function encryptWebPush(subscription: WebPushSubscription, payload: string): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = encoder.encode(payload);
  if (plaintext.length > 3000) throw new Error("Push payload too large");
  const uaPublic = decode(subscription.keys.p256dh);
  const auth = decode(subscription.keys.auth);
  const recipient = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: recipient }, pair.privateKey, 256));
  const input = await hkdf(auth, shared, concat(encoder.encode("WebPush: info\0"), uaPublic, serverPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyBytes = await hkdf(salt, input, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, input, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = serverPublic.length;
  return concat(header, serverPublic, encrypted);
}

export async function sendWebPush(subscription: WebPushSubscription, payload: PushPayload, env: Environment, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; gone: boolean; retryable: boolean }> {
  const config = vapidConfig(env);
  if (!config || !isAllowedPushEndpoint(subscription.endpoint)) return { ok: false, gone: false, retryable: false };
  try {
    const privateKey = await importJWK(config.privateJwk, "ES256");
    const token = await new SignJWT({ sub: config.subject }).setProtectedHeader({ typ: "JWT", alg: "ES256" })
      .setAudience(new URL(subscription.endpoint).origin).setExpirationTime(Math.floor(Date.now() / 1000) + 3600).sign(privateKey);
    const encrypted = await encryptWebPush(subscription, JSON.stringify(payload));
    const response = await fetcher(subscription.endpoint, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `vapid t=${token}, k=${config.publicKey}`, "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm", TTL: String(Math.min(3600, Math.max(0, Math.floor(payload.ttlSeconds ?? 3600)))), Urgency: "normal" },
      body: encrypted,
    });
    await response.body?.cancel();
    return { ok: response.ok, gone: response.status === 404 || response.status === 410, retryable: response.status === 429 || response.status >= 500 };
  } catch { return { ok: false, gone: false, retryable: true }; }
}
