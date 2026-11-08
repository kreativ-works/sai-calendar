"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, ClipboardPaste, LoaderCircle, MessageCircle, Mic, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import Dialog from "@/components/calendar/dialog";
import { api, ApiError } from "@/lib/client/api";
import { captureSessionContext } from "@/lib/client/session-context";
import { clearAssistantHandoff, takeAssistantHandoff } from "@/lib/client/assistant-handoff";
import { eventsOverlap, parseEvent, type CalendarEventInput, type CalendarState } from "@/lib/domain/calendar";
import { ASSISTANT_TEXT_MAX, type AssistantCandidate, type AssistantConfig, type AssistantResult, type AssistantSource } from "@/lib/domain/assistant";
import CandidateCard, { candidateDate, type AssistantOwnerNames, type CandidateRow } from "./candidate-card";

const invalidSession = (cause: unknown) => cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || cause.code === "SESSION_CHANGED");

function makeRow(candidate: AssistantCandidate, existing: CalendarState["events"]): CandidateRow {
  const warnings: string[] = [];
  let valid = true;
  try { parseEvent(candidate.event); } catch { valid = false; warnings.push("날짜나 시간 등 일정 내용을 직접 확인해주세요."); }
  const duplicate = candidate.action === "create" && existing.some(event => event.title === candidate.event.title && event.startDate === candidate.event.startDate && event.endDate === candidate.event.endDate && event.allDay === candidate.event.allDay && event.startTime === candidate.event.startTime && event.endTime === candidate.event.endTime && event.ownerScope === candidate.event.ownerScope);
  if (duplicate) warnings.push("캘린더에 같은 제목·시간의 일정이 있어요. 중복인지 확인해주세요.");
  if (valid && !candidate.event.allDay && candidate.action !== "delete") {
    const overlap = existing.find(event => event.id !== candidate.eventId && !event.allDay && eventsOverlap(event, candidate.event));
    if (overlap && !duplicate) warnings.push(`‘${overlap.title}’ 일정과 시간이 겹쳐요.`);
  }
  const needsReview = candidate.needsReview || !valid || duplicate;
  return { candidate: { ...candidate, needsReview }, selected: candidate.action === "create" && !needsReview && candidate.event.repeat === "none", reviewed: false, attempted: false, status: "ready", error: "", extraWarnings: warnings };
}

export default function AssistantClient({ userId, initialState }: { userId: string; initialState: CalendarState }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<AssistantSource>("paste");
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [configLoading, setConfigLoading] = useState(true);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzedText, setAnalyzedText] = useState("");
  const alive = useRef(true);
  const requests = useRef(0);
  const busy = useRef(false);
  const privacyGeneration = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const candidatesHeading = useRef<HTMLHeadingElement>(null);
  const configController = useRef<AbortController | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const names: AssistantOwnerNames = { a: initialState.members.find(member => member.slot === "a")?.name || "첫 번째 사람", b: initialState.members.find(member => member.slot === "b")?.name || "짝꿍", both: "함께" };

  const clearPrivate = useCallback(() => {
    ++privacyGeneration.current; ++requests.current;
    clearAssistantHandoff();
    analysisController.current?.abort(); configController.current?.abort();
    busy.current = false; setText(""); setSource("paste"); setRows([]); setSummary(""); setNotice(""); setConfig(null); setConfigLoading(false); setAnalyzed(false); setAnalyzedText(""); setConfirming(false); setDiscarding(false); setAnalyzing(false); setSaving(false); setRestricted(true); setError("계정이 변경되었거나 로그인 확인이 필요해요. 캘린더를 다시 열어주세요.");
  }, []);
  const refreshConfig = useCallback(async () => {
    configController.current?.abort(); const controller = new AbortController(); configController.current = controller;
    const generation = privacyGeneration.current;
    setConfigLoading(true); setConfigError("");
    try { const result = await api<AssistantConfig>("/api/assistant/config", { signal: controller.signal }); if (alive.current && generation === privacyGeneration.current && !controller.signal.aborted) setConfig(result); }
    catch (cause) { if (!alive.current || controller.signal.aborted || generation !== privacyGeneration.current) return; if (invalidSession(cause)) clearPrivate(); else setConfigError(cause instanceof Error ? cause.message : "AI 연결 상태를 확인하지 못했어요."); }
    finally { if (alive.current && generation === privacyGeneration.current && !controller.signal.aborted) setConfigLoading(false); }
  }, [clearPrivate]);
  // Read live configuration once per account; raw text remains only in this page's memory.
  useEffect(() => { alive.current = true; void refreshConfig(); return () => { alive.current = false; analysisController.current?.abort(); configController.current?.abort(); }; }, [userId, refreshConfig]);
  useEffect(() => { window.addEventListener("sai:session-changed", clearPrivate); return () => window.removeEventListener("sai:session-changed", clearPrivate); }, [clearPrivate]);
  useEffect(() => {
    let active = true;
    const generation = privacyGeneration.current;
    void takeAssistantHandoff(userId).then(handoff => {
      if (!active || generation !== privacyGeneration.current) return;
      if (handoff) { setText(handoff.text); setSource(handoff.source); if (handoff.notice) setNotice(handoff.notice); }
      clearAssistantHandoff();
    }).catch(cause => {
      if (!active || generation !== privacyGeneration.current) return;
      if (invalidSession(cause)) clearPrivate();
      else setError(cause instanceof Error ? cause.message : "공유 내용을 가져오지 못했어요. 다시 공유하거나 붙여넣어주세요.");
      clearAssistantHandoff();
    });
    return () => { active = false; };
  }, [userId, clearPrivate]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { if ((!analyzed && text.trim()) || (analyzed && text.trim() !== analyzedText) || rows.some(row => row.status !== "saved")) event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss); return () => window.removeEventListener("beforeunload", preventLoss);
  }, [text, rows, analyzed, analyzedText]);

  async function analyze() {
    if (busy.current || !config?.configured || restricted) return;
    if (!text.trim()) { setError("일정이 담긴 내용을 먼저 입력해주세요."); textarea.current?.focus(); return; }
    if (text.length > ASSISTANT_TEXT_MAX) { setError("한 번에 6,000자까지 분석할 수 있어요. 필요한 부분만 남겨주세요."); return; }
    busy.current = true; setAnalyzing(true); setError(""); setNotice(""); setRows([]); setSummary(""); setAnalyzed(false);
    const request = ++requests.current; const generation = privacyGeneration.current;
    const controller = new AbortController(); analysisController.current = controller;
    try {
      const result = await api<AssistantResult>("/api/assistant/extract", { method: "POST", body: JSON.stringify({ text: text.trim(), source }), signal: controller.signal });
      if (!alive.current || request !== requests.current || generation !== privacyGeneration.current || controller.signal.aborted) return;
      setRows(result.candidates.map(candidate => makeRow(candidate, initialState.events))); setSummary(result.summary); setAnalyzed(true); setAnalyzedText(text.trim());
      window.requestAnimationFrame(() => { candidatesHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" }); candidatesHeading.current?.focus({ preventScroll: true }); });
    } catch (cause) {
      if (!alive.current || request !== requests.current || generation !== privacyGeneration.current || controller.signal.aborted) return;
      if (invalidSession(cause)) clearPrivate(); else { setError(cause instanceof Error ? cause.message : "일정을 찾지 못했어요. 입력한 내용은 그대로 두었으니 다시 시도해주세요."); if (cause instanceof ApiError && cause.status === 503) void refreshConfig(); }
    } finally { if (alive.current && request === requests.current && generation === privacyGeneration.current) { busy.current = false; setAnalyzing(false); } }
  }
  function requestAnalysis() {
    if (busy.current) return;
    if (rows.some(row => row.status !== "saved")) setDiscarding(true);
    else void analyze();
  }
  function updateRow(id: string, update: (row: CandidateRow) => CandidateRow) { setRows(previous => previous.map(row => row.candidate.id === id ? update(row) : row)); }
  function editCandidate(id: string, input: CalendarEventInput) { updateRow(id, row => ({ ...row, candidate: { ...row.candidate, event: input }, reviewed: true, selected: true, error: "" })); }
  function reset() { setText(""); setRows([]); setSummary(""); setAnalyzed(false); setAnalyzedText(""); setError(""); setNotice(""); setSource("paste"); }

  const selected = rows.filter(row => row.selected && row.status !== "saved" && row.status !== "conflict");
  const savedCount = rows.filter(row => row.status === "saved").length;
  const failedCount = rows.filter(row => row.status === "failed" || row.status === "conflict").length;
  const selectedUpdates = selected.filter(row => row.candidate.action === "update").length;
  const selectedDeletes = selected.filter(row => row.candidate.action === "delete").length;
  const selectedSeries = selected.filter(row => row.candidate.action !== "create" && (row.candidate.previous?.repeat !== "none" || row.candidate.event.repeat !== "none")).length;
  const staleAnalysis = analyzed && text.trim() !== analyzedText;

  async function saveSelected() {
    if (busy.current || restricted || !selected.length || staleAnalysis) return;
    busy.current = true; setSaving(true); setConfirming(false); setError(""); setNotice("");
    const generation = privacyGeneration.current; const session = captureSessionContext();
    let succeeded = 0, failed = 0;
    for (const row of selected) {
      if (!alive.current || generation !== privacyGeneration.current) break;
      const current = captureSessionContext();
      if (current.changing || current.userId !== session.userId || current.version !== session.version) { clearPrivate(); break; }
      const candidate = row.candidate;
      updateRow(candidate.id, old => ({ ...old, attempted: true, status: "saving", error: "" }));
      try {
        if (candidate.action === "create") await api("/api/events", { method: "POST", body: JSON.stringify({ ...parseEvent(candidate.event), clientRequestId: candidate.id }) });
        else {
          if (!candidate.eventId || !candidate.revision) throw new ApiError("변경할 일정을 확인하지 못했어요. 최신 캘린더를 확인해주세요.", 409);
          await api(`/api/events/${encodeURIComponent(candidate.eventId)}`, { method: candidate.action === "delete" ? "DELETE" : "PATCH", body: JSON.stringify(candidate.action === "delete" ? { revision: candidate.revision } : { ...parseEvent(candidate.event), revision: candidate.revision }) });
        }
        if (!alive.current || generation !== privacyGeneration.current) break;
        ++succeeded; updateRow(candidate.id, old => ({ ...old, status: "saved", selected: false, error: "" }));
      } catch (cause) {
        if (!alive.current || generation !== privacyGeneration.current) break;
        if (invalidSession(cause)) { clearPrivate(); break; }
        ++failed;
        const conflict = cause instanceof ApiError && (cause.status === 409 || (cause.status === 404 && candidate.action !== "create"));
        updateRow(candidate.id, old => ({ ...old, status: conflict ? "conflict" : "failed", selected: !conflict, error: conflict ? "일정이 먼저 바뀌거나 삭제되었어요. 최신 캘린더를 확인하고 다시 분석해주세요." : cause instanceof Error ? cause.message : "저장하지 못했어요. 이 일정만 다시 시도할 수 있어요." }));
      }
    }
    if (alive.current && generation === privacyGeneration.current) {
      busy.current = false; setSaving(false); setNotice(failed ? `${succeeded}개를 반영했어요. 처리하지 못한 ${failed}개는 카드에서 확인해주세요.` : `${succeeded}개의 일정을 캘린더에 반영했어요.`);
    }
  }

  return <main className={`assistant-main ${rows.some(row => row.status !== "saved") ? "has-savebar" : ""}`}>
    <section className="assistant-intro"><p className="assistant-eyebrow"><Sparkles size={15} />YOUR LITTLE SCHEDULING HELPER</p><h1>대화 속 약속을,<br className="assistant-mobile-break" /> 우리 일정으로.</h1><p>주고받은 메시지나 통화 후 메모를 넣어주세요.<br />날짜와 시간을 찾아, 확인한 일정만 담아드려요.</p><ol className="assistant-steps" aria-label="일정 등록 과정"><li className={!analyzed ? "active" : "complete"}><span>{analyzed ? <Check size={12} /> : "1"}</span>내용 입력</li><ChevronRight size={13} aria-hidden="true" /><li className={analyzed && savedCount < rows.length ? "active" : savedCount ? "complete" : ""}><span>2</span>일정 확인</li><ChevronRight size={13} aria-hidden="true" /><li className={savedCount ? "active" : ""}><span>3</span>캘린더에 반영</li></ol></section>
    <div className="assistant-workspace"><section className="assistant-input-panel" aria-label="분석할 내용 입력"><div className="assistant-panel-heading"><div className="assistant-panel-icon"><MessageCircle size={20} /></div><div><h2>어떤 약속을 나눴나요?</h2><p>필요한 부분만 가볍게 남겨주세요.</p></div></div><div className="assistant-source-options" role="group" aria-label="입력 방식"><button type="button" aria-pressed={source !== "voice"} className={source !== "voice" ? "active" : ""} disabled={analyzing || saving || restricted} onClick={() => { setSource("paste"); textarea.current?.focus(); }}><ClipboardPaste size={15} />메시지·메모</button><button type="button" aria-pressed={source === "voice"} className={source === "voice" ? "active" : ""} disabled={analyzing || saving || restricted} onClick={() => { setSource("voice"); textarea.current?.focus(); }}><Mic size={15} />기기 받아쓰기</button></div>{source === "share" ? <p className="assistant-shared-note"><CheckCircle2 size={14} />공유받은 내용을 가져왔어요. 분석하기 전에 확인해주세요.</p> : null}{source === "voice" ? <p className="assistant-voice-hint">아래 입력창을 누른 뒤 휴대폰 키보드의 마이크로 말해주세요. 사이가 통화를 녹음하거나 듣지는 않아요.</p> : null}<label className="sr-only" htmlFor="assistant-text">분석할 메시지 또는 메모</label><textarea ref={textarea} id="assistant-text" value={text} onChange={event => { setText(event.target.value); setError(""); }} maxLength={ASSISTANT_TEXT_MAX} rows={8} disabled={analyzing || saving || restricted} placeholder={source === "voice" ? "키보드의 마이크로 약속을 말해주세요.\n예: 내일 오후 7시에 짝꿍과 저녁 약속, 강남역에서 만나기." : "메신저에서 복사한 내용이나 통화 후 메모를 붙여넣어주세요.\n\n예: 다음 주 토요일 오후 2시에 같이 전시 보러 갈까? 장소는 서울시립미술관이야."} aria-describedby="assistant-privacy assistant-text-count" /><div className="assistant-input-meta"><span>한국 시간 · 서울</span><span id="assistant-text-count">{text.length.toLocaleString("ko-KR")} / 6,000</span></div><div className="assistant-privacy" id="assistant-privacy"><ShieldCheck size={17} /><p>분석하기를 누르면 입력한 내용과 일정 확인에 필요한 정보가 연결된 AI 서비스로 전송돼요. 원문은 일정 메모에 자동으로 넣지 않아요.</p></div>
      <div className={`assistant-connection ${config?.configured ? "is-connected" : ""}`} role="status">{configLoading ? <><LoaderCircle size={15} className="spin" /><span>AI 연결을 확인하고 있어요.</span></> : configError ? <><AlertCircle size={15} /><span>{configError}</span><button type="button" onClick={() => void refreshConfig()} aria-label="AI 연결 다시 확인"><RefreshCw size={15} /></button></> : config?.configured ? <><span className="assistant-connection-dot" /><span>{config.provider === "gemini" ? "Google Gemini" : "OpenAI"} 연결됨{config.model ? ` · ${config.model}` : ""}</span></> : <><AlertCircle size={15} /><span>AI 서비스 연결이 필요해요. 운영자가 연결하면 일정 분석을 사용할 수 있어요.</span><button type="button" onClick={() => void refreshConfig()} aria-label="AI 연결 다시 확인"><RefreshCw size={15} /></button></>}</div>
      {error ? <p className="assistant-notice error" role="alert"><AlertCircle size={17} />{error}</p> : null}<button type="button" className="assistant-analyze primary-button" disabled={analyzing || saving || !config?.configured || !text.trim() || restricted} onClick={requestAnalysis}>{analyzing ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{analyzing ? "대화 속 일정을 찾고 있어요…" : analyzed ? "내용 다시 분석하기" : "일정 찾아보기"}</button><p className="assistant-connect-link"><a href="/assistant/connect">공유·받아쓰기 연결 방법<ArrowRight size={13} /></a></p>
    </section>
    <section className="assistant-results-panel" aria-label="AI가 찾은 일정"><div className="assistant-results-heading"><div><p className="assistant-eyebrow">CHECK BEFORE YOU SAVE</p><h2 ref={candidatesHeading} tabIndex={-1}>{analyzed ? `찾은 일정 ${rows.length}개` : "약속을 정리해드릴게요"}</h2></div>{rows.length ? <span className="assistant-result-count">{savedCount ? `${savedCount}개 반영` : `${selected.length}개 선택`}</span> : null}</div>{analyzing ? <div className="assistant-results-empty is-analyzing" role="status"><div><LoaderCircle size={32} className="spin" /></div><h3>날짜와 시간을 살펴보고 있어요</h3><p>새 약속과 바뀐 약속을 구분하고 있어요.<br />잠시만 기다려주세요.</p></div> : !analyzed ? <div className="assistant-results-empty"><div><CalendarDays size={33} strokeWidth={1.5} /><Sparkles size={17} /></div><h3>메시지 한 번, 일정 여러 개도.</h3><p>입력한 내용을 분석하면 이곳에 일정 후보가 보여요.<br />날짜·시간·주인공을 확인하고 골라 담으세요.</p><span>확인 없이 일정이 바뀌지 않아요</span></div> : !rows.length ? <div className="assistant-results-empty"><div><MessageCircle size={32} strokeWidth={1.5} /></div><h3>등록할 약속을 찾지 못했어요</h3><p>{summary || "언제, 누구와, 무엇을 하는지 조금 더 알려주세요."}</p></div> : <>{staleAnalysis ? <p className="assistant-notice caution"><AlertCircle size={16} />입력한 내용이 바뀌었어요. 다시 분석한 뒤 일정을 반영해주세요.</p> : null}{summary ? <p className="assistant-summary">{summary}</p> : null}<div className="assistant-selection-toolbar"><span>{selected.length}개 선택 · {rows.length}개 중</span><div><button type="button" disabled={saving} onClick={() => setRows(previous => previous.map(row => row.candidate.action !== "create" || row.status === "saved" || row.status === "conflict" || (row.candidate.needsReview && !row.reviewed) ? row : { ...row, selected: true }))}>확인한 새 일정 모두</button><button type="button" disabled={saving} onClick={() => setRows(previous => previous.map(row => ({ ...row, selected: false })))}>선택 해제</button></div></div><div className="assistant-candidate-list">{rows.map(row => <CandidateCard key={row.candidate.id} row={row} names={names} disabled={saving || analyzing || restricted} onSelect={selected => updateRow(row.candidate.id, old => ({ ...old, selected }))} onChange={input => editCandidate(row.candidate.id, input)} onReview={() => updateRow(row.candidate.id, old => ({ ...old, reviewed: true, selected: true }))} />)}</div></>}{notice ? <p className={`assistant-notice ${failedCount ? "caution" : "success"}`} role="status">{failedCount ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}{notice}</p> : null}{savedCount ? <div className="assistant-result-actions"><a className="secondary-button" href="/app"><CalendarDays size={15} />캘린더에서 확인</a>{rows.every(row => row.status === "saved") ? <button type="button" className="text-button" onClick={reset}>다른 내용 입력하기<ArrowRight size={14} /></button> : null}</div> : null}</section></div>
    {rows.length && rows.some(row => row.status !== "saved") ? <div className="assistant-save-bar"><div><strong>{saving ? "캘린더에 반영하고 있어요" : `${selected.length}개 선택했어요`}</strong><span>{saving ? "완료된 일정은 다시 저장하지 않아요." : "날짜·시간·주인공을 한 번 더 확인해주세요."}</span></div><button className="primary-button" type="button" disabled={!selected.length || saving || analyzing || restricted || staleAnalysis} onClick={() => setConfirming(true)}>{saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{saving ? "반영 중…" : `선택한 ${selected.length}개 반영`}</button></div> : null}
    {confirming ? <SaveConfirmation count={selected.length} updates={selectedUpdates} deletes={selectedDeletes} series={selectedSeries} titles={selected.map(row => `${row.candidate.event.title} · ${candidateDate(row.candidate.event)}`)} onClose={() => setConfirming(false)} onSave={() => void saveSelected()} /> : null}
    {discarding ? <Dialog title="새로 분석할까요?" onClose={() => setDiscarding(false)} className="assistant-confirm-dialog"><div className="assistant-dialog-scroll"><p className="assistant-confirm-copy">아직 반영하지 않은 후보와 수정한 내용은 새 분석 결과로 바뀌어요. 이미 반영한 일정은 캘린더에 남아 있어요.</p></div><footer className="assistant-dialog-footer"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscarding(false)}>돌아가기</button><button type="button" className="primary-button" onClick={() => { setDiscarding(false); void analyze(); }}>새로 분석하기</button></footer></Dialog> : null}
  </main>;
}

function SaveConfirmation({ count, updates, deletes, series, titles, onClose, onSave }: { count: number; updates: number; deletes: number; series: number; titles: string[]; onClose: () => void; onSave: () => void }) {
  const [changesConfirmed, setChangesConfirmed] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [seriesConfirmed, setSeriesConfirmed] = useState(false);
  const ready = (!updates || changesConfirmed) && (!deletes || deleteConfirmed) && (!series || seriesConfirmed);
  return <Dialog title="이대로 캘린더에 반영할까요?" eyebrow={`${count}개의 일정을 확인해요`} onClose={onClose} className="assistant-confirm-dialog"><div className="assistant-dialog-scroll"><p className="assistant-confirm-copy">선택한 일정만 반영해요. 함께 쓰는 캘린더라 짝꿍에게도 변경 내용이 보여요.</p><ul className="assistant-confirm-list">{titles.map((title, index) => <li key={index}><Check size={14} /><span>{title}</span></li>)}</ul>{updates ? <label className="assistant-confirm-check"><input type="checkbox" checked={changesConfirmed} onChange={event => setChangesConfirmed(event.target.checked)} /><span>기존 일정 {updates}개의 수정 내용을 확인했어요.</span></label> : null}{deletes ? <label className="assistant-confirm-check is-delete"><input type="checkbox" checked={deleteConfirmed} onChange={event => setDeleteConfirmed(event.target.checked)} /><span>선택한 기존 일정 {deletes}개를 삭제하는 것이 맞아요.</span></label> : null}{series ? <label className="assistant-confirm-check"><input type="checkbox" checked={seriesConfirmed} onChange={event => setSeriesConfirmed(event.target.checked)} /><span>반복 일정 {series}개는 전체 반복 일정에 적용되는 것을 확인했어요.</span></label> : null}</div><footer className="assistant-dialog-footer"><button type="button" className="secondary-button" autoFocus onClick={onClose}>돌아가기</button><button type="button" className="primary-button" disabled={!ready} onClick={onSave}>{deletes ? <Trash2 size={15} /> : <Check size={16} />}확인한 {count}개 반영</button></footer></Dialog>;
}
