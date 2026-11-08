"use client";

import { useId, useState, type FormEvent } from "react";
import { AlertCircle, CalendarDays, Check, CheckCircle2, ChevronDown, Clock3, MapPin, Pencil, Repeat2, ShieldCheck, Trash2, UserRound } from "lucide-react";
import Dialog from "@/components/calendar/dialog";
import { parseEvent, type CalendarEventInput, type OwnerScope } from "@/lib/domain/calendar";
import type { AssistantCandidate } from "@/lib/domain/assistant";
import { CATEGORY_NAMES, fullDate, REPEAT_NAMES } from "@/lib/client/calendar-view";

export type CandidateStatus = "ready" | "saving" | "saved" | "failed" | "conflict";
export type CandidateRow = { candidate: AssistantCandidate; selected: boolean; reviewed: boolean; attempted: boolean; status: CandidateStatus; error: string; extraWarnings: string[] };
export type AssistantOwnerNames = Record<OwnerScope, string>;
const actionLabels = { create: "새 일정", update: "수정 제안", delete: "삭제 제안" };

export function candidateDate(event: CalendarEventInput) {
  const date = event.startDate === event.endDate ? fullDate(event.startDate) : `${fullDate(event.startDate)} — ${fullDate(event.endDate)}`;
  return `${date} · ${event.allDay ? "종일" : `${event.startTime || "시간 확인"} — ${event.endTime || "시간 확인"}`}`;
}

function changedFields(previous: CalendarEventInput, next: CalendarEventInput, names: AssistantOwnerNames) {
  const describe = (event: CalendarEventInput) => ({ title: event.title, date: candidateDate(event), owner: names[event.ownerScope], category: CATEGORY_NAMES[event.category], location: event.location || "장소 없음", repeat: `${REPEAT_NAMES[event.repeat]}${event.repeatUntil ? ` · ${event.repeatUntil}까지` : ""}`, note: event.note || "메모 없음" });
  const before = describe(previous), after = describe(next);
  const labels = { title: "제목", date: "날짜·시간", owner: "주인공", category: "분류", location: "장소", repeat: "반복", note: "메모" };
  return (Object.keys(labels) as (keyof typeof labels)[]).filter(key => before[key] !== after[key]).map(key => ({ label: labels[key], before: before[key], after: after[key] }));
}

export default function CandidateCard({ row, names, disabled, onSelect, onChange, onReview }: { row: CandidateRow; names: AssistantOwnerNames; disabled: boolean; onSelect: (selected: boolean) => void; onChange: (input: CalendarEventInput) => void; onReview: () => void }) {
  const [editing, setEditing] = useState(false);
  const fieldId = useId();
  const { candidate, status } = row;
  const { event } = candidate;
  const warnings = [...candidate.warnings, ...row.extraWarnings];
  const selectable = !disabled && status !== "saved" && status !== "conflict" && (!candidate.needsReview || row.reviewed);
  const diff = candidate.action === "update" && candidate.previous ? changedFields(candidate.previous, event, names) : [];

  return <article className={`assistant-candidate action-${candidate.action} state-${status} ${row.selected ? "is-selected" : ""}`}>
    <div className="assistant-candidate-heading"><label className="assistant-candidate-select" htmlFor={fieldId}><input id={fieldId} type="checkbox" checked={row.selected} disabled={!selectable} onChange={change => onSelect(change.target.checked)} /><span className="sr-only">{event.title} {candidate.action === "delete" ? "삭제" : "저장"} 대상으로 선택</span></label><div className="assistant-candidate-tags"><span className={`assistant-action-tag action-${candidate.action}`}>{candidate.action === "delete" ? <Trash2 size={12} /> : candidate.action === "update" ? <Pencil size={12} /> : <CalendarDays size={12} />}{actionLabels[candidate.action]}</span>{status === "saved" ? <span className="assistant-saved-tag"><CheckCircle2 size={12} />{candidate.action === "delete" ? "삭제 완료" : "저장 완료"}</span> : row.reviewed ? <span className="assistant-reviewed-tag"><ShieldCheck size={12} />확인 완료</span> : candidate.needsReview ? <span className="assistant-review-tag">확인 필요</span> : null}</div>{candidate.action !== "delete" && !row.attempted && status !== "saved" ? <button type="button" className="assistant-edit-button" disabled={disabled} onClick={() => setEditing(true)}><Pencil size={14} /><span>수정</span></button> : null}</div>
    <div className="assistant-candidate-content"><h3>{event.title || "제목을 확인해주세요"}</h3><p className="assistant-candidate-date"><Clock3 size={14} /><span>{candidateDate(event)}</span></p><div className="assistant-candidate-meta"><span className={`assistant-owner owner-${event.ownerScope}`}><UserRound size={13} />{names[event.ownerScope]}</span>{event.location ? <span><MapPin size={13} />{event.location}</span> : null}{event.repeat !== "none" ? <span><Repeat2 size={13} />{REPEAT_NAMES[event.repeat]}</span> : null}</div>
      {candidate.reason ? <p className="assistant-candidate-reason">{candidate.reason}</p> : null}
      {diff.length ? <details className="assistant-candidate-diff"><summary><span>바뀌는 내용 {diff.length}개</span><ChevronDown size={15} /></summary><dl>{diff.map(field => <div key={field.label}><dt>{field.label}</dt><dd><del>{field.before}</del><span>{field.after}</span></dd></div>)}</dl></details> : null}
      {warnings.length ? <ul className="assistant-candidate-warnings">{warnings.map((warning, index) => <li key={`${index}-${warning}`}><AlertCircle size={14} /><span>{warning}</span></li>)}</ul> : null}
      {candidate.needsReview && !row.reviewed && status !== "saved" ? <button type="button" className="assistant-review-button" disabled={disabled || row.attempted} onClick={() => candidate.action === "delete" ? onReview() : setEditing(true)}><Check size={14} />{candidate.action === "delete" ? "삭제 대상을 확인했어요" : "내용 확인하고 선택하기"}</button> : null}
      {row.error ? <p className="assistant-row-error" role="alert"><AlertCircle size={14} />{row.error}</p> : null}
      {row.attempted && status === "failed" ? <p className="assistant-row-hint">중복 저장을 막기 위해 같은 내용으로 다시 시도해요.</p> : null}
      {status === "conflict" ? <a className="assistant-conflict-link" href="/app">캘린더에서 최신 일정 확인하기 →</a> : null}
    </div>
    {editing ? <CandidateEditor candidate={candidate} names={names} onClose={() => setEditing(false)} onSave={input => { onChange(input); setEditing(false); }} /> : null}
  </article>;
}

function CandidateEditor({ candidate, names, onClose, onSave }: { candidate: AssistantCandidate; names: AssistantOwnerNames; onClose: () => void; onSave: (input: CalendarEventInput) => void }) {
  const [input, setInput] = useState<CalendarEventInput>(() => ({ ...candidate.event }));
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const dirty = JSON.stringify(input) !== JSON.stringify(candidate.event);
  const fieldId = useId();
  function change<K extends keyof CalendarEventInput>(key: K, value: CalendarEventInput[K]) { setInput(previous => ({ ...previous, [key]: value })); setError(""); }
  function close() { if (dirty) setDiscard(true); else onClose(); }
  function submit(event: FormEvent) { event.preventDefault(); try { onSave(parseEvent(input)); } catch (cause) { setError(cause instanceof Error ? cause.message : "일정 내용을 다시 확인해주세요."); } }

  return <Dialog title="일정 내용 확인" eyebrow="확인한 내용으로 저장해요" onClose={close} className="assistant-editor-dialog">{discard ? <div className="assistant-discard"><h3>수정 중인 내용을 닫을까요?</h3><p>아직 확인하지 않은 변경 사항은 반영되지 않아요.</p><div className="assistant-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscard(false)}>계속 수정하기</button><button type="button" className="primary-button" onClick={onClose}>닫기</button></div></div> : <form className="assistant-editor-form" onSubmit={submit} noValidate><div className="assistant-dialog-scroll"><p className="assistant-editor-hint">날짜와 시간, 누구의 일정인지 확인해주세요. 모든 시간은 한국 시간이에요.</p><label className="field"><span>일정 제목</span><input autoFocus required maxLength={100} value={input.title} onChange={event => change("title", event.target.value)} /></label><fieldset className="assistant-owner-picker"><legend>누구의 일정인가요?</legend>{(["a", "b", "both"] as const).map(owner => <button type="button" key={owner} className={`owner-${owner} ${input.ownerScope === owner ? "active" : ""}`} aria-pressed={input.ownerScope === owner} onClick={() => change("ownerScope", owner)}><span className="owner-dot" />{names[owner]}</button>)}</fieldset><div className="assistant-editor-dates"><label className="field"><span>시작일</span><input type="date" required min="1970-01-01" max="2100-12-31" value={input.startDate} onChange={event => { const date = event.target.value; setInput(previous => ({ ...previous, startDate: date, endDate: previous.endDate < date ? date : previous.endDate })); setError(""); }} /></label><label className="field"><span>종료일</span><input type="date" required min={input.startDate} max="2100-12-31" value={input.endDate} onChange={event => change("endDate", event.target.value)} /></label></div><label className="assistant-all-day"><span>하루 종일</span><input type="checkbox" checked={input.allDay} onChange={event => { const allDay = event.target.checked; setInput(previous => ({ ...previous, allDay, startTime: allDay ? null : previous.startTime || "09:00", endTime: allDay ? null : previous.endTime || "10:00" })); setError(""); }} /></label>{!input.allDay ? <div className="assistant-editor-dates"><label className="field"><span>시작 시간</span><input type="time" required value={input.startTime || ""} onChange={event => change("startTime", event.target.value)} /></label><label className="field"><span>종료 시간</span><input type="time" required value={input.endTime || ""} onChange={event => change("endTime", event.target.value)} /></label></div> : null}<label className="field"><span>장소</span><input maxLength={200} value={input.location} onChange={event => change("location", event.target.value)} placeholder="장소를 확인해주세요" /></label><details className="assistant-editor-extras"><summary>분류·반복·메모<ChevronDown size={15} /></summary><label className="field"><span>분류</span><select value={input.category} onChange={event => change("category", event.target.value as CalendarEventInput["category"])}>{Object.entries(CATEGORY_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>반복</span><select value={input.repeat} onChange={event => change("repeat", event.target.value as CalendarEventInput["repeat"])}>{Object.entries(REPEAT_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{input.repeat !== "none" ? <label className="field"><span>반복 종료일 · 선택</span><input type="date" min={input.startDate} max="2100-12-31" value={input.repeatUntil || ""} onChange={event => change("repeatUntil", event.target.value || null)} /></label> : null}<label className="field" htmlFor={`${fieldId}-note`}><span>일정 메모</span><textarea id={`${fieldId}-note`} maxLength={2000} rows={3} value={input.note} onChange={event => change("note", event.target.value)} /></label></details>{candidate.action === "update" && candidate.previous?.repeat !== "none" ? <p className="assistant-notice caution"><Repeat2 size={16} />이 일정의 전체 반복 내용이 바뀌어요.</p> : null}{error ? <p className="assistant-notice error" role="alert"><AlertCircle size={16} />{error}</p> : null}</div><footer className="assistant-dialog-footer"><button type="button" className="secondary-button" onClick={close}>취소</button><button className="primary-button" type="submit"><Check size={16} />이 내용으로 선택</button></footer></form>}</Dialog>;
}
