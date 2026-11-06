"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Clock3, MapPin, AlignLeft, Repeat2, AlertCircle, Check, Heart, ChevronDown, SlidersHorizontal } from "lucide-react";
import { CalendarError, eventsOverlap, parseEvent, type CalendarEvent, type CalendarEventInput, type OwnerScope } from "@/lib/domain/calendar";
import { CATEGORY_NAMES, REPEAT_NAMES, shortDate } from "@/lib/client/calendar-view";
import Dialog from "./dialog";

export const OWNERS: OwnerScope[] = ["a", "b", "both"];
export type OwnerNames = Record<OwnerScope, string>;

function comparableInput(input: CalendarEventInput) {
  return JSON.stringify({ ...input, startTime: input.allDay ? null : input.startTime, endTime: input.allDay ? null : input.endTime });
}

export default function EventEditor({ date, event, events, names, demo, onSave, onClose }: { date: string; event?: CalendarEvent; events: CalendarEvent[]; names: OwnerNames; demo: boolean; onSave: (input: CalendarEventInput, event?: CalendarEvent, clientRequestId?: string) => Promise<void>; onClose: () => void }) {
  const [input, setInput] = useState<CalendarEventInput>(() => event ? { title: event.title, startDate: event.originalStartDate, endDate: event.originalEndDate, startTime: event.startTime, endTime: event.endTime, allDay: event.allDay, ownerScope: event.ownerScope, category: event.category, location: event.location, note: event.note, repeat: event.repeat, repeatUntil: event.repeatUntil } : { title: "", startDate: date, endDate: date, startTime: null, endTime: null, allDay: true, ownerScope: "both", category: "life", location: "", note: "", repeat: "none", repeatUntil: null });
  const [initial] = useState(() => comparableInput(input));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [multipleDays, setMultipleDays] = useState(false);
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const dirty = comparableInput(input) !== initial;
  const conflict = useMemo(() => {
    if (input.allDay) return undefined;
    try { const valid = parseEvent({ ...input, title: input.title || "일정" }); return events.find(other => !other.allDay && other.id !== event?.id && eventsOverlap(valid, other)); }
    catch { return undefined; }
  }, [input, events, event?.id]);
  function change<K extends keyof CalendarEventInput>(key: K, value: CalendarEventInput[K]) { setInput(old => ({ ...old, [key]: value })); setError(""); }
  function changeStartDate(value: string) {
    setInput(old => ({ ...old, startDate: value, endDate: !event && !multipleDays ? value : old.endDate < value ? value : old.endDate }));
    setError("");
  }
  function setAllDay(allDay: boolean) {
    setInput(old => allDay ? { ...old, allDay: true } : { ...old, allDay: false, startTime: old.startTime || "09:00", endTime: old.endTime || "10:00" });
    setError("");
  }
  function close() { if (busy) return; if (dirty) setDiscard(true); else onClose(); }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    try { const valid = parseEvent(input); setBusy(true); await onSave(valid, event, clientRequestId); }
    catch (err) { if (!event && err instanceof CalendarError) setExtraOpen(true); setError(err instanceof Error ? err.message : "일정을 저장하지 못했어요. 다시 시도해주세요."); }
    finally { setBusy(false); }
  }

  const timeInputs = <div className="date-input-row time-input-row"><label className="field"><span>시작 시간</span><input type="time" required value={input.startTime || ""} onChange={e => change("startTime", e.target.value)} /></label><span className="input-dash">—</span><label className="field"><span>종료 시간</span><input type="time" required value={input.endTime || ""} onChange={e => change("endTime", e.target.value)} /></label></div>;
  const extraFields = <>
    {!event ? <div className="event-range-options"><label className="switch-label"><span>여러 날에 걸친 일정</span><input type="checkbox" className="switch-input" checked={multipleDays} disabled={!extraOpen} onChange={e => { const checked = e.target.checked; setMultipleDays(checked); if (!checked) change("endDate", input.startDate); }} /><span className="switch-track" aria-hidden="true" /></label>{multipleDays ? <label className="field event-end-date"><span>종료일</span><input type="date" min={input.startDate} max="2100-12-31" value={input.endDate} disabled={!extraOpen} onChange={e => change("endDate", e.target.value)} /></label> : null}</div> : null}
    <div className="form-section"><Repeat2 size={18} className="section-icon" /><div className="section-fields"><label className="field"><span>반복</span><select value={input.repeat} disabled={!event && !extraOpen} onChange={e => change("repeat", e.target.value as CalendarEventInput["repeat"])}>{Object.entries(REPEAT_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{input.repeat !== "none" ? <><label className="field repeat-until"><span>반복 종료일 <span className="optional">선택</span></span><input type="date" min={input.startDate} max="2100-12-31" value={input.repeatUntil || ""} disabled={!event && !extraOpen} onChange={e => change("repeatUntil", e.target.value || null)} /></label><p className="field-hint">{input.repeat === "monthly" || input.repeat === "yearly" ? "해당 날짜가 없는 달·해는 건너뛰어요. " : ""}{event ? `첫 일정 ${shortDate(event.originalStartDate)}부터 전체 반복 일정을 수정해요.` : "종료일을 비우면 계속 반복돼요."}</p></> : null}</div></div>
    <div className="form-section"><Heart size={18} className="section-icon" /><label className="field section-fields"><span>카테고리</span><select value={input.category} disabled={!event && !extraOpen} onChange={e => { const category = e.target.value as CalendarEventInput["category"]; setInput(old => ({ ...old, category, ...(category === "anniversary" ? { allDay: true, repeat: "yearly" } : {}) })); setError(""); }}>{Object.entries(CATEGORY_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{input.category === "anniversary" ? <span className="field-hint">기념일은 종일 · 매년 반복으로 시작해요.</span> : null}</label></div>
    <div className="form-section"><MapPin size={18} className="section-icon" /><label className="field section-fields"><span>장소 <span className="optional">선택</span></span><input maxLength={200} value={input.location} disabled={!event && !extraOpen} onChange={e => change("location", e.target.value)} placeholder="장소를 남겨보세요" /></label></div>
    <div className="form-section"><AlignLeft size={18} className="section-icon" /><label className="field section-fields"><span>메모 <span className="optional">선택</span></span><textarea rows={3} maxLength={2000} value={input.note} disabled={!event && !extraOpen} onChange={e => change("note", e.target.value)} placeholder="잊지 않고 싶은 이야기" /></label></div>
  </>;

  return <Dialog title={event ? "일정 수정" : "새 일정"} eyebrow={demo ? "둘러보기 · 예시 일정" : event ? "우리의 약속을 바꿔요" : "작은 약속을 남겨보세요"} onClose={close} className={`event-editor ${event ? "event-editor-existing" : "event-editor-quick"}`}>
    {discard ? <div className="discard-confirm" role="alert"><AlertCircle size={28} /><h3>작성하던 내용을 닫을까요?</h3><p>아직 저장하지 않은 내용이 있어요.</p><div className="button-row"><button className="secondary-button" onClick={() => setDiscard(false)}>계속 작성</button><button className="primary-button" onClick={onClose}>닫기</button></div></div> : <form onSubmit={submit} className="event-form">
      <div className="dialog-body event-entry-body"><fieldset className="event-inputs" disabled={busy}>
        <label className="field title-field"><span className="sr-only">일정 제목</span><input autoFocus required maxLength={100} value={input.title} onChange={e => change("title", e.target.value)} placeholder="어떤 일정인가요?" autoComplete="off" enterKeyHint="done" aria-describedby={error ? "event-error" : undefined} /></label>
        <div className="owner-picker" aria-label="누구의 일정인가요?">{OWNERS.map(owner => <button type="button" key={owner} className={`owner-option owner-${owner} ${input.ownerScope === owner ? "active" : ""}`} aria-pressed={input.ownerScope === owner} onClick={() => change("ownerScope", owner)}><span className="owner-dot" />{names[owner]}{input.ownerScope === owner ? <Check size={14} /> : null}</button>)}</div>
        {!event ? <section className="event-quick-date" aria-label="일정 날짜와 시간"><div className="event-date-topline"><label className="field"><span><CalendarDays size={15} />날짜</span><input type="date" required min="1970-01-01" max="2100-12-31" value={input.startDate} onChange={e => changeStartDate(e.target.value)} /></label><button type="button" className={`event-time-choice ${input.allDay ? "" : "has-time"}`} aria-pressed={!input.allDay} onClick={() => setAllDay(!input.allDay)}><Clock3 size={16} />{input.allDay ? "시간 추가" : "종일로 변경"}</button></div><div className="event-date-caption"><span className={input.allDay ? "event-all-day-badge" : "event-timed-badge"}>{input.allDay ? "종일" : "시간 지정"}{multipleDays ? " · 여러 날" : ""}</span><span>한국 시간 · 서울</span></div>{!input.allDay ? timeInputs : null}</section> : <><p className="field-hint">모든 일정은 두 사람에게 함께 보여요.</p><div className="form-section"><CalendarDays size={18} className="section-icon" /><div className="section-fields"><div className="date-input-row"><label className="field"><span>시작일</span><input type="date" required min="1970-01-01" max="2100-12-31" value={input.startDate} onChange={e => changeStartDate(e.target.value)} /></label><span className="input-dash">—</span><label className="field"><span>종료일</span><input type="date" required min={input.startDate} max="2100-12-31" value={input.endDate} onChange={e => change("endDate", e.target.value)} /></label></div><label className="switch-label"><span>종일</span><input type="checkbox" className="switch-input" checked={input.allDay} onChange={e => setAllDay(e.target.checked)} /><span className="switch-track" aria-hidden="true" /></label>{!input.allDay ? timeInputs : null}<p className="field-hint">한국 시간 · 서울</p></div></div></>}
        {!event ? <details className="event-extra-options" open={extraOpen} onToggle={e => setExtraOpen(e.currentTarget.open)}><summary><SlidersHorizontal size={16} /><span>{input.repeat !== "none" ? `${REPEAT_NAMES[input.repeat]} · ` : ""}반복·기간·장소·메모</span><ChevronDown size={17} /></summary><div className="event-extra-fields">{extraFields}</div></details> : extraFields}
      </fieldset>
        {conflict ? <p className="inline-notice"><Clock3 size={16} />{`이 시간에 ‘${conflict.title}’ 일정이 겹쳐요. 확인 후에도 저장할 수 있어요.`}</p> : null}
        {demo ? <p className="event-demo-caption">예시 일정이에요. 실제 캘린더에는 저장되지 않아요.</p> : null}
        {error ? <p id="event-error" className="form-error" role="alert"><AlertCircle size={16} />{error}</p> : null}
      </div>
      <footer className="dialog-footer event-entry-footer"><button type="button" className="secondary-button" disabled={busy} onClick={close}>취소</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "저장 중…" : event ? "변경 저장" : "일정 저장"}</button></footer>
    </form>}
  </Dialog>;
}
