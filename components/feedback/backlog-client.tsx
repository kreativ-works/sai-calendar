"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowLeft, ArrowUpRight, Bug, Check, ChevronDown, ChevronRight, ClipboardList, Inbox, Lightbulb, LoaderCircle, LockKeyhole, MessageCircle, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import Dialog from "@/components/calendar/dialog";
import { api, ApiError } from "@/lib/client/api";
import { FEEDBACK_CATEGORY_LABELS, FEEDBACK_TEXT_MAX, FEEDBACK_PRIORITY_LABELS, FEEDBACK_STATUS_LABELS, type FeedbackBacklog, type FeedbackCategory, type FeedbackItem, type FeedbackPriority, type FeedbackStatus } from "@/lib/domain/feedback";

const statuses = ["new", "planned", "in_progress", "done", "declined"] as const;
const priorities = ["none", "low", "medium", "high"] as const;
const categories = ["bug", "idea", "other"] as const;
const categoryIcons = { bug: Bug, idea: Lightbulb, other: MessageCircle };
type Filters = { status: "all" | FeedbackStatus; priority: "all" | FeedbackPriority; category: "all" | FeedbackCategory; q: string };
const emptyCounts: FeedbackBacklog["counts"] = { all: 0, new: 0, planned: 0, in_progress: 0, done: 0, declined: 0 };
const denied = (cause: unknown) => cause instanceof ApiError && (cause.status === 401 || cause.status === 403 || cause.code === "SESSION_CHANGED");
const timestamp = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

export default function BacklogClient() {
  const [filters, setFilters] = useState<Filters>({ status: "all", priority: "all", category: "all", q: "" });
  const [query, setQuery] = useState("");
  const [state, setState] = useState<FeedbackBacklog>({ items: [], nextCursor: null, counts: emptyCounts });
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const requestId = useRef(0);
  const privacyGeneration = useRef(0);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);

  const clearPrivateData = useCallback(() => {
    ++privacyGeneration.current; ++requestId.current; controller.current?.abort();
    setState({ items: [], nextCursor: null, counts: emptyCounts }); setSelected(null); setRestricted(true); setLoading(false); setMoreLoading(false);
  }, []);
  const load = useCallback(async (cursor?: string) => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const request = ++requestId.current;
    if (cursor) setMoreLoading(true); else setLoading(true);
    setError("");
    const params = new URLSearchParams(filters);
    if (cursor) params.set("cursor", cursor);
    try {
      const next = await api<FeedbackBacklog>(`/api/feedback?${params}`, { signal: abort.signal });
      if (!alive.current || request !== requestId.current) return;
      setState(previous => ({ ...next, items: cursor ? [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.id === item.id))] : next.items }));
      setRestricted(false); setUpdatedAt(new Date().toISOString());
    } catch (cause) {
      if (!alive.current || request !== requestId.current || abort.signal.aborted) return;
      if (denied(cause)) clearPrivateData();
      setError(cause instanceof Error ? cause.message : "의견을 불러오지 못했어요. 다시 시도해주세요.");
    } finally { if (alive.current && request === requestId.current) { setLoading(false); setMoreLoading(false); } }
  }, [filters, clearPrivateData]);
  // The list is external account-scoped data. Discard it on permission/session changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; controller.current?.abort(); }; }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    const changed = () => { clearPrivateData(); setError("계정이 변경됐어요. 이 페이지를 다시 열어 권한을 확인해주세요."); };
    window.addEventListener("sai:session-changed", changed);
    return () => window.removeEventListener("sai:session-changed", changed);
  }, [clearPrivateData]);

  function search(event: FormEvent) { event.preventDefault(); setFilters(previous => ({ ...previous, q: query.trim() })); }
  function saved(item: FeedbackItem) {
    setSelected(item); setState(previous => ({ ...previous, items: previous.items.map(old => old.id === item.id ? item : old) }));
    void load();
  }
  const filtered = filters.q || filters.category !== "all" || filters.priority !== "all" || filters.status !== "all";
  const renderedGeneration = privacyGeneration.current;

  return <main className="feedback-backlog">
    <section className="backlog-hero"><div><p className="backlog-eyebrow"><MessageCircle size={15} />FEEDBACK & IDEAS</p><h1>피드백 백로그</h1><p>작은 불편부터 좋은 아이디어까지.<br className="backlog-mobile-break" /> 보내주신 의견을 확인하고 다음을 정해요.</p></div><div className="backlog-new-count"><span>새로 온 의견</span><strong>{state.counts.new}<small>개</small></strong><span>하나씩 살펴볼까요?</span></div></section>
    <div className="backlog-workspace"><aside className="backlog-sidebar"><p>개선 목록</p><nav aria-label="의견 처리 상태"><button className={filters.status === "all" ? "active" : ""} aria-pressed={filters.status === "all"} onClick={() => setFilters(previous => ({ ...previous, status: "all" }))}><ClipboardList size={17} /><span>전체 의견</span><strong>{state.counts.all}</strong></button>{statuses.map(value => <button key={value} className={filters.status === value ? `active status-${value}` : `status-${value}`} aria-pressed={filters.status === value} onClick={() => setFilters(previous => ({ ...previous, status: value }))}><i /><span>{FEEDBACK_STATUS_LABELS[value]}</span><strong>{state.counts[value]}</strong></button>)}</nav><div className="backlog-private-note"><LockKeyhole size={16} /><p>운영자만 볼 수 있는 공간이에요. 작성자 정보와 내부 메모는 공개되지 않아요.</p></div></aside>
      <section className="backlog-main" aria-label="접수된 의견"><div className="backlog-list-heading"><h2>{filters.status === "all" ? "전체 의견" : FEEDBACK_STATUS_LABELS[filters.status]}<span>{state.counts[filters.status]}</span></h2><button className="backlog-refresh" type="button" disabled={loading || moreLoading} onClick={() => void load()} aria-label="의견 새로고침"><RefreshCw size={16} className={loading ? "spin" : ""} /><span>새로고침</span></button></div>
        <form className="backlog-search" role="search" onSubmit={search}><Search size={18} /><input aria-label="의견 검색" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="내용, 이름, 이메일로 검색" /><button type="submit">검색</button></form>
        <div className="backlog-filter-row"><div className="backlog-category-filter" role="group" aria-label="의견 종류"><button type="button" className={filters.category === "all" ? "active" : ""} aria-pressed={filters.category === "all"} onClick={() => setFilters(previous => ({ ...previous, category: "all" }))}>전체</button>{categories.map(value => { const Icon = categoryIcons[value]; return <button key={value} type="button" className={filters.category === value ? "active" : ""} aria-pressed={filters.category === value} onClick={() => setFilters(previous => ({ ...previous, category: value }))}><Icon size={14} />{FEEDBACK_CATEGORY_LABELS[value]}</button>; })}</div><label className="backlog-priority-filter"><SlidersHorizontal size={15} /><span className="sr-only">우선순위</span><select value={filters.priority} onChange={event => setFilters(previous => ({ ...previous, priority: event.target.value as Filters["priority"] }))}><option value="all">우선순위 전체</option>{priorities.map(value => <option value={value} key={value}>{FEEDBACK_PRIORITY_LABELS[value]}</option>)}</select><ChevronDown size={13} /></label></div>
        {filters.q ? <div className="backlog-search-summary"><span>‘{filters.q}’ 검색 결과</span><button type="button" onClick={() => { setQuery(""); setFilters(previous => ({ ...previous, q: "" })); }}>검색 해제</button></div> : null}
        {error ? <div className="feedback-message error backlog-error" role="alert"><AlertCircle size={18} /><div><p>{error}</p>{restricted ? <a href="/login?returnTo=%2Fadmin%2Fbacklog">로그인 확인하기<ArrowUpRight size={14} /></a> : <button type="button" onClick={() => void load()}>다시 불러오기</button>}</div></div> : null}
        {loading ? <div className="backlog-loading" role="status"><LoaderCircle size={22} className="spin" /><p>보내주신 의견을 모으고 있어요…</p></div> : !state.items.length && !restricted ? <div className="backlog-empty"><div><Inbox size={30} strokeWidth={1.4} /></div><h3>{filtered ? "조건에 맞는 의견이 없어요" : "첫 번째 의견을 기다리고 있어요"}</h3><p>{filtered ? "검색어나 필터를 바꿔 다시 살펴보세요." : "사용자가 캘린더에서 의견을 보내면 이곳에 차곡차곡 모여요."}</p>{filtered ? <button type="button" className="secondary-button" onClick={() => { setQuery(""); setFilters({ status: "all", priority: "all", category: "all", q: "" }); }}>전체 의견 보기</button> : null}</div> : <ul className="backlog-items">{state.items.map(item => { const Icon = categoryIcons[item.category]; return <li key={item.id}><button type="button" className="backlog-card" onClick={() => setSelected(item)} aria-label={`${item.title}, ${FEEDBACK_STATUS_LABELS[item.status]}, 상세 보기`}><div className={`backlog-card-icon category-${item.category}`}><Icon size={19} /></div><div className="backlog-card-content"><div className="backlog-card-topline"><span className={`feedback-status status-${item.status}`}>{FEEDBACK_STATUS_LABELS[item.status]}</span>{item.priority !== "none" ? <span className={`feedback-priority priority-${item.priority}`}><i />{FEEDBACK_PRIORITY_LABELS[item.priority]}</span> : null}<time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time></div><h3>{item.title}</h3><p>{item.message}</p><div className="backlog-card-meta"><span>{FEEDBACK_CATEGORY_LABELS[item.category]}</span><i /><span>{item.reporterName || "사용자"}</span><span className="backlog-receipt">#{item.id.slice(0, 8).toUpperCase()}</span></div></div><ChevronRight size={17} className="backlog-card-chevron" /></button></li>; })}</ul>}
        {state.nextCursor && !loading ? <button type="button" className="backlog-load-more secondary-button" disabled={moreLoading} onClick={() => void load(state.nextCursor || undefined)}>{moreLoading ? <LoaderCircle size={16} className="spin" /> : <ChevronDown size={16} />}{moreLoading ? "불러오는 중…" : "이전 의견 더 보기"}</button> : null}
        {updatedAt && !loading && !restricted ? <p className="backlog-updated">마지막 확인 {timestamp(updatedAt)}</p> : null}
      </section>
    </div>
    {selected ? <FeedbackDetail key={selected.id} item={selected} onSaved={item => { if (renderedGeneration === privacyGeneration.current) saved(item); }} onClose={() => setSelected(null)} onDenied={cause => { clearPrivateData(); setError(cause instanceof Error ? cause.message : "이 페이지를 볼 권한을 확인해주세요."); }} /> : null}
  </main>;
}

function FeedbackDetail({ item, onSaved, onClose, onDenied }: { item: FeedbackItem; onSaved: (item: FeedbackItem) => void; onClose: () => void; onDenied: (cause: unknown) => void }) {
  const fieldId = useId();
  const [base, setBase] = useState(item);
  const [status, setStatus] = useState(item.status);
  const [priority, setPriority] = useState(item.priority);
  const [note, setNote] = useState(item.internalNote);
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  const dirty = status !== base.status || priority !== base.priority || note !== base.internalNote;
  const Icon = categoryIcons[base.category];

  function close() { if (saving.current) return; if (dirty) setDiscard(true); else onClose(); }
  function accept(next: FeedbackItem) { setBase(next); setStatus(next.status); setPriority(next.priority); setNote(next.internalNote); setConflict(false); setError(""); onSaved(next); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (saving.current || !dirty || conflict) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try { const result = await api<{ ok: true; item: FeedbackItem }>(`/api/feedback/${base.id}`, { method: "PATCH", body: JSON.stringify({ revision: base.revision, status, priority, internalNote: note }) }); accept(result.item); setNotice("변경 사항을 저장했어요."); }
    catch (cause) { if (denied(cause)) { onDenied(cause); return; } if (cause instanceof ApiError && cause.status === 409) setConflict(true); setError(cause instanceof Error ? cause.message : "변경 사항을 저장하지 못했어요."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function reload() {
    if (saving.current) return; saving.current = true; setBusy(true); setError(""); setNotice("");
    try { const result = await api<{ item: FeedbackItem }>(`/api/feedback/${base.id}`); accept(result.item); setNotice("최신 내용을 불러왔어요. 변경 사항을 다시 입력해주세요."); }
    catch (cause) { if (denied(cause)) onDenied(cause); else setError(cause instanceof Error ? cause.message : "최신 내용을 불러오지 못했어요."); }
    finally { saving.current = false; setBusy(false); }
  }

  return <Dialog title="의견 살펴보기" eyebrow={`FEEDBACK #${base.id.slice(0, 8).toUpperCase()}`} onClose={close} className="feedback-dialog feedback-detail-dialog">{discard ? <div className="feedback-discard"><div className="feedback-round-icon"><ClipboardList size={25} /></div><h3>저장하지 않고 닫을까요?</h3><p>닫으면 아직 저장하지 않은 변경 사항이 사라져요.</p><div className="feedback-action-row"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscard(false)}><ArrowLeft size={15} />계속 수정하기</button><button type="button" className="primary-button" onClick={onClose}>저장하지 않고 닫기</button></div></div> : <form className="feedback-form" onSubmit={save}><div className="feedback-scroll-body"><div className="feedback-detail-heading"><span className={`backlog-card-icon category-${base.category}`}><Icon size={19} /></span><div><p>{FEEDBACK_CATEGORY_LABELS[base.category]}</p><time dateTime={base.createdAt}>{timestamp(base.createdAt)} 접수</time></div><span className={`feedback-status status-${base.status}`}>{FEEDBACK_STATUS_LABELS[base.status]}</span></div><h3 className="feedback-detail-title">{base.title}</h3><div className="feedback-original-message">{base.message}</div><dl className="feedback-reporter"><div><dt>보낸 사람</dt><dd>{base.reporterName || "사용자"}</dd></div><div><dt>이메일</dt><dd>{base.reporterEmail || "이메일 정보 없음"}</dd></div><div><dt>보낸 화면</dt><dd>{base.page === "/app" ? "캘린더" : base.page}</dd></div></dl><section className="feedback-management"><h3><SlidersHorizontal size={17} />처리 계획</h3><fieldset className="feedback-inputs" disabled={busy}><legend className="sr-only">의견 처리 계획</legend><div className="feedback-management-selects"><label className="field" htmlFor={`${fieldId}-status`}><span>진행 상태</span><select id={`${fieldId}-status`} value={status} onChange={event => { setStatus(event.target.value as FeedbackStatus); setNotice(""); }}>{statuses.map(value => <option key={value} value={value}>{FEEDBACK_STATUS_LABELS[value]}</option>)}</select></label><label className="field" htmlFor={`${fieldId}-priority`}><span>우선순위</span><select id={`${fieldId}-priority`} value={priority} onChange={event => { setPriority(event.target.value as FeedbackPriority); setNotice(""); }}>{priorities.map(value => <option key={value} value={value}>{FEEDBACK_PRIORITY_LABELS[value]}</option>)}</select></label></div><label className="feedback-message-label" htmlFor={`${fieldId}-note`}>내부 메모<span>운영자에게만 보여요</span></label><textarea id={`${fieldId}-note`} rows={4} maxLength={FEEDBACK_TEXT_MAX} value={note} onChange={event => { setNote(event.target.value); setNotice(""); }} placeholder="검토 결과, 구현 방향, 다음에 할 일 등을 남겨주세요." /><div className="feedback-message-meta"><span />{note.length.toLocaleString("ko-KR")} / 2,000</div></fieldset></section>{error ? <p className="feedback-message error" role="alert"><AlertCircle size={17} />{error}</p> : null}{conflict ? <div className="feedback-conflict"><p>다른 변경이 먼저 저장됐어요. 최신 내용을 불러오면 지금 수정 중인 내용은 바뀌어요.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => void reload()}><RefreshCw size={15} />최신 내용 불러오기</button></div> : null}{notice ? <p className="feedback-message success" role="status"><Check size={17} />{notice}</p> : null}<p className="feedback-management-hint"><LockKeyhole size={13} />상태와 메모를 저장해도 작성자에게 알림이 발송되지는 않아요.</p></div><footer className="feedback-footer"><button type="button" className="secondary-button" onClick={close} disabled={busy}>닫기</button><button className="primary-button" type="submit" disabled={busy || !dirty || conflict}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? "저장 중…" : "변경 사항 저장"}</button></footer></form>}</Dialog>;
}
