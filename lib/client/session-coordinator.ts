export type RestorableIdentity = { uid: string; emailVerified: boolean };
export type RestorableSession = { user: { id: string } | null };
export type RestorationResult<S> = { status: "authenticated"; session: S } | { status: "anonymous" | "unverified" };

export class SessionCancelledError extends Error {
  readonly code = "SESSION_CANCELLED";
  constructor() { super("로그인 상태가 바뀌었어요. 다시 확인해주세요."); this.name = "SessionCancelledError"; }
}

type Dependencies<U, S> = {
  readServer: () => Promise<S>;
  readIdentity: () => Promise<U | null>;
  token: (user: U, forceRefresh: boolean) => Promise<string>;
  writeServer: (token: string) => Promise<S>;
  clearServer: () => Promise<void>;
  signOut: () => Promise<void>;
  disconnect?: () => Promise<void>;
  onAuthenticated?: (session: S) => void;
  onLogout?: () => void;
  isPermanent: (error: unknown) => boolean;
  isUnverified?: (error: unknown) => boolean;
};

/** Serializes cookie mutations so an older POST can never finish after logout's DELETE. */
export function createSessionCoordinator<U extends RestorableIdentity, S extends RestorableSession>(dependencies: Dependencies<U, S>) {
  let generation = 0;
  let blocked = false;
  let mutations: Promise<void> = Promise.resolve();
  let restoration: { generation: number; promise: Promise<RestorationResult<S>> } | null = null;
  let loggingOut: Promise<void> | null = null;
  const synchronizations = new Map<string, { generation: number; promise: Promise<S> }>();
  const current = (value: number) => !blocked && generation === value;
  function assertCurrent(value: number) { if (!current(value)) throw new SessionCancelledError(); }
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = mutations.then(work);
    mutations = result.then(() => undefined, () => undefined);
    return result;
  }
  function sync(user: U, forceRefresh = false): Promise<S> {
    if (blocked) return Promise.reject(new SessionCancelledError());
    const version = generation;
    const existing = synchronizations.get(user.uid);
    if (existing?.generation === version) return existing.promise;
    const promise = serialize(async () => {
      assertCurrent(version);
      const token = await dependencies.token(user, forceRefresh);
      assertCurrent(version);
      const session = await dependencies.writeServer(token);
      assertCurrent(version);
      dependencies.onAuthenticated?.(session);
      return session;
    });
    synchronizations.set(user.uid, { generation: version, promise });
    const clean = () => { if (synchronizations.get(user.uid)?.promise === promise) synchronizations.delete(user.uid); };
    void promise.then(clean, clean);
    return promise;
  }
  function logout(): Promise<void> {
    if (loggingOut) return loggingOut;
    blocked = true;
    generation++;
    restoration = null;
    dependencies.onLogout?.();
    const promise = (async () => {
      try { await dependencies.disconnect?.(); } catch { /* Local unsubscription is best effort; sign-out must continue. */ }
      const result = await Promise.allSettled([dependencies.signOut(), serialize(dependencies.clearServer)]);
      const failure = result.find(item => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })();
    loggingOut = promise;
    void promise.then(() => { if (loggingOut === promise) loggingOut = null; }, () => { if (loggingOut === promise) loggingOut = null; });
    return promise;
  }
  function restore(): Promise<RestorationResult<S>> {
    if (blocked) return Promise.resolve({ status: "anonymous" });
    if (restoration?.generation === generation) return restoration.promise;
    const version = generation;
    const promise: Promise<RestorationResult<S>> = (async () => {
      try {
        const server = await dependencies.readServer();
        if (!current(version)) return { status: "anonymous" };
        if (server.user) { dependencies.onAuthenticated?.(server); return { status: "authenticated", session: server }; }
        const user = await dependencies.readIdentity();
        if (!current(version)) return { status: "anonymous" };
        if (!user) return { status: "anonymous" };
        if (!user.emailVerified) return { status: "unverified" };
        const session = await sync(user, true);
        return current(version) ? { status: "authenticated", session } : { status: "anonymous" };
      } catch (error) {
        if (!current(version) || error instanceof SessionCancelledError) return { status: "anonymous" };
        if (dependencies.isUnverified?.(error)) return { status: "unverified" };
        if (dependencies.isPermanent(error)) { try { await logout(); } catch { /* The blocked generation prevents repeated restoration. */ } return { status: "anonymous" }; }
        throw error;
      }
    })();
    restoration = { generation: version, promise };
    const clean = () => { if (restoration?.promise === promise) restoration = null; };
    void promise.then(clean, clean);
    return promise;
  }
  return {
    restore,
    sync,
    logout,
    isBlocked: () => blocked,
    beginSignIn() {
      if (loggingOut) throw new Error("로그아웃을 마무리하고 있어요. 잠시 후 다시 로그인해주세요.");
      generation++; blocked = false; restoration = null;
    },
  };
}
