"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, browserPopupRedirectResolver, connectAuthEmulator, getAuth, getRedirectResult, indexedDBLocalPersistence, initializeAuth, signOut, type Auth, type User, type UserCredential } from "firebase/auth";
import { disconnectDevicePushBeforeLogout } from "./push-logout";
import { api } from "./api";
import { createSessionCoordinator, SessionCancelledError, type RestorationResult } from "./session-coordinator";
import { announceSessionChange, bindSessionContext, captureSessionContext, invalidateSessionContext } from "./session-context";

export type AuthConfiguration = {
  configured: boolean;
  firebase: { apiKey: string; authDomain: string; projectId: string; appId: string } | null;
  providers: { email: boolean; google: boolean };
  emulatorUrl?: string;
};

export type SessionResult = {
  user: { id: string; name: string; email: string | null } | null;
  legacyAvailable: boolean;
};

let configurationPromise: Promise<AuthConfiguration> | null = null;
let authPromise: Promise<Auth | null> | null = null;
let emulatorConnected = false;
const redirectResults = new WeakMap<Auth, Promise<UserCredential | null>>();

export function normalizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/app";
  try {
    const url = new URL(value, "https://sai.invalid");
    if (url.origin !== "https://sai.invalid" || ["/login", "/signup", "/forgot-password", "/logout", "/auth/action"].includes(url.pathname)) return "/app";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/app"; }
}

export function authPageHref(path: "/login" | "/signup" | "/forgot-password", returnTo: string): string {
  return `${path}?returnTo=${encodeURIComponent(normalizeReturnTo(returnTo))}`;
}

export function getAuthConfiguration(): Promise<AuthConfiguration> {
  if (!configurationPromise) {
    configurationPromise = api<AuthConfiguration>("/api/auth/config").catch(error => {
      configurationPromise = null;
      throw error;
    });
  }
  return configurationPromise;
}

export function getFirebaseAuth(): Promise<Auth | null> {
  if (!authPromise) {
    authPromise = getAuthConfiguration().then(config => {
      if (!config.configured || !config.firebase || typeof window === "undefined") return null;
      const app = getApps().some(item => item.name === "sai-auth") ? getApp("sai-auth") : initializeApp(config.firebase, "sai-auth");
      let auth: Auth;
      try { auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver }); }
      catch (error) { if (!(typeof error === "object" && error && "code" in error && error.code === "auth/already-initialized")) throw error; auth = getAuth(app); }
      auth.languageCode = "ko";
      // The server only supplies emulatorUrl in explicitly enabled local development.
      if (config.emulatorUrl && !emulatorConnected && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
        const emulator = new URL(config.emulatorUrl);
        if (emulator.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(emulator.hostname)) {
          connectAuthEmulator(auth, emulator.origin, { disableWarnings: true });
          emulatorConnected = true;
        }
      }
      return auth;
    }).catch(error => {
      authPromise = null;
      throw error;
    });
  }
  return authPromise;
}

export function usesSameOriginGoogleRedirect(auth: Auth, config: AuthConfiguration): boolean {
  if (typeof window === "undefined" || config.emulatorUrl || window.location.protocol !== "https:") return false;
  if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return false;
  // A same-origin authDomain requires the production /__/auth/* helper proxy.
  // Never switch a third-party Firebase authDomain to redirect automatically.
  return config.firebase?.authDomain === window.location.host && auth.app.options.authDomain === window.location.host;
}

export function consumeGoogleRedirectResult(auth: Auth): Promise<UserCredential | null> {
  let result = redirectResults.get(auth);
  if (!result) {
    result = getRedirectResult(auth);
    redirectResults.set(auth, result);
  }
  return result;
}

function errorCode(error: unknown): string { return typeof error === "object" && error && "code" in error ? String(error.code) : ""; }
export function isPermanentAuthError(error: unknown): boolean {
  return ["INVALID_TOKEN", "auth/user-token-expired", "auth/invalid-user-token", "auth/user-disabled", "auth/user-not-found"].includes(errorCode(error));
}

const LOGOUT_KEY = "sai:auth:logout:v1";
let intentListenerInstalled = false;
let logoutIntent = false;
const coordinator = createSessionCoordinator<User, SessionResult>({
  readServer: () => api<SessionResult>("/api/auth/session"),
  readIdentity: async () => { const auth = await getFirebaseAuth(); if (!auth) return null; await auth.authStateReady(); return auth.currentUser; },
  token: async (user, forceRefresh) => {
    const auth = await getFirebaseAuth();
    await auth?.authStateReady();
    if (auth?.currentUser?.uid !== user.uid) throw new SessionCancelledError();
    const token = await user.getIdToken(forceRefresh);
    if (auth?.currentUser?.uid !== user.uid) throw new SessionCancelledError();
    return token;
  },
  writeServer: async idToken => {
    const session = await api<SessionResult>("/api/auth/session", { method: "POST", body: JSON.stringify({ idToken }) });
    const confirmed = await api<SessionResult>("/api/auth/session");
    if (!session.user || confirmed.user?.id !== session.user.id) throw Object.assign(new Error("브라우저에서 로그인 상태를 저장하지 못했어요. 쿠키 허용 상태를 확인하고 다시 시도해주세요."), { code: "SESSION_NOT_PERSISTED" });
    return confirmed;
  },
  clearServer: async () => { await api("/api/auth/session", { method: "DELETE", body: "{}" }); },
  signOut: async () => { const auth = await getFirebaseAuth(); if (auth) await signOut(auth); },
  disconnect: disconnectDevicePushBeforeLogout,
  isPermanent: isPermanentAuthError,
  isUnverified: error => errorCode(error) === "EMAIL_UNVERIFIED",
  onAuthenticated: session => { const current = captureSessionContext(); if (current.userId && session.user?.id && current.userId !== session.user.id) announceSessionChange(); else bindSessionContext(session.user?.id || null); },
  onLogout: () => {
    invalidateSessionContext();
    const broadcast = !logoutIntent;
    logoutIntent = true;
    if (broadcast) try { localStorage.setItem(LOGOUT_KEY, `${Date.now()}:${crypto.randomUUID()}`); } catch { /* Firebase sign-out remains authoritative when storage is unavailable. */ }
  },
});

function installIntentListener() {
  if (intentListenerInstalled || typeof window === "undefined") return;
  intentListenerInstalled = true;
  try { logoutIntent = !!localStorage.getItem(LOGOUT_KEY); } catch { /* Storage may be unavailable in a private browser. */ }
  window.addEventListener("storage", event => {
    if (event.key !== LOGOUT_KEY) return;
    logoutIntent = !!event.newValue;
    if (logoutIntent) void coordinator.logout().catch(() => {});
  });
}

export function beginSignIn(): void {
  installIntentListener();
  coordinator.beginSignIn();
  invalidateSessionContext();
  logoutIntent = false;
  try { localStorage.removeItem(LOGOUT_KEY); } catch { /* Sign-in is still allowed when storage is unavailable. */ }
}

export function syncServerSession(user: User, forceRefresh = false): Promise<SessionResult> {
  installIntentListener();
  if (logoutIntent) return Promise.reject(Object.assign(new Error("로그아웃한 계정이에요. 다시 로그인해주세요."), { code: "SESSION_CANCELLED" }));
  return coordinator.sync(user, forceRefresh);
}

export function restoreAppSession(): Promise<RestorationResult<SessionResult>> {
  installIntentListener();
  if (logoutIntent) return Promise.resolve({ status: "anonymous" });
  return coordinator.restore();
}

export function clearServerSession(): Promise<void> { return api("/api/auth/session", { method: "DELETE", body: "{}" }).then(() => undefined); }
export function logout(): Promise<void> { installIntentListener(); return coordinator.logout(); }

export function authErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const messages: Record<string, string> = {
    "auth/invalid-email": "이메일 주소를 다시 확인해주세요.",
    "auth/invalid-credential": "이메일 또는 비밀번호를 확인해주세요.",
    "auth/wrong-password": "이메일 또는 비밀번호를 확인해주세요.",
    "auth/user-not-found": "이메일 또는 비밀번호를 확인해주세요.",
    "auth/email-already-in-use": "이미 가입한 이메일이에요. 로그인하거나 비밀번호를 재설정해주세요.",
    "auth/weak-password": "비밀번호를 8자 이상으로 입력해주세요. 더 긴 비밀번호를 권장해요.",
    "auth/password-does-not-meet-requirements": "비밀번호가 안전 기준을 충족하지 않아요. 8자 이상으로 더 길게 만들어주세요.",
    "auth/too-many-requests": "시도가 많아 잠시 쉬어가야 해요. 조금 뒤에 다시 시도해주세요.",
    "auth/network-request-failed": "인터넷 연결을 확인하고 다시 시도해주세요.",
    "auth/popup-blocked": "로그인 창이 차단됐어요. 팝업을 허용하거나 Safari·Chrome에서 열어주세요. 이메일로도 로그인할 수 있어요.",
    "auth/popup-closed-by-user": "Google 로그인이 완료되지 않았어요. 다시 시도하거나 이메일로 로그인해주세요.",
    "auth/cancelled-popup-request": "열려 있는 Google 로그인 창에서 계속해주세요.",
    "auth/unauthorized-domain": "이 주소에서 Google 로그인을 준비 중이에요. 잠시 후 다시 시도해주세요.",
    "auth/operation-not-allowed": "이 로그인 방식을 준비 중이에요. 잠시 후 다시 시도해주세요.",
    "auth/account-exists-with-different-credential": "이 이메일로 가입한 계정이 있어요. 기존 이메일·비밀번호로 로그인해주세요.",
    "auth/user-disabled": "사용할 수 없는 계정이에요. 서비스 관리자에게 문의해주세요.",
    "auth/expired-action-code": "링크의 유효 시간이 지났어요. 새 메일을 요청해주세요.",
    "auth/invalid-action-code": "이미 사용했거나 유효하지 않은 링크예요. 새 메일을 요청해주세요.",
    "auth/requires-recent-login": "안전을 위해 다시 로그인해주세요.",
    "auth/web-storage-unsupported": "브라우저 저장소를 사용할 수 없어요. Safari·Chrome의 일반 창에서 다시 열어주세요.",
    "auth/redirect-cancelled-by-user": "Google 로그인이 완료되지 않았어요. 다시 시도하거나 이메일로 로그인해주세요.",
    "auth/redirect-operation-pending": "이 브라우저에서 Google 로그인을 진행 중이에요. 잠시 후 로그인 화면을 다시 열어주세요.",
    "auth/unsupported-persistence-type": "로그인 상태를 저장할 수 없어요. Safari·Chrome의 일반 창에서 다시 열어주세요.",
  };
  if (messages[code]) return messages[code];
  if (error instanceof Error && !code.startsWith("auth/")) return error.message;
  return "요청을 완료하지 못했어요. 잠시 후 다시 시도해주세요.";
}
