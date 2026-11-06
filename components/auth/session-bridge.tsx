"use client";

import { useEffect, useLayoutEffect } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { authPageHref, getFirebaseAuth, isPermanentAuthError, logout, restoreAppSession, syncServerSession } from "@/lib/client/firebase-auth";
import { bindSessionContext } from "@/lib/client/session-context";

export default function SessionBridge({ enabled = true, userId }: { enabled?: boolean; userId?: string }) {
  useLayoutEffect(() => { if (enabled && userId) bindSessionContext(userId); }, [enabled, userId]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let syncing = false;
    let leaving = false;
    let previousUid: string | null | undefined;
    const leave = (reload = false) => {
      if (!active || leaving) return;
      leaving = true;
      if (reload) window.location.reload();
      else window.location.replace(authPageHref("/login", `${window.location.pathname}${window.location.search}`));
    };
    const reconcile = async () => {
      if (!active || syncing || leaving) return;
      syncing = true;
      try {
        const result = await restoreAppSession();
        if (!active) return;
        if (result.status !== "authenticated") leave();
        else if (userId && result.session.user?.id !== userId) leave(true);
      } catch { /* Offline and temporary provider failures keep the current view and retry later. */ }
      finally { syncing = false; }
    };
    void getFirebaseAuth().then(auth => {
      if (!active || !auth) return;
      unsubscribe = onIdTokenChanged(auth, user => {
        if (!active || leaving) return;
        const wasSignedIn = previousUid !== undefined && previousUid !== null;
        previousUid = user?.uid || null;
        if (!user) {
          if (wasSignedIn) void logout().catch(() => {}).finally(() => leave());
          else void reconcile(); // A valid server cookie survives an absent SDK store, including PWA startup.
          return;
        }
        if (!user.emailVerified) { void reconcile(); return; }
        void syncServerSession(user).then(session => { if (userId && session.user?.id !== userId) leave(true); }).catch(error => {
          if (isPermanentAuthError(error)) void logout().catch(() => {}).finally(() => leave());
        });
      });
      void reconcile();
    }).catch(() => { void reconcile(); });
    const update = () => { if (!document.hidden) void reconcile(); };
    const changed = () => leave(true);
    window.addEventListener("focus", update); window.addEventListener("online", update);
    window.addEventListener("sai:session-changed", changed);
    document.addEventListener("visibilitychange", update);
    const timer = window.setInterval(update, 4 * 60 * 1000);
    return () => {
      active = false; unsubscribe?.(); window.clearInterval(timer);
      window.removeEventListener("focus", update); window.removeEventListener("online", update);
      window.removeEventListener("sai:session-changed", changed); document.removeEventListener("visibilitychange", update);
    };
  }, [enabled, userId]);
  return null;
}
