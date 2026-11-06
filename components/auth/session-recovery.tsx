/* eslint-disable @next/next/no-html-link-for-pages -- Auth recovery uses full-document navigation to establish the server session. */
"use client";

import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { authPageHref, normalizeReturnTo, restoreAppSession } from "@/lib/client/firebase-auth";

type SessionRecoveryProps = { returnTo: string; anonymousHref?: string; silent?: boolean };
type Phase = "checking" | "anonymous" | "error";

function anonymousDestination(value: string | undefined, returnTo: string): string {
  let path: "/login" | "/signup" = "/login";
  if (value) {
    try {
      const url = new URL(value, "https://sai.invalid");
      if (url.origin === "https://sai.invalid" && url.pathname === "/signup") path = "/signup";
    } catch { /* Use the safe local login page. */ }
  }
  return authPageHref(path, returnTo);
}

export default function SessionRecovery({ returnTo, anonymousHref, silent = false }: SessionRecoveryProps) {
  const destination = normalizeReturnTo(returnTo);
  const fallback = anonymousDestination(anonymousHref, destination);
  const signInHref = authPageHref("/login", destination);
  const [phase, setPhase] = useState<Phase>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    let pending = false;
    let navigating = false;
    async function recover() {
      if (!mounted || pending || navigating) return;
      pending = true;
      try {
        const result = await restoreAppSession();
        if (!mounted) return;
        if (result.status === "authenticated") {
          navigating = true;
          window.location.replace(destination);
        } else if (!silent && anonymousHref !== undefined) {
          navigating = true;
          window.location.replace(fallback);
        } else setPhase("anonymous");
      } catch {
        // A connectivity problem must never erase a remembered account.
        if (mounted) setPhase("error");
      } finally { pending = false; }
    }
    const retry = () => {
      if (!mounted || pending || navigating) return;
      if (!silent) setPhase("checking");
      void recover();
    };
    void recover();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      mounted = false;
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [destination, fallback, anonymousHref, silent, attempt]);

  if (silent) return null;
  const checking = phase === "checking";
  const failed = phase === "error";
  return <main className="session-recovery">
    <header className="session-recovery__header"><a href="/" className="session-recovery__brand" aria-label="사이 홈">sai<span>.</span></a></header>
    <div className="session-recovery__stage"><section className="session-recovery__card" aria-busy={checking}>
      <div className={`session-recovery__symbol${failed ? " is-offline" : ""}`} aria-hidden="true">{checking ? <LoaderCircle className="session-recovery__spinner" size={28} /> : failed ? <WifiOff size={27} /> : <ArrowRight size={27} />}</div>
      <div role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"} aria-atomic="true">
        <p className="session-recovery__eyebrow">OUR TIME, TOGETHER</p>
        <h1>{checking ? "우리의 시간을 불러오고 있어요" : failed ? "다시 연결해 볼까요?" : "우리 캘린더로 들어가요"}</h1>
        <p className="session-recovery__copy">{checking ? "잠시만 기다려 주세요." : failed ? "인터넷 연결을 확인한 뒤 다시 시도해 주세요." : "로그인하면 둘의 일정을 이어서 볼 수 있어요."}</p>
      </div>
      <div className="session-recovery__actions">
        {failed ? <button type="button" className="session-recovery__button is-primary" disabled={checking} onClick={() => { setPhase("checking"); setAttempt(value => value + 1); }}><RefreshCw size={17} />다시 시도</button> : null}
        <a href={signInHref} className={`session-recovery__button${phase === "anonymous" ? " is-primary" : " is-secondary"}`}>{phase === "anonymous" ? "로그인하고 계속하기" : "로그인 화면으로"}<ArrowRight size={17} /></a>
      </div>
    </section></div>
  </main>;
}
