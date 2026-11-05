"use client";

import { useEffect } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { ApiError } from "@/lib/client/api";
import { authPageHref, clearServerSession, getFirebaseAuth, syncServerSession } from "@/lib/client/firebase-auth";

/** Mount for Firebase sessions only. Existing legacy sessions use an explicit migration flow. */
export default function SessionBridge({ enabled = true }: { enabled?: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let syncing = false;
    let redirecting = false;
    const login = async () => {
      if (!active || redirecting) return;
      redirecting = true;
      try { await clearServerSession(); } catch { /* The protected server will reject an expired session. */ }
      if (active) window.location.replace(authPageHref("/login", `${window.location.pathname}${window.location.search}`));
    };
    const refresh = async () => {
      if (!active || syncing || redirecting) return;
      syncing = true;
      try {
        const auth = await getFirebaseAuth();
        if (!auth) return;
        await auth.authStateReady();
        const user = auth.currentUser;
        if (!user || !user.emailVerified) { await login(); return; }
        await syncServerSession(user);
      } catch (error) {
        // Transient network failures keep the current view usable and retry on focus.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) await login();
      } finally { syncing = false; }
    };
    void getFirebaseAuth().then(auth => {
      if (!active || !auth) return;
      unsubscribe = onIdTokenChanged(auth, () => { void refresh(); });
    }).catch(() => { /* Retry when the app regains focus. */ });
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4 * 60 * 1000);
    return () => {
      active = false;
      unsubscribe?.();
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
  return null;
}
