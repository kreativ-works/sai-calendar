import { env } from "cloudflare:workers";
import { cookies, headers } from "next/headers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { CalendarError } from "../domain/calendar";
import { getFirebaseConfig, getFirebaseEmulatorUrl, isLoopbackHost } from "./firebase-config";
import { FirebaseTokenError, verifyFirebaseIdToken, type FirebaseIdentity } from "./firebase-token";
import { tokenFingerprint, type ServerSessionBootstrap } from "../client/session-bootstrap";

export type AppUser = { userId: string; displayName: string; email: string; fullName: string | null };
type AppSession = { user: AppUser; identity: FirebaseIdentity; provider: string };
export const APP_SESSION_COOKIE = "sai_session";
const AUTH_HEADERS = { "Cache-Control": "no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };

function database(): D1Database {
  if (!env.DB) throw new CalendarError(503, "DATABASE_UNAVAILABLE", "공유 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return env.DB;
}

function authError(error: unknown): CalendarError {
  if (error instanceof CalendarError) return error;
  if (error instanceof FirebaseTokenError) return new CalendarError(error.code === "AUTH_UNAVAILABLE" ? 503 : error.code === "EMAIL_UNVERIFIED" ? 403 : 401, error.code, error.message);
  return new CalendarError(503, "AUTH_UNAVAILABLE", "로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
}

async function sessionForToken(token: string, requestUrl: string, createIdentity: boolean): Promise<AppSession> {
  const config = getFirebaseConfig();
  if (!config) throw new CalendarError(503, "AUTH_NOT_CONFIGURED", "로그인 서비스를 준비하고 있어요. 잠시 후 다시 방문해 주세요.");
  const identity = await verifyFirebaseIdToken(token, config, getFirebaseEmulatorUrl(requestUrl));
  const db = database();
  const provider = `firebase:${config.projectId}`;
  if (createIdentity) await db.prepare("INSERT INTO auth_identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(provider, subject) DO NOTHING").bind(provider, identity.subject, crypto.randomUUID(), new Date().toISOString()).run();
  const mapping = await db.prepare("SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?").bind(provider, identity.subject).first<{ user_id: string }>();
  if (!mapping) throw new CalendarError(401, "SIGN_IN_REQUIRED", "다시 로그인하면 캘린더를 사용할 수 있어요.");
  return { provider, identity, user: { userId: mapping.user_id, email: identity.email, fullName: identity.name, displayName: identity.name ?? identity.email.split("@")[0] } };
}

async function readSession(): Promise<AppSession | null> {
  const cookie = (await cookies()).get(APP_SESSION_COOKIE)?.value;
  if (!cookie || cookie.length > 7_000 || !getFirebaseConfig()) return null;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "invalid.local";
  try { return await sessionForToken(cookie, `http://${host}/`, false); }
  catch (error) {
    const converted = authError(error);
    if (converted.status === 401 || converted.status === 403) return null;
    throw converted;
  }
}

async function checkedSession(): Promise<AppSession | null> {
  const session = await readSession();
  const user = session?.user ?? null;
  const expectedUser = (await headers()).get("X-Sai-Expected-User");
  // A restored cookie may belong to a different account after another tab signs
  // in. Never apply a request authored in the previous account's calendar there.
  if (user && expectedUser !== null && (expectedUser.length > 128 || expectedUser !== user.userId)) {
    throw new CalendarError(409, "SESSION_CHANGED", "다른 계정으로 전환됐어요. 새로고침한 후 다시 시도해 주세요.");
  }
  return session;
}

export async function getAppUser(): Promise<AppUser | null> {
  return (await checkedSession())?.user ?? null;
}

/** Exposes only a digest of the already verified cookie, never the bearer token. */
export async function getAppAccess(): Promise<{ user: AppUser; bootstrap: ServerSessionBootstrap } | null> {
  const session = await checkedSession();
  if (!session) return null;
  const cookie = (await cookies()).get(APP_SESSION_COOKIE)?.value;
  if (!cookie) return null;
  return { user: session.user, bootstrap: { subject: session.identity.subject, expiresAt: session.identity.expiresAt, tokenFingerprint: await tokenFingerprint(cookie) } };
}

export async function hasLegacyCalendar(user: AppUser): Promise<boolean> {
  const legacy = await getChatGPTUser();
  const config = getFirebaseConfig();
  if (!legacy || !config || legacy.userId === user.userId) return false;
  const row = await database().prepare("SELECT user_id FROM members WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM members WHERE user_id = ?) AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE provider = ? AND user_id = ?)").bind(legacy.userId, user.userId, `firebase:${config.projectId}`, legacy.userId).first();
  return !!row;
}

export function authJson(value: unknown, status = 200, setCookie?: string): Response {
  return Response.json(value, { status, headers: { ...AUTH_HEADERS, ...(setCookie ? { "Set-Cookie": setCookie } : {}) } });
}

async function discardUnreadBody(request: Request): Promise<void> {
  if (!request.body || request.bodyUsed) return;
  const reader = request.body.getReader();
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 8_192) { await reader.cancel(); break; }
    }
  } catch { /* A disconnected client must not change the API response. */ }
  finally { reader.releaseLock(); }
}

export async function authApi(request: Request, action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    const converted = authError(error);
    return authJson({ error: { code: converted.code, message: converted.message } }, converted.status);
  } finally { await discardUnreadBody(request); }
}

export async function authBody(request: Request): Promise<Record<string, unknown>> {
  // Session creation and linking are same-origin only, including login CSRF.
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new CalendarError(403, "ORIGIN_DENIED", "사이 로그인 화면에서 다시 시도해 주세요.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new CalendarError(415, "JSON_REQUIRED", "올바른 형식으로 다시 시도해 주세요.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 8_192) throw new CalendarError(413, "BODY_TOO_LARGE", "로그인 요청이 너무 길어요.");
  if (!request.body) throw new CalendarError(422, "INVALID_JSON", "입력 내용을 확인해 주세요.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "", length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 8_192) { await reader.cancel(); throw new CalendarError(413, "BODY_TOO_LARGE", "로그인 요청이 너무 길어요."); }
      text += decoder.decode(result.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new CalendarError(422, "INVALID_JSON", "입력 내용을 확인해 주세요."); }
}

function cookieFor(request: Request, token: string, expiresAt: number): string {
  const url = new URL(request.url);
  const secure = !(url.protocol === "http:" && isLoopbackHost(url.hostname));
  const maxAge = token ? Math.max(0, Math.min(3_600, Math.floor(expiresAt - Date.now() / 1000))) : 0;
  return `${APP_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function createAppSession(request: Request): Promise<Response> {
  const body = await authBody(request);
  if (typeof body.idToken !== "string" || !body.idToken || body.idToken.length > 7_000) throw new CalendarError(422, "INVALID_TOKEN", "로그인 정보를 확인하지 못했어요. 다시 로그인해 주세요.");
  const session = await sessionForToken(body.idToken, request.url, true);
  return authJson({ user: { id: session.user.userId, name: session.user.displayName, email: session.user.email }, legacyAvailable: await hasLegacyCalendar(session.user) }, 200, cookieFor(request, body.idToken, session.identity.expiresAt));
}

export async function readAppSession(): Promise<Response> {
  const user = await getAppUser();
  return authJson({ user: user ? { id: user.userId, name: user.displayName, email: user.email } : null, legacyAvailable: user ? await hasLegacyCalendar(user) : false });
}

export async function deleteAppSession(request: Request): Promise<Response> {
  await authBody(request);
  return authJson({ ok: true }, 200, cookieFor(request, "", 0));
}

export async function linkLegacyCalendar(request: Request): Promise<Response> {
  await authBody(request);
  const session = await readSession();
  if (!session) throw new CalendarError(401, "SIGN_IN_REQUIRED", "새 계정으로 로그인한 후 다시 시도해 주세요.");
  const legacy = await getChatGPTUser();
  if (!legacy) throw new CalendarError(401, "LEGACY_SIGN_IN_REQUIRED", "기존 캘린더를 가져오려면 이전 계정도 확인해 주세요.");
  if (Date.now() / 1000 - session.identity.authenticatedAt > 300) throw new CalendarError(401, "REAUTHENTICATION_REQUIRED", "안전하게 가져오려면 새 계정으로 다시 로그인해 주세요.");
  const db = database();
  if (legacy.userId === session.user.userId) return authJson({ ok: true });
  try {
    const result = await db.prepare("UPDATE auth_identities SET user_id = ? WHERE provider = ? AND subject = ? AND user_id = ? AND EXISTS (SELECT 1 FROM members WHERE user_id = ?) AND NOT EXISTS (SELECT 1 FROM members WHERE user_id = ?) AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE provider = ? AND user_id = ? AND subject != ?)").bind(legacy.userId, session.provider, session.identity.subject, session.user.userId, legacy.userId, session.user.userId, session.provider, legacy.userId, session.identity.subject).run();
    if (!result.meta.changes) throw new Error();
  } catch { throw new CalendarError(409, "LEGACY_LINK_CONFLICT", "이미 다른 캘린더에 연결되어 있거나 기존 캘린더를 가져올 수 없어요. 새로고침 후 확인해 주세요."); }
  return authJson({ ok: true });
}
