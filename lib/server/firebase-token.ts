import { decodeJwt, decodeProtectedHeader, importX509, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";
import type { FirebaseConfig } from "./firebase-config";

const CERTIFICATES_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

export class FirebaseTokenError extends Error {
  code: "INVALID_TOKEN" | "EMAIL_UNVERIFIED" | "AUTH_UNAVAILABLE";
  constructor(code: FirebaseTokenError["code"], message: string) { super(message); this.code = code; }
}

export type FirebaseIdentity = {
  subject: string;
  email: string;
  name: string | null;
  expiresAt: number;
  authenticatedAt: number;
};

type CertificateCache = { expiresAt: number; fetchedAt: number; certificates: Record<string, string> };
let certificateCache: CertificateCache | null = null;
let certificateRequest: Promise<CertificateCache> | null = null;
const importedKeys = new Map<string, Promise<CryptoKey>>();

async function certificates(forceRefresh = false): Promise<CertificateCache> {
  if (certificateCache && ((!forceRefresh && certificateCache.expiresAt > Date.now()) || (forceRefresh && certificateCache.fetchedAt > Date.now() - 30_000))) return certificateCache;
  if (!certificateRequest) certificateRequest = (async () => {
    try {
      // Workers support follow/manual redirects. Manual plus the success check
      // below rejects redirects without forwarding requests to another origin.
      const response = await fetch(CERTIFICATES_URL, { signal: AbortSignal.timeout(8_000), redirect: "manual" });
      if (!response.ok) throw new Error();
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
      const result: Record<string, string> = {};
      for (const [kid, certificate] of Object.entries(payload)) {
        if (typeof certificate !== "string" || !certificate.includes("BEGIN CERTIFICATE")) throw new Error();
        result[kid] = certificate;
      }
      if (!Object.keys(result).length) throw new Error();
      const maxAge = Number(/(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 300);
      certificateCache = { certificates: result, fetchedAt: Date.now(), expiresAt: Date.now() + Math.min(Math.max(maxAge, 0), 86_400) * 1000 };
      importedKeys.clear();
      return certificateCache;
    } catch { throw new FirebaseTokenError("AUTH_UNAVAILABLE", "로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."); }
    finally { certificateRequest = null; }
  })();
  return certificateRequest;
}

const googleKey: JWTVerifyGetKey = async (header) => {
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) throw new FirebaseTokenError("INVALID_TOKEN", "로그인 정보를 확인하지 못했어요. 다시 로그인해 주세요.");
  let found = (await certificates()).certificates[header.kid];
  // A newly rotated signing key may arrive before a previously cached response
  // expires. Refresh once, bounded to one refresh per 30 seconds for unknown IDs.
  if (!found) found = (await certificates(true)).certificates[header.kid];
  if (!found) throw new FirebaseTokenError("INVALID_TOKEN", "로그인 정보가 만료되었어요. 다시 로그인해 주세요.");
  let key = importedKeys.get(header.kid);
  if (!key) {
    key = importX509(found, "RS256");
    importedKeys.set(header.kid, key);
  }
  return key;
};

function validateClaims(payload: JWTPayload, projectId: string, now: number): FirebaseIdentity {
  if (payload.iss !== `https://securetoken.google.com/${projectId}` || payload.aud !== projectId || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 || typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now || typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || payload.iat > now || typeof payload.auth_time !== "number" || !Number.isFinite(payload.auth_time) || payload.auth_time > now || payload.auth_time > payload.iat || payload.auth_time < 0) {
    throw new FirebaseTokenError("INVALID_TOKEN", "로그인 정보가 만료되었어요. 다시 로그인해 주세요.");
  }
  if (payload.email_verified !== true) throw new FirebaseTokenError("EMAIL_UNVERIFIED", "이메일 인증을 완료하면 캘린더를 사용할 수 있어요.");
  if (typeof payload.email !== "string" || !payload.email || payload.email.length > 320) throw new FirebaseTokenError("INVALID_TOKEN", "이메일을 확인하지 못했어요. 다시 로그인해 주세요.");
  return { subject: payload.sub, email: payload.email, name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 150) : null, expiresAt: payload.exp, authenticatedAt: payload.auth_time };
}

// A pure verifier with an injectable trusted key resolver for signed-token tests.
// Production callers use the fixed Google certificate resolver below.
export async function verifyFirebaseJwt(token: string, projectId: string, key: JWTVerifyGetKey = googleKey, now = Math.floor(Date.now() / 1000)): Promise<FirebaseIdentity> {
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) throw new Error();
    const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"], issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, requiredClaims: ["sub", "exp", "iat", "auth_time"], currentDate: new Date(now * 1000) });
    return validateClaims(payload, projectId, now);
  } catch (error) {
    if (error instanceof FirebaseTokenError) throw error;
    throw new FirebaseTokenError("INVALID_TOKEN", "로그인 정보를 확인하지 못했어요. 다시 로그인해 주세요.");
  }
}

type AccountRecord = { localId?: unknown; email?: unknown; emailVerified?: unknown; disabled?: unknown; validSince?: unknown; displayName?: unknown };

export function validateFirebaseAccount(identity: FirebaseIdentity, account: AccountRecord): FirebaseIdentity {
  const revokedBefore = account.validSince === undefined ? 0 : Number(account.validSince);
  if (account.localId !== identity.subject || account.disabled === true || !Number.isFinite(revokedBefore) || revokedBefore < 0 || identity.authenticatedAt < revokedBefore || account.email !== identity.email) throw new FirebaseTokenError("INVALID_TOKEN", "계정 정보가 변경되었어요. 다시 로그인해 주세요.");
  if (account.emailVerified !== true) throw new FirebaseTokenError("EMAIL_UNVERIFIED", "이메일 인증을 완료하면 캘린더를 사용할 수 있어요.");
  return { ...identity, name: typeof account.displayName === "string" && account.displayName.trim() ? account.displayName.trim().slice(0, 150) : identity.name };
}

async function lookupAccount(token: string, config: FirebaseConfig, identity: FirebaseIdentity, emulatorUrl: string | null): Promise<FirebaseIdentity> {
  const base = emulatorUrl ? `${emulatorUrl}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
  try {
    const response = await fetch(`${base}/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(8_000), redirect: "manual" });
    if (response.status === 400 || response.status === 401) throw new FirebaseTokenError("INVALID_TOKEN", "로그인 정보가 만료되었어요. 다시 로그인해 주세요.");
    if (!response.ok) throw new Error();
    const result = await response.json() as { users?: AccountRecord[] };
    if (!Array.isArray(result.users) || result.users.length !== 1) throw new FirebaseTokenError("INVALID_TOKEN", "계정을 확인하지 못했어요. 다시 로그인해 주세요.");
    return validateFirebaseAccount(identity, result.users[0]);
  } catch (error) {
    if (error instanceof FirebaseTokenError) throw error;
    throw new FirebaseTokenError("AUTH_UNAVAILABLE", "로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}

export async function verifyFirebaseIdToken(token: string, config: FirebaseConfig, emulatorUrl: string | null = null): Promise<FirebaseIdentity> {
  let identity: FirebaseIdentity;
  const activeEmulator = import.meta.env.DEV ? emulatorUrl : null;
  // The emulator URL is supplied only by getFirebaseEmulatorUrl, which is
  // compile-time disabled in production and requires both hosts to be loopback.
  if (import.meta.env.DEV && activeEmulator) {
    try {
      if (decodeProtectedHeader(token).alg !== "none") throw new Error();
      identity = validateClaims(decodeJwt(token), config.projectId, Math.floor(Date.now() / 1000));
    } catch (error) {
      if (error instanceof FirebaseTokenError) throw error;
      throw new FirebaseTokenError("INVALID_TOKEN", "테스트 로그인 정보를 확인하지 못했어요.");
    }
  } else identity = await verifyFirebaseJwt(token, config.projectId);
  return lookupAccount(token, config, identity, activeEmulator);
}
