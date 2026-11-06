export type SessionContext = { userId: string | null; version: number; changing: boolean };
let context: SessionContext = { userId: null, version: 0, changing: false };

export function captureSessionContext(): SessionContext { return { ...context }; }
export function bindSessionContext(userId: string | null): void {
  if (context.userId !== userId) context = { userId, version: context.version + 1, changing: false };
}
export function invalidateSessionContext(): void { context = { userId: null, version: context.version + 1, changing: false }; }
export function sameSessionForRetry(before: SessionContext, after: SessionContext, restoredUserId: string, readOnly: boolean): boolean {
  if (before.changing || after.changing) return false;
  if (!before.userId) return readOnly && (after.userId === null || after.userId === restoredUserId);
  return before.userId === restoredUserId && after.userId === before.userId && before.version === after.version;
}

export function announceSessionChange(): void {
  context = { ...context, version: context.version + 1, changing: true };
  if (typeof window !== "undefined") window.dispatchEvent(new Event("sai:session-changed"));
}
