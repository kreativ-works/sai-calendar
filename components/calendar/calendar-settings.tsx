"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowUpRight, Bell, Check, ChevronRight, Copy, Heart, Link2, LoaderCircle, MailPlus, MessageSquare, ClipboardList, Users } from "lucide-react";
import type { CalendarState, HouseholdInput } from "@/lib/domain/calendar";
import Dialog from "./dialog";

export type InviteLink = { code: string; url: string; expiresAt: string };
type SettingsProps = { state: CalendarState | null; initialTab: "create" | "join" | "settings"; initialCode?: string; connectionError: string; requiresSignIn: boolean; loading: boolean; demo: boolean; onRetry: () => void; onCreate: (input: HouseholdInput) => Promise<void>; onUpdate: (input: HouseholdInput) => Promise<void>; onJoin: (code: string) => Promise<void>; onInvite: () => Promise<InviteLink>; onRevoke: () => Promise<void>; onLive: () => void; onDemo: () => void; onNotifications: () => void; onFeedback: () => void; feedbackAdmin?: boolean; onClose: () => void; };

export default function CalendarSettings({ state, initialTab, initialCode = "", connectionError, requiresSignIn, loading, demo, onRetry, onCreate, onUpdate, onJoin, onInvite, onRevoke, onLive, onDemo, onNotifications, onFeedback, feedbackAdmin = false, onClose }: SettingsProps) {
  const connected = !!state?.household;
  const [tab, setTab] = useState(connected ? "settings" : initialTab);
  const [input, setInput] = useState<HouseholdInput>(() => ({ name: state?.household?.name || "우리의 캘린더", aName: state?.members.find(member => member.slot === "a")?.name || "나", bName: state?.members.find(member => member.slot === "b")?.name || "짝꿍", anniversary: state?.household?.anniversary || "" }));
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState<InviteLink | null>(null);
  const [copied, setCopied] = useState(false);
  let pendingCode = code.trim();
  try { const url = new URL(pendingCode); pendingCode = url.searchParams.get("join") || pendingCode; } catch { /* A plain invitation code is also accepted. */ }
  const awaitingConnection = loading || (!requiresSignIn && !state);
  const returnTo = pendingCode ? `/app?setup=join&join=${encodeURIComponent(pendingCode)}` : tab === "join" ? "/app?setup=join" : connected ? "/app" : "/app?setup=1";
  const signInHref = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  async function run(work: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await work(); } catch (err) { setError(err instanceof Error ? err.message : "다시 시도해주세요."); } finally { setBusy(false); } }
  function change<K extends keyof HouseholdInput>(key: K, value: HouseholdInput[K]) { setInput(old => ({ ...old, [key]: value })); }
  function submit(event: FormEvent) { event.preventDefault(); void run(async () => { if (connected) { await onUpdate(input); setNotice("캘린더 정보를 저장했어요."); } else await onCreate(input); }); }
  async function copyInvite() {
    await run(async () => {
      const invite = link || await onInvite(); setLink(invite);
      try { await navigator.clipboard.writeText(invite.url); setCopied(true); }
      catch { setNotice("아래 초대 링크를 선택해서 복사해주세요."); }
    });
  }
  function join(event: FormEvent) {
    event.preventDefault();
    let value = code.trim();
    try { const url = new URL(value); value = url.searchParams.get("join") || value; } catch { /* A plain invitation code is also accepted. */ }
    if (!value) { setError("받은 초대 링크나 초대 코드를 입력해주세요."); return; }
    void run(() => onJoin(value));
  }
  return <Dialog title={connected ? "우리 캘린더 설정" : "둘의 시간을 연결해요"} eyebrow={connected ? "OUR LITTLE SPACE" : "WELCOME TO SAI"} onClose={() => { if (!busy) onClose(); }} className="settings-dialog">
    <div className="dialog-body settings-body">
      {!connected ? <><p className="settings-intro">각자의 바쁜 하루도, 함께할 작은 약속도.<br />둘만의 캘린더에 가볍게 모아보세요.</p><div className="settings-tabs"><button className={tab !== "join" ? "active" : ""} onClick={() => { setTab("create"); setError(""); }}><Heart size={16} />새 캘린더 만들기</button><button className={tab === "join" ? "active" : ""} onClick={() => { setTab("join"); setError(""); }}><Link2 size={16} />초대받아 연결하기</button></div></> : <div className="connection-people"><div className="paired-avatars"><span className="avatar owner-a">{input.aName.slice(0, 1)}</span><span className="avatar owner-b">{input.bName.slice(0, 1)}</span></div><div><strong>{state.members.every(member => member.connected) ? "둘이 함께 쓰는 중" : "짝꿍을 기다리고 있어요"}</strong><p>{state.members.every(member => member.connected) ? "서로의 일정을 같은 캘린더에서 확인해요." : "초대 링크를 보내 둘의 일정을 연결하세요."}</p></div></div>}
      {awaitingConnection ? <section className="signin-section" aria-live="polite"><div className="signin-symbol">{loading ? <LoaderCircle size={26} className="spin" /> : <AlertCircle size={26} strokeWidth={1.4} />}</div><h3>{loading ? "캘린더 연결을 확인하고 있어요" : "연결을 다시 확인해주세요"}</h3><p>{loading ? "잠시만 기다리면 바로 시작할 수 있어요." : "연결을 확인한 뒤 우리 캘린더를 시작할 수 있어요."}</p><button className="primary-button full-width" type="button" disabled={loading} onClick={onRetry}>{loading ? "확인 중…" : "다시 연결"}</button></section> : requiresSignIn ? <section className="signin-section">{tab === "join" ? <label className="field"><span>받은 초대 링크 또는 코드</span><input autoFocus value={code} onChange={e => setCode(e.target.value)} placeholder="초대 링크를 여기에 붙여넣으세요" /></label> : <div className="signin-symbol"><Users size={26} strokeWidth={1.4} /></div>}<h3>{tab === "join" ? "로그인하고 짝꿍의 캘린더에 연결해요" : "우리 둘만의 공간을 안전하게"}</h3><p>이메일 또는 Google 계정으로 로그인하면<br />두 사람의 일정을 저장하고 함께 사용할 수 있어요.</p><a className="primary-button full-width" href={signInHref} target="_top">로그인하고 시작하기<ArrowUpRight size={16} /></a></section> : tab === "join" && !connected ? <form onSubmit={join} className="settings-form"><label className="field"><span>받은 초대 링크 또는 코드</span><input autoFocus required value={code} onChange={e => setCode(e.target.value)} placeholder="초대 링크를 여기에 붙여넣으세요" /></label><p className="field-hint">초대가 유효하면 짝꿍의 캘린더에 연결돼요.<br />연결 후 서로의 모든 일정을 확인하고 수정할 수 있어요.</p><button className="primary-button full-width" disabled={busy}>{busy ? "연결 중…" : "우리 캘린더에 연결"}<ArrowUpRight size={16} /></button></form> : <form onSubmit={submit} className="settings-form"><label className="field"><span>캘린더 이름</span><input autoFocus={!connected} required maxLength={50} value={input.name} onChange={e => change("name", e.target.value)} placeholder="우리의 캘린더" /></label><div className="two-fields"><label className="field"><span><i className="inline-dot owner-a" />첫 번째 이름{state?.viewerSlot === "a" ? " (나)" : ""}</span><input required maxLength={24} value={input.aName} onChange={e => change("aName", e.target.value)} /></label><label className="field"><span><i className="inline-dot owner-b" />두 번째 이름{state?.viewerSlot === "b" ? " (나)" : ""}</span><input required maxLength={24} value={input.bName} onChange={e => change("bName", e.target.value)} /></label></div><label className="field"><span>우리의 기념일 <span className="optional">선택</span></span><input type="date" min="1970-01-01" max="2100-12-31" value={input.anniversary || ""} onChange={e => change("anniversary", e.target.value || null)} /></label><p className="field-hint">이름별 일정도 두 사람에게 모두 보여요.</p><button className="primary-button full-width" disabled={busy}>{busy ? "저장 중…" : connected ? "변경 사항 저장" : "우리 캘린더 시작하기"}{!connected ? <ArrowUpRight size={16} /> : null}</button></form>}
      {connected ? <section className="invite-section"><div className="section-heading"><MailPlus size={19} /><h3>짝꿍 초대</h3></div>{state.members.every(member => member.connected) ? <p className="field-hint">짝꿍이 연결됐어요. 이 공간은 두 사람만 함께 사용해요.</p> : <><p>링크를 받은 사람이 로그인하면,<br />같은 캘린더를 함께 사용할 수 있어요.</p><button type="button" className="secondary-button full-width" disabled={busy} onClick={() => void copyInvite()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "초대 링크 복사 완료" : "초대 링크 만들고 복사"}</button>{link ? <><label className="field invite-url"><span>초대 링크 · 7일 동안 유효</span><input readOnly aria-label="생성된 초대 링크" value={link.url} onFocus={e => e.target.select()} /></label><button className="text-button danger-text" disabled={busy} onClick={() => void run(async () => { await onRevoke(); setLink(null); setCopied(false); setNotice("초대 링크를 해제했어요."); })}>이 초대 링크 해제</button></> : state.invite ? <p className="field-hint">진행 중인 초대가 있어요. 다시 만들면 기존 링크는 해제돼요.</p> : null}</>}</section> : null}
      {notice ? <p className="inline-notice success" role="status"><Check size={16} />{notice}</p> : null}
      {connected || demo ? <button type="button" className="settings-notification-entry" onClick={onNotifications}><Bell size={19} /><span>내 알림 설정<small>미리 알림 · 짝꿍 소식 · 조용한 시간</small></span><ChevronRight size={16} /></button> : null}
      <button type="button" className="settings-notification-entry" onClick={onFeedback}><MessageSquare size={19} /><span>의견 보내기<small>불편한 점이나 바라는 기능을 알려주세요</small></span><ChevronRight size={16} /></button>{feedbackAdmin ? <a className="settings-notification-entry feedback-admin-link" href="/admin"><ClipboardList size={19} /><span>관리자 페이지<small>피드백 백로그 확인·관리</small></span><ChevronRight size={16} /></a> : null}
      {error ? <p className="form-error" role="alert"><AlertCircle size={16} />{error}</p> : null}
      {!error && connectionError && !connected && !requiresSignIn ? <p className="inline-notice"><AlertCircle size={16} />{connectionError}</p> : null}
      <div className="settings-bottom"><span><Users size={15} />두 사람만의 공유 공간</span>{connected && demo ? <button className="text-button" onClick={onLive}>내 캘린더로 이동 →</button> : <button className="text-button" onClick={() => { onDemo(); onClose(); }}>예시로 둘러보기 →</button>}</div>
      {state?.user ? <div className="settings-account"><span>{state.user.name} 계정으로 로그인됨</span><a href="/logout" target="_top">로그아웃</a></div> : null}
    </div>
  </Dialog>;
}
