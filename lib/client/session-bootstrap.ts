import type { SessionContext } from "./session-context.ts";

export type ServerSessionBootstrap = { subject: string; expiresAt: number; tokenFingerprint: string };
type Identity = { uid: string; emailVerified: boolean };

export function hasActiveBootstrapIntent(intent: { logout: boolean; blocked: boolean; context: SessionContext }, before?: SessionContext): boolean {
  return !intent.logout && !intent.blocked && !intent.context.changing
    && (!before || (!before.changing && before.userId === intent.context.userId && before.version === intent.context.version));
}

export async function tokenFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

export function isFreshServerBootstrap(value: ServerSessionBootstrap | undefined, now = Date.now() / 1000): value is ServerSessionBootstrap {
  return !!value && !!value.subject && value.subject.length <= 128 && Number.isFinite(value.expiresAt)
    && value.expiresAt > now + 300 && /^[a-f0-9]{64}$/.test(value.tokenFingerprint);
}

/** A one-time optimization hint, never an authorization or a cache of user data. */
export async function canReuseServerBootstrap(value: ServerSessionBootstrap | undefined, user: Identity | null, options: {
  token: () => Promise<string>; active: () => boolean; now?: () => number;
}): Promise<boolean> {
  const now = options.now ?? (() => Date.now() / 1000);
  if (!options.active() || !isFreshServerBootstrap(value, now()) || !user?.emailVerified || user.uid !== value.subject) return false;
  const fingerprint = await tokenFingerprint(await options.token());
  return options.active() && isFreshServerBootstrap(value, now()) && fingerprint === value.tokenFingerprint;
}
