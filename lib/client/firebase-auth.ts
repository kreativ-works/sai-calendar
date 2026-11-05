"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signOut, type Auth, type User } from "firebase/auth";
import { api } from "./api";

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
      const auth = getAuth(app);
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

export async function syncServerSession(user: User, forceRefresh = false): Promise<SessionResult> {
  const idToken = await user.getIdToken(forceRefresh);
  return api<SessionResult>("/api/auth/session", { method: "POST", body: JSON.stringify({ idToken }) });
}

export async function clearServerSession(): Promise<void> {
  await api("/api/auth/session", { method: "DELETE", body: "{}" });
}

export async function logout(): Promise<void> {
  // Clear both sessions even if one service is temporarily unavailable.
  const results = await Promise.allSettled([
    getFirebaseAuth().then(auth => auth ? signOut(auth) : undefined),
    clearServerSession(),
  ]);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

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
  };
  if (messages[code]) return messages[code];
  if (error instanceof Error && !code.startsWith("auth/")) return error.message;
  return "요청을 완료하지 못했어요. 잠시 후 다시 시도해주세요.";
}
