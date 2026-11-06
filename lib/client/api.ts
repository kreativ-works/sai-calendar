import { announceSessionChange, bindSessionContext, captureSessionContext, sameSessionForRetry, type SessionContext } from "./session-context.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.name = "ApiError"; this.status = status; this.code = code; }
}

type RestoredSession = { status: "authenticated"; session: { user: { id: string } | null } } | { status: "anonymous" | "unverified" };
type ApiDependencies = {
  fetch: typeof fetch;
  restore: () => Promise<RestoredSession>;
  origin: () => string;
  capture: () => SessionContext;
  bind: (userId: string) => void;
  changed: () => void;
};

export function isProtectedApiPath(path: string, origin: string): boolean {
  try { const url = new URL(path, origin); return url.origin === origin && url.pathname.startsWith("/api/") && url.pathname !== "/api/auth" && !url.pathname.startsWith("/api/auth/"); }
  catch { return false; }
}

/** The only replay is an authenticated 401 recovery; bodies are limited to reusable values. */
export function createApiClient(dependencies: ApiDependencies) {
  return async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const protectedRequest = isProtectedApiPath(path, dependencies.origin());
    const started = dependencies.capture();
    const method = (options.method || "GET").toUpperCase();
    const readOnly = method === "GET" || method === "HEAD";
    const replayable = options.body == null || typeof options.body === "string" || options.body instanceof URLSearchParams;
    const changed = (): never => { dependencies.changed(); throw new ApiError("다른 계정으로 로그인됐어요. 캘린더를 다시 열고 있어요.", 409, "SESSION_CHANGED"); };
    if (protectedRequest && started.changing) changed();
    async function send() {
      const headers = new Headers(options.headers);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (protectedRequest) { const userId = dependencies.capture().userId; if (userId) headers.set("X-Sai-Expected-User", userId); }
      let response: Response;
      try { response = await dependencies.fetch(path, { ...options, headers, credentials: "same-origin", cache: "no-store" }); }
      catch { throw new ApiError("연결을 확인한 후 다시 시도해주세요. 작성한 내용은 그대로 있어요.", 0); }
      const data = await response.json().catch(() => null) as { user?: { id?: unknown }; error?: { message?: string; code?: string } } | null;
      return { response, data };
    }
    let result = await send();
    if (protectedRequest && result.response.status === 409 && result.data?.error?.code === "SESSION_CHANGED") changed();
    if (protectedRequest && result.response.status === 401 && replayable && (readOnly || !!started.userId)) {
      const restored = await dependencies.restore();
      if (restored.status === "authenticated" && restored.session.user) {
        if (!sameSessionForRetry(started, dependencies.capture(), restored.session.user.id, readOnly)) changed();
        result = await send();
      }
    }
    if (protectedRequest && result.response.status === 409 && result.data?.error?.code === "SESSION_CHANGED") changed();
    if (!result.response.ok) throw new ApiError(result.data?.error?.message || (result.response.status === 401 ? "로그인 후 우리 캘린더를 시작할 수 있어요." : "요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요."), result.response.status, result.data?.error?.code);
    if (protectedRequest && new URL(path, dependencies.origin()).pathname === "/api/state" && typeof result.data?.user?.id === "string") {
      const current = dependencies.capture();
      if (current.userId && current.userId !== result.data.user.id) changed();
      dependencies.bind(result.data.user.id);
    }
    return result.data as T;
  };
}

export const api = createApiClient({
  fetch: (input, init) => fetch(input, init),
  restore: async () => (await import("./firebase-auth")).restoreAppSession(),
  origin: () => typeof window === "undefined" ? "https://sai.invalid" : window.location.origin,
  capture: captureSessionContext,
  bind: bindSessionContext,
  changed: announceSessionChange,
});
