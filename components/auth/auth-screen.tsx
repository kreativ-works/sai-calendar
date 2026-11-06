/* eslint-disable @next/next/no-html-link-for-pages -- Auth entry and exit use full-document navigation to reset browser auth state. */
"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, Eye, EyeOff, Heart, LoaderCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { applyActionCode, checkActionCode, confirmPasswordReset, createUserWithEmailAndPassword, GoogleAuthProvider, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, updateProfile, verifyPasswordResetCode, type Auth, type User } from "firebase/auth";
import { api, ApiError } from "@/lib/client/api";
import { authErrorMessage, authPageHref, beginSignIn, consumeGoogleRedirectResult, getAuthConfiguration, getFirebaseAuth, logout, normalizeReturnTo, restoreAppSession, syncServerSession, usesSameOriginGoogleRedirect, type AuthConfiguration } from "@/lib/client/firebase-auth";

export type AuthScreenProps = {
  mode: "login" | "signup" | "forgot" | "action";
  returnTo: string;
  actionCode?: string;
  actionMode?: string;
};

type Panel = "form" | "verify" | "forgot-sent" | "legacy" | "reset" | "reset-done" | "email-verified" | "email-recovered" | "action-error";

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" /><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.41 13.93a6 6 0 0 1 0-3.86V7.48H3.07a10 10 0 0 0 0 9.04l3.34-2.59Z" /><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z" /></svg>;
}

function PasswordField({ label, value, onChange, autoComplete, disabled, hint, id, autoFocus = false }: { label: string; value: string; onChange: (value: string) => void; autoComplete: "current-password" | "new-password"; disabled: boolean; hint?: string; id: string; autoFocus?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-field"><label htmlFor={id}>{label}</label><div className="auth-password"><input id={id} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} required minLength={autoComplete === "new-password" ? 8 : undefined} maxLength={128} autoComplete={autoComplete} autoFocus={autoFocus} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} placeholder={autoComplete === "new-password" ? "8자 이상 입력해주세요" : "비밀번호를 입력해주세요"} /><button type="button" aria-label={visible ? `${label} 숨기기` : `${label} 보기`} aria-pressed={visible} onClick={() => setVisible(!visible)} disabled={disabled}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>{hint ? <p id={`${id}-hint`} className="auth-field-hint">{hint}</p> : null}</div>;
}

function AuthArtwork() {
  return <aside className="auth-artwork" aria-label="두 사람의 시간을 함께하는 사이"><div className="auth-artwork-copy"><span className="auth-eyebrow">A LITTLE CLOSER, EVERY DAY</span><h2>각자의 하루가,<br />우리의 시간이 되도록.</h2><p>바쁜 일상 속에서도 서로를 놓치지 않게.<br />둘의 작은 약속들을 한곳에 모아보세요.</p></div><div className="auth-calendar-art" aria-hidden="true"><div className="auth-art-month"><span>OUR NOVEMBER</span><Heart size={18} /></div><div className="auth-art-weekdays">{"SMTWTFS".split("").map((day, index) => <span key={index}>{day}</span>)}</div><div className="auth-art-days">{Array.from({ length: 21 }, (_, index) => <div key={index} className={index === 12 ? "selected" : ""}><span>{index + 1}</span>{index === 4 ? <i className="lavender">저녁 산책</i> : index === 12 ? <i className="mint">우리의 데이트</i> : index === 17 ? <i className="coral">함께 장보기</i> : null}</div>)}</div><div className="auth-art-caption"><span className="auth-art-avatars"><i>나</i><i>너</i></span><span>같은 하루를, 조금 더 가까이.</span></div></div><div className="auth-art-note"><span><Check size={14} />나 · 짝꿍 · 함께</span><span><Check size={14} />둘만의 공유 공간</span></div></aside>;
}

export default function AuthScreen({ mode, returnTo: rawReturnTo, actionCode, actionMode }: AuthScreenProps) {
  const returnTo = normalizeReturnTo(rawReturnTo);
  const id = useId();
  const [auth, setAuth] = useState<Auth | null>(null);
  const [configuration, setConfiguration] = useState<AuthConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>("form");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAfter, setResendAfter] = useState(0);
  const [reauthenticating, setReauthenticating] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [googleSlow, setGoogleSlow] = useState(false);
  const mounted = useRef(true);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const ready = !loading && !!auth && !!configuration?.configured;
  const disabled = !ready || busy;
  const screenMode = reauthenticating ? "login" : mode;
  const isSignup = screenMode === "signup";

  async function finishSignIn(user: User, forceRefresh = false) {
    if (!mounted.current) return;
    setCurrentUser(user);
    setEmail(user.email || "");
    if (!user.emailVerified) {
      setPanel("verify");
      return;
    }
    const session = await syncServerSession(user, forceRefresh);
    if (!mounted.current) return;
    if (session.legacyAvailable) setPanel("legacy");
    else window.location.replace(returnTo);
  }

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function initialize() {
      let actionCompleted = false;
      try {
        const config = await getAuthConfiguration();
        const instance = await getFirebaseAuth();
        if (cancelled) return;
        setConfiguration(config);
        setAuth(instance);
        if (!instance) return;
        await instance.authStateReady();
        if (cancelled) return;
        const redirectCredential = mode === "login" || mode === "signup" ? await consumeGoogleRedirectResult(instance) : null;
        if (cancelled) return;
        if (mode === "action") {
          if (!actionCode) throw new Error("메일의 링크가 올바르지 않아요. 새 메일을 요청해주세요.");
          if (actionMode === "resetPassword") {
            const resetEmail = await verifyPasswordResetCode(instance, actionCode);
            if (!cancelled) { setEmail(resetEmail); setPanel("reset"); }
          } else if (actionMode === "verifyEmail") {
            const information = await checkActionCode(instance, actionCode);
            if (cancelled) return;
            await applyActionCode(instance, actionCode);
            if (cancelled) return;
            if (instance.currentUser) await reload(instance.currentUser);
            const verifiedEmail = information.data.email || "";
            const sameAccount = instance.currentUser?.email?.toLowerCase() === verifiedEmail.toLowerCase();
            if (!cancelled) { setEmail(verifiedEmail); setCurrentUser(sameAccount ? instance.currentUser : null); setPanel("email-verified"); }
          } else if (actionMode === "recoverEmail") {
            const information = await checkActionCode(instance, actionCode);
            if (cancelled) return;
            await applyActionCode(instance, actionCode);
            if (cancelled) return;
            setEmail(information.data.email || "");
            setCurrentUser(null);
            setPanel("email-recovered");
            actionCompleted = true;
            // Restoring an account email should end this browser's old session.
            // Sending a password reset remains an explicit user action.
            await logout();
          } else throw new Error("이 링크를 처리할 수 없어요. 로그인 화면에서 다시 시작해주세요.");
        } else if (redirectCredential?.user) {
          // A completed Google redirect is an explicit sign-in, even if an older
          // server cookie is still present for this browser.
          await finishSignIn(redirectCredential.user, true);
        } else if (mode === "login" || mode === "signup") {
          const restored = await restoreAppSession();
          if (cancelled) return;
          if (restored.status === "authenticated") {
            if (restored.session.legacyAvailable) setPanel("legacy");
            else window.location.replace(returnTo);
            return;
          }
          // Reload after opening an email verification link in a different tab.
          // Anonymous restoration also covers an explicit logout: do not revive
          // a stale Firebase user merely because it is still being signed out.
          const user = restored.status === "unverified" ? instance.currentUser : null;
          if (!user) return;
          await reload(user);
          if (!cancelled) await finishSignIn(user, true);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(authErrorMessage(cause));
          if (mode === "action" && !actionCompleted) setPanel("action-error");
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    void initialize();
    return () => { cancelled = true; mounted.current = false; };
    // Each route is a distinct auth screen. Avoid rerunning account actions on state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, actionCode, actionMode, returnTo]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!googlePending) return;
    const timer = window.setTimeout(() => setGoogleSlow(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [googlePending]);
  useEffect(() => {
    if (!resendAfter) return;
    const timer = window.setInterval(() => setResendAfter(previous => Math.max(0, previous - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendAfter]);

  function actionSettings() {
    return { url: new URL(authPageHref("/login", returnTo), window.location.origin).href, handleCodeInApp: false };
  }

  async function sendVerification(user: User) {
    await sendEmailVerification(user, actionSettings());
    setResendAfter(60);
    setNotice("확인 메일을 보냈어요. 스팸함도 함께 확인해주세요.");
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try { await work(); }
    catch (cause) { if (mounted.current) setError(authErrorMessage(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth || disabled) return;
    if ((isSignup || panel === "reset") && password !== confirm) { setError("비밀번호가 서로 달라요. 다시 확인해주세요."); return; }
    if ((isSignup || panel === "reset") && (password.length < 8 || password.length > 128)) { setError("비밀번호를 8~128자로 입력해주세요."); return; }
    if (isSignup && !name.trim()) { setError("불리고 싶은 이름을 입력해주세요."); return; }
    void run(async () => {
      if (panel === "reset") {
        await confirmPasswordReset(auth, actionCode || "", password);
        setPassword(""); setConfirm(""); setPanel("reset-done");
        await logout();
      } else if (screenMode === "forgot") {
        try { await sendPasswordResetEmail(auth, email.trim(), actionSettings()); }
        catch (cause) { if (!(typeof cause === "object" && cause && "code" in cause && cause.code === "auth/user-not-found")) throw cause; }
        setPanel("forgot-sent");
      } else if (isSignup) {
        beginSignIn();
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        setCurrentUser(credential.user); setPanel("verify"); setPassword(""); setConfirm("");
        await updateProfile(credential.user, { displayName: name.trim() });
        await sendVerification(credential.user);
      } else {
        beginSignIn();
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        setPassword("");
        await finishSignIn(credential.user);
      }
    });
  }

  function googleSignIn() {
    if (!auth || disabled || !configuration?.providers.google) return;
    try { beginSignIn(); }
    catch (cause) { setError(authErrorMessage(cause)); return; }
    setBusy(true); setGooglePending(true); setGoogleSlow(false); setError(""); setNotice("");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    // Production uses a full-page flow only after the auth helpers share our origin.
    // Other configurations retain a directly invoked popup; no automatic fallback races.
    const sameOriginRedirect = usesSameOriginGoogleRedirect(auth, configuration);
    if (sameOriginRedirect) {
      // A legacy reauthentication may have started from an already consumed email action.
      // Return to a clean auth route while retaining the invitation destination.
      window.history.replaceState(window.history.state, "", authPageHref(isSignup ? "/signup" : "/login", returnTo));
    }
    const result = sameOriginRedirect
      ? signInWithRedirect(auth, provider)
      : signInWithPopup(auth, provider);
    void result.then(credential => credential ? finishSignIn(credential.user) : undefined).catch(cause => {
      if (mounted.current) setError(authErrorMessage(cause));
    }).finally(() => {
      if (mounted.current) { setBusy(false); setGooglePending(false); setGoogleSlow(false); }
    });
  }

  function connectLegacyCalendar() {
    void run(async () => {
      try {
        await api("/api/auth/link-legacy", { method: "POST", body: "{}" });
        window.location.replace(returnTo);
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== "REAUTHENTICATION_REQUIRED") throw cause;
        try { await logout(); }
        finally {
          setCurrentUser(null);
          setPassword("");
          setReauthenticating(true);
          setPanel("form");
          setNotice("기존 캘린더를 안전하게 연결하려면 이메일이나 Google 계정으로 다시 로그인해주세요.");
        }
      }
    });
  }

  const headline = panel === "verify" ? "이메일을 확인해주세요" : panel === "legacy" ? "기존 캘린더를 연결할까요?" : panel === "forgot-sent" ? "메일함을 확인해주세요" : panel === "reset" ? "새 비밀번호를 정해요" : panel === "reset-done" ? "비밀번호를 바꿨어요" : panel === "email-verified" ? "이메일 확인이 끝났어요" : panel === "email-recovered" ? "이메일 주소를 복구했어요" : panel === "action-error" ? "링크를 확인해주세요" : isSignup ? "우리의 시간을 시작해요" : screenMode === "forgot" ? "비밀번호를 잊으셨나요?" : screenMode === "action" ? "링크를 확인하고 있어요" : "다시 만나 반가워요";
  const description = panel === "verify" ? "내 캘린더를 안전하게 지키는 마지막 한 걸음이에요." : panel === "legacy" ? "예전에 사용하던 두 사람의 일정을 이 계정으로 이어갈 수 있어요." : panel === "forgot-sent" ? "가입한 이메일이면 비밀번호 재설정 링크를 보내드려요." : panel === "reset" ? "다른 서비스와 겹치지 않는 비밀번호를 사용해주세요." : panel === "reset-done" ? "새 비밀번호로 로그인하고 우리의 하루를 이어가세요." : panel === "email-verified" ? "이제 둘만의 캘린더를 시작할 수 있어요." : panel === "email-recovered" ? "계정을 안전하게 지키도록 비밀번호도 새로 정해주세요." : panel === "action-error" ? "시간이 지났거나 이미 사용한 링크일 수 있어요." : isSignup ? "각자의 하루부터 함께할 약속까지, 사이에 담아요." : screenMode === "forgot" ? "가입한 이메일로 재설정 링크를 보내드릴게요." : screenMode === "action" ? "잠시만 기다려주세요." : "오늘의 하루도, 함께할 내일도 기다리고 있어요.";
  const showMainForm = panel === "form" && screenMode !== "action";
  const showSocial = showMainForm && screenMode !== "forgot";

  return <main className="sai-auth">
    <a className="auth-skip" href="#auth-form">로그인 화면으로 건너뛰기</a>
    <header className="auth-header"><a className="auth-brand" href="/" aria-label="사이 홈"><span className="auth-brand-mark" aria-hidden="true"><i /><i /></span><span>sai<span>.</span></span></a><a className="auth-demo-link" href="/app?demo=1">먼저 둘러보기<ArrowRight size={15} /></a></header>
    <div className="auth-layout"><AuthArtwork /><section id="auth-form" className="auth-card" aria-labelledby="auth-heading">
      <a className="auth-back" href={screenMode === "forgot" || screenMode === "action" ? authPageHref("/login", returnTo) : "/"}><ArrowLeft size={15} />{screenMode === "forgot" || screenMode === "action" ? "로그인으로" : "홈으로"}</a>
      <div className="auth-heading"><span className="auth-eyebrow">OUR TIME, TOGETHER</span>{panel !== "form" && panel !== "reset" ? <div className={`auth-status-icon ${panel === "action-error" ? "is-warning" : ""}`}>{panel === "verify" || panel === "forgot-sent" ? <Mail size={27} strokeWidth={1.5} /> : panel === "legacy" ? <CalendarDays size={27} strokeWidth={1.5} /> : <CheckCircle2 size={27} strokeWidth={1.5} />}</div> : null}<h1 id="auth-heading">{headline}</h1><p>{description}</p></div>

      {loading ? <div className="auth-loading" role="status"><LoaderCircle size={20} className="spin" />안전한 연결을 확인하고 있어요…</div> : !ready ? <div className="auth-service-notice" role="status"><ShieldCheck size={20} /><div><strong>로그인 서비스를 준비하고 있어요</strong><p>연결이 완료되면 이메일과 Google 계정으로 바로 시작할 수 있어요. 잠시 후 다시 방문해주세요.</p><button type="button" onClick={() => window.location.reload()}>다시 확인하기</button></div></div> : null}

      {showSocial ? <><button type="button" className="auth-google" disabled={disabled || !configuration?.providers.google} onClick={googleSignIn}><GoogleMark />Google로 계속하기{googlePending ? <LoaderCircle className="spin" size={16} /> : null}</button>{googleSlow ? <div className="auth-google-help" role="status"><strong>로그인 화면이 열리지 않나요?</strong><p>인앱 브라우저에서는 Google 로그인이 제한될 수 있어요. Safari·Chrome에서 열거나 이메일로 다시 시작해주세요.</p><a href={`${authPageHref("/login", returnTo)}&method=email`} target="_top">이메일 로그인으로 다시 시작<ArrowRight size={14} /></a><a href={authPageHref(isSignup ? "/signup" : "/login", returnTo)} target="_top">로그인 화면 다시 열기</a></div> : null}<div className="auth-divider"><span>또는 이메일로</span></div></> : null}

      {showMainForm || panel === "reset" ? <form onSubmit={submit} className="auth-form" aria-busy={busy}>
        {isSignup && panel === "form" ? <div className="auth-field"><label htmlFor={`${id}-name`}>이름</label><input id={`${id}-name`} type="text" autoComplete="nickname" autoFocus required maxLength={24} value={name} onChange={event => setName(event.target.value)} placeholder="불리고 싶은 이름" disabled={disabled} /></div> : null}
        {panel !== "reset" ? <div className="auth-field"><label htmlFor={`${id}-email`}>이메일</label><input id={`${id}-email`} type="email" inputMode="email" autoComplete={screenMode === "forgot" ? "email" : "username"} autoCapitalize="none" spellCheck={false} autoFocus={!isSignup} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" disabled={disabled || !configuration?.providers.email} /></div> : <p className="auth-email-chip"><Mail size={15} />{email}</p>}
        {screenMode !== "forgot" ? <><PasswordField label={panel === "reset" ? "새 비밀번호" : "비밀번호"} id={`${id}-password`} value={password} onChange={setPassword} autoComplete={isSignup || panel === "reset" ? "new-password" : "current-password"} disabled={disabled} hint={isSignup || panel === "reset" ? "8자 이상 · 안전한 비밀번호는 12자 이상을 권장해요." : undefined} autoFocus={panel === "reset"} />{isSignup || panel === "reset" ? <PasswordField label="비밀번호 확인" id={`${id}-confirm`} value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={disabled} /> : <a className="auth-forgot" href={authPageHref("/forgot-password", returnTo)}>비밀번호를 잊으셨나요?</a>}</> : null}
        <button className="auth-primary" type="submit" disabled={disabled || !configuration?.providers.email}>{busy ? <><LoaderCircle className="spin" size={18} />{isSignup ? "계정을 만들고 있어요…" : "확인하고 있어요…"}</> : <>{panel === "reset" ? "비밀번호 변경" : isSignup ? "이메일로 가입하기" : screenMode === "forgot" ? "재설정 링크 보내기" : "로그인"}<ArrowRight size={17} /></>}</button>
      </form> : null}

      {panel === "verify" ? <div className="auth-panel"><p className="auth-email-chip"><Mail size={16} />{currentUser?.email || email}</p><p className="auth-panel-copy">메일의 <strong>이메일 확인</strong> 링크를 누른 뒤<br />아래 버튼으로 돌아와주세요.</p><button className="auth-primary" disabled={disabled} onClick={() => void run(async () => { if (!currentUser) return; await reload(currentUser); if (!currentUser.emailVerified) { setError("아직 이메일 확인이 안 되었어요. 메일의 링크를 누른 뒤 다시 눌러주세요."); return; } await finishSignIn(currentUser, true); })}>{busy ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}확인했어요, 계속하기</button><button className="auth-secondary" disabled={disabled || resendAfter > 0} onClick={() => void run(async () => { if (currentUser) await sendVerification(currentUser); })}>{resendAfter > 0 ? `${resendAfter}초 후 다시 보낼 수 있어요` : "확인 메일 다시 보내기"}</button><button className="auth-text-button" disabled={busy} onClick={() => void run(async () => { await logout(); setCurrentUser(null); setPanel("form"); setNotice("다른 이메일로 로그인하거나 가입할 수 있어요."); })}>다른 이메일 사용하기</button></div> : null}
      {panel === "legacy" ? <div className="auth-panel"><div className="auth-legacy-note"><CalendarDays size={23} /><p>기존 일정과 짝꿍 연결을<br /><strong>지금 로그인한 계정으로 옮겨요.</strong></p></div><p className="auth-panel-copy">두 계정이 같은 사람의 것일 때만 연결해주세요.<br />연결한 뒤에는 이 로그인 방식으로 사용해요.</p><button className="auth-primary" disabled={disabled} onClick={connectLegacyCalendar}>{busy ? <LoaderCircle size={18} className="spin" /> : <Heart size={18} />}기존 캘린더 연결하기</button><button className="auth-secondary" disabled={busy} onClick={() => window.location.replace(returnTo)}>새 캘린더로 시작하기</button></div> : null}
      {panel === "forgot-sent" ? <div className="auth-panel"><p className="auth-email-chip"><Mail size={16} />{email}</p><p className="auth-panel-copy">메일이 보이지 않으면 스팸함을 확인해주세요.<br />잠시 후에도 없다면 이메일 주소를 확인해주세요.</p><a className="auth-primary" href={authPageHref("/login", returnTo)}>로그인으로 돌아가기<ArrowRight size={17} /></a><button className="auth-text-button" onClick={() => { setPanel("form"); setError(""); }}>이메일 주소 다시 입력하기</button></div> : null}
      {panel === "reset-done" ? <a className="auth-primary" href={authPageHref("/login", returnTo)}>새 비밀번호로 로그인<ArrowRight size={17} /></a> : null}
      {panel === "email-verified" ? <div className="auth-panel">{email ? <p className="auth-email-chip"><Mail size={16} />{email}</p> : null}{currentUser?.emailVerified ? <button className="auth-primary" disabled={disabled} onClick={() => void run(() => finishSignIn(currentUser, true))}>우리 캘린더로 가기<ArrowRight size={17} /></button> : <button className="auth-primary" disabled={busy} onClick={() => void run(async () => { if (auth?.currentUser) await logout(); window.location.replace(authPageHref("/login", returnTo)); })}>로그인하고 시작하기<ArrowRight size={17} /></button>}</div> : null}
      {panel === "email-recovered" ? <div className="auth-panel">{email ? <p className="auth-email-chip"><Mail size={16} />{email}</p> : null}<p className="auth-panel-copy">변경 전 이메일 주소로 계정을 복구했어요.<br />직접 변경하지 않았다면 비밀번호를 꼭 바꿔주세요.</p><a className="auth-primary" href={authPageHref("/forgot-password", returnTo)}>비밀번호 다시 설정하기<ArrowRight size={17} /></a><a className="auth-text-button" href={authPageHref("/login", returnTo)}>로그인으로 돌아가기</a></div> : null}
      {panel === "action-error" ? <div className="auth-panel"><a className="auth-primary" href={authPageHref("/login", returnTo)}>로그인으로 돌아가기<ArrowRight size={17} /></a><a className="auth-text-button" href={authPageHref("/forgot-password", returnTo)}>비밀번호 재설정 메일 다시 받기</a></div> : null}

      {error ? <p ref={errorRef} tabIndex={-1} id="auth-error" className="auth-error" role="alert">{error}</p> : null}
      {notice ? <p className="auth-notice" role="status"><CheckCircle2 size={16} />{notice}</p> : null}
      {showMainForm && screenMode !== "forgot" ? <p className="auth-switch">{isSignup ? "이미 사이를 사용하고 계신가요?" : "사이가 처음이신가요?"}<a href={authPageHref(isSignup ? "/login" : "/signup", returnTo)}>{isSignup ? "로그인" : "가입하기"}<ArrowRight size={13} /></a></p> : null}
      {showMainForm && screenMode === "login" ? <details className="auth-legacy-help"><summary>예전에 ChatGPT로 사용하던 캘린더가 있어요</summary><p>기존 계정을 한 번 확인한 뒤, 이메일이나 Google 계정에 캘린더를 연결할 수 있어요.</p><a href={`/signin-with-chatgpt?return_to=${encodeURIComponent(authPageHref("/login", returnTo))}`} target="_top">기존 계정 확인하고 연결하기<ArrowRight size={13} /></a></details> : null}
      <div className="auth-privacy"><LockKeyhole size={13} /><span>일정은 초대로 연결된 두 사람만 볼 수 있어요.</span></div>
    </section></div><footer className="auth-footer"><span>사이, 우리의 시간을 함께.</span><span>© {new Date().getFullYear()} kreativ works</span></footer>
  </main>;
}
