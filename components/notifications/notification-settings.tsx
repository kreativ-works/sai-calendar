"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, Bell, BellOff, CheckCircle2, ChevronLeft, Clock3, Download, LoaderCircle, ShieldCheck, Smartphone } from "lucide-react";
import type { NotificationPreferences, NotificationsState } from "@/lib/domain/notifications";
import type { PushDevice } from "@/lib/client/notifications";

function Toggle({ title, description, checked, onChange, disabled = false }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className="notice-toggle"><span><strong>{title}</strong><small>{description}</small></span><span className="notice-switch"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} /><i aria-hidden="true" /></span></label>;
}

type Props = {
  state: NotificationsState;
  demo: boolean;
  device: PushDevice;
  pushActive: boolean;
  pushBusy: boolean;
  pushError: string;
  pushNotice: string;
  onBack: () => void;
  onSave: (preferences: NotificationPreferences) => Promise<NotificationPreferences>;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
};

export default function NotificationSettings({ state, demo, device, pushActive, pushBusy, pushError, pushNotice, onBack, onSave, onEnable, onDisable, onTest }: Props) {
  const [input, setInput] = useState(state.preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [installHelp, setInstallHelp] = useState(false);
  function change<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) { setInput(previous => ({ ...previous, [key]: value })); setSaved(""); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSaved("");
    try { if (input.quietEnabled && input.quietStart === input.quietEnd) throw new Error("조용한 시간의 시작과 끝을 다르게 정해주세요."); const preferences = await onSave(input); setInput(preferences); setSaved(demo ? "예시 설정을 바꿨어요. 실제 알림은 전송되지 않아요." : "내 알림 설정을 저장했어요."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "설정을 저장하지 못했어요. 다시 시도해주세요."); }
    finally { setBusy(false); }
  }
  const pushStatus = demo ? "예시에서는 알림을 보내지 않아요" : !state.push.configured ? "기기 알림을 준비 중이에요" : device.needsInstall ? "홈 화면에 추가하면 알림을 받을 수 있어요" : !device.supported ? "이 브라우저에서는 기기 알림을 지원하지 않아요" : pushActive ? "이 기기의 알림이 켜져 있어요" : device.permission === "denied" ? "기기 또는 브라우저에서 알림이 차단돼 있어요" : "앱을 닫아도 중요한 약속을 받아보세요";
  return <><div className="notice-settings-back"><button type="button" onClick={onBack}><ChevronLeft size={16} />받은 알림</button><span>이 계정에만 적용돼요</span></div><form className="notice-settings-form" onSubmit={submit}>
    <div className="dialog-body notice-settings-body">
      <section className="notice-device-card"><div className="notice-section-heading"><span className="notice-section-icon"><Smartphone size={21} /></span><div><h3>이 기기로 알림 받기</h3><p>{pushStatus}</p></div>{pushActive ? <span className="notice-on-badge">켜짐</span> : null}</div>
        {!demo && state.push.configured && !device.needsInstall && device.supported && device.permission !== "denied" ? <div className="notice-device-actions">{pushActive ? <><button type="button" className="secondary-button" disabled={pushBusy} onClick={onTest}>{pushBusy ? <LoaderCircle size={16} className="spin" /> : <Bell size={16} />}테스트 알림</button><button type="button" className="text-button" disabled={pushBusy} onClick={onDisable}><BellOff size={15} />이 기기에서 끄기</button></> : <button type="button" className="primary-button full-width" disabled={pushBusy} onClick={onEnable}>{pushBusy ? <LoaderCircle size={16} className="spin" /> : <Bell size={16} />}이 기기 알림 켜기</button>}</div> : null}
        {device.permission === "denied" && !demo ? <p className="notice-help-copy">기기나 브라우저의 사이트 설정에서 사이의 알림을 허용한 뒤, 이 화면을 다시 열어주세요.</p> : null}
        {!demo && (device.needsInstall || !device.supported) ? <><button type="button" className="notice-install-toggle" aria-expanded={installHelp} onClick={() => setInstallHelp(!installHelp)}><Download size={16} />홈 화면 추가 방법{installHelp ? " 접기" : " 보기"}</button>{installHelp ? <ol className="notice-install-steps"><li>Safari 또는 Chrome에서 사이를 열어주세요.</li><li>공유 또는 브라우저 메뉴에서 <strong>홈 화면에 추가</strong>를 선택해주세요.</li><li>추가한 사이 앱을 열고 <strong>이 기기 알림 켜기</strong>를 눌러주세요.</li></ol> : null}</> : null}
        {pushError ? <p className="notice-message error" role="alert"><AlertCircle size={16} />{pushError}</p> : null}{pushNotice ? <p className="notice-message success" role="status"><CheckCircle2 size={16} />{pushNotice}</p> : null}
        <p className="notice-device-footnote">기기 알림을 끄더라도 앱 안의 알림함은 확인할 수 있어요.</p>
      </section>
      <section className="notice-preference-section"><h3><Clock3 size={18} />약속을 놓치지 않게</h3><Toggle title="일정 미리 알림" description="나의 일정과 함께하는 약속을 미리 알려드려요." checked={input.reminders} onChange={value => change("reminders", value)} disabled={busy} />{input.reminders ? <div className="notice-indented-fields"><label className="field"><span>미리 알려줄 시간</span><select value={input.minutes} disabled={busy} onChange={event => change("minutes", Number(event.target.value) as NotificationPreferences["minutes"])}><option value={10}>10분 전</option><option value={30}>30분 전</option><option value={60}>1시간 전</option><option value={1440}>하루 전</option></select></label><label className="field"><span>종일 일정 알림 시간</span><input type="time" required value={input.allDayTime} disabled={busy} onChange={event => change("allDayTime", event.target.value)} /></label><Toggle title="짝꿍의 일정도 미리 알림" description="짝꿍만의 일정도 같은 기준으로 알려드려요." checked={input.includePartner} onChange={value => change("includePartner", value)} disabled={busy} /></div> : null}<p className="notice-help-copy">한국 시간 기준 · 미리 알림은 몇 분 늦어질 수 있어요.</p>{!demo && !state.push.schedulerReady ? <p className="notice-message subtle"><Clock3 size={15} />미리 알림을 준비 중이에요. 준비되면 저장한 설정이 적용돼요.</p> : null}</section>
      <section className="notice-preference-section"><h3><Bell size={18} />짝꿍의 소식</h3><Toggle title="짝꿍이 바꾼 일정 알림" description="일정을 추가·수정·삭제하면 소식을 받아요." checked={input.partnerChanges} onChange={value => change("partnerChanges", value)} disabled={busy} /></section>
      <section className="notice-preference-section"><h3><ShieldCheck size={18} />편안하게 받아요</h3><Toggle title="조용한 시간" description="정해둔 시간에는 기기 알림을 쉬어요." checked={input.quietEnabled} onChange={value => change("quietEnabled", value)} disabled={busy} />{input.quietEnabled ? <><div className="notice-quiet-fields"><label className="field"><span>시작</span><input type="time" required value={input.quietStart} disabled={busy} onChange={event => change("quietStart", event.target.value)} /></label><span>—</span><label className="field"><span>끝</span><input type="time" required value={input.quietEnd} disabled={busy} onChange={event => change("quietEnd", event.target.value)} /></label></div><p className="notice-help-copy">{input.quietStart > input.quietEnd ? "다음날 " : ""}{input.quietEnd}까지 기기 알림을 쉬어요. 소식은 알림함에 남아요.</p></> : null}<Toggle title="잠금 화면에 일정 내용 표시" description="끄면 일정 제목과 내용은 앱 안에서만 확인해요." checked={input.preview} onChange={value => change("preview", value)} disabled={busy} /></section>
      {demo ? <p className="notice-message subtle">둘러보기용 설정이에요. 기기 권한을 요청하거나 실제 알림을 보내지 않아요.</p> : null}{error ? <p className="notice-message error" role="alert"><AlertCircle size={16} />{error}</p> : null}{saved ? <p className="notice-message success" role="status"><CheckCircle2 size={16} />{saved}</p> : null}
    </div><footer className="dialog-footer notice-settings-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onBack}>받은 알림으로</button><button type="submit" className="primary-button" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={16} />저장 중…</> : "알림 설정 저장"}</button></footer>
  </form></>;
}
