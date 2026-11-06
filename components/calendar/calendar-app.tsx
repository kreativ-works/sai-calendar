"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDownToLine, ArrowRight, CalendarDays, CalendarHeart, Check, ChevronLeft, ChevronRight, CircleCheck, Heart, Link2, List, LoaderCircle, MapPin, Menu, MessageSquare, ClipboardList, Plus, RefreshCw, Repeat2, Search, Settings2, Sparkles, Trash2, Users, X, Pencil, AlignLeft, AlertCircle } from "lucide-react";
import { expandEvents, validDate, type CalendarEvent, type CalendarEventInput, type CalendarState, type HouseholdInput, type OwnerScope, type StoredEvent } from "@/lib/domain/calendar";
import { api, ApiError } from "@/lib/client/api";
import { addDays, CATEGORY_NAMES, dayDistance, dayNumber, dayOfWeek, downloadCalendar, eventRange, eventTime, fullDate, FULL_WEEKDAYS, monthCells, monthEnd, monthLabel, monthStart, occursOn, REPEAT_NAMES, shiftMonth, shortDate, sortEvents, todayInSeoul, WEEKDAYS, weekStart } from "@/lib/client/calendar-view";
import { createDemoEvents } from "@/lib/client/demo";
import CalendarSettings, { type InviteLink } from "./calendar-settings";
import Dialog from "./dialog";
import EventEditor, { OWNERS, type OwnerNames } from "./event-editor";
import NotificationCenter, { type NotificationView } from "@/components/notifications/notification-center";
import type { NotificationItem } from "@/lib/domain/notifications";
import FeedbackDialog from "@/components/feedback/feedback-dialog";

type View = "month" | "week" | "list";
type EditorState = { date: string; event?: CalendarEvent } | null;
const ALL_FILTERS: Record<OwnerScope, boolean> = { a: true, b: true, both: true };

function Brand() {
  return <span className="brand-lockup"><span className="brand-symbol" aria-hidden="true"><i /><i /></span><span className="brand-word">sai<span className="brand-period">.</span></span><span className="brand-korean">사이</span></span>;
}

function EmptyState({ title, subtitle, onCreate }: { title: string; subtitle?: string; onCreate?: () => void }) {
  return <div className="empty-state"><div className="empty-symbol"><CalendarHeart size={30} strokeWidth={1.2} /></div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}{onCreate ? <button className="text-button" onClick={onCreate}><Plus size={15} />일정 만들기</button> : null}</div>;
}

type CalendarAppProps = { initialDemo?: boolean; initialSetup?: "create" | "join" | null; initialJoinCode?: string; signedIn?: boolean; feedbackAdmin?: boolean };

export default function CalendarApp({ initialDemo = false, initialSetup = null, initialJoinCode = "", signedIn = false, feedbackAdmin = false }: CalendarAppProps) {
  const [today, setToday] = useState(todayInSeoul);
  const [cursor, setCursor] = useState(() => monthStart(todayInSeoul()));
  const [selected, setSelected] = useState(todayInSeoul);
  const [view, setView] = useState<View>("month");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const [filters, setFilters] = useState(ALL_FILTERS);
  const [mode, setMode] = useState<"demo" | "live">(initialDemo ? "demo" : "live");
  const [snapshot, setSnapshot] = useState<CalendarState | null>(null);
  const [demoEvents, setDemoEvents] = useState<StoredEvent[]>(createDemoEvents);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [requiresSignIn, setRequiresSignIn] = useState(!signedIn);
  const [lastRefreshed, setLastRefreshed] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [settings, setSettings] = useState<"create" | "join" | "settings" | null>(null);
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [toast, setToast] = useState("");
  const [notificationView, setNotificationView] = useState<NotificationView>(null);
  const [notificationRefresh, setNotificationRefresh] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const notificationLinkHandled = useRef(false);
  const requestId = useRef(0);
  const initialized = useRef(false);
  const modeIntent = useRef<"demo" | "live">(initialDemo ? "demo" : "live");
  const searching = query.trim().length > 0;
  const from = searching ? today : addDays(monthStart(cursor), -7);
  const to = searching ? addDays(today, 365) : addDays(monthEnd(cursor), 7);
  const isDemo = mode === "demo";
  const names: OwnerNames = { a: isDemo ? "나" : snapshot?.members.find(member => member.slot === "a")?.name || "나", b: isDemo ? "짝꿍" : snapshot?.members.find(member => member.slot === "b")?.name || "짝꿍", both: "함께" };
  const householdName = isDemo ? "우리의 캘린더" : snapshot?.household?.name || "우리의 캘린더";

  const refresh = useCallback(async (quiet = false) => {
    const id = ++requestId.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api<CalendarState>(`/api/state?from=${from}&to=${to}`);
      if (id !== requestId.current) return result;
      setSnapshot(result); setConnectionError(""); setRequiresSignIn(false);
      setLastRefreshed(new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()));
      if (!initialized.current) {
        initialized.current = true;
        if (modeIntent.current === "live") {
          setMode("live");
          if (!result.household) setSettings(initialSetup === "join" || initialJoinCode ? "join" : "create");
        }
      }
      return result;
    } catch (error) {
      if (id === requestId.current) {
        const signInRequired = error instanceof ApiError && error.status === 401;
        setConnectionError(error instanceof Error ? error.message : "일정을 불러오지 못했어요.");
        setRequiresSignIn(signInRequired);
        if (signInRequired && modeIntent.current === "live" && !initialized.current) setSettings(initialSetup === "join" || initialJoinCode ? "join" : "create");
      }
      throw error;
    } finally { if (id === requestId.current) setLoading(false); }
  }, [from, to, initialSetup, initialJoinCode]);

  // These effects hydrate external URL/storage/API state after SSR, avoiding a different first client render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  useEffect(() => {
    try { const stored = localStorage.getItem("sai:view:v1"); if (stored === "month" || stored === "week" || stored === "list") setView(stored); } catch { /* Preferences are optional. */ }
    const timer = window.setInterval(() => setToday(todayInSeoul()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => { try { localStorage.setItem("sai:view:v1", view); } catch { /* Preferences are optional. */ } }, [view]);
  useEffect(() => {
    if (isDemo) return;
    const update = () => { if (!document.hidden) void refresh(true).catch(() => {}); };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [isDemo, refresh]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4300); return () => window.clearTimeout(timer); }, [toast]);

  const events = useMemo(() => isDemo ? expandEvents(demoEvents, from, to) : snapshot?.events || [], [isDemo, demoEvents, from, to, snapshot]);
  const filtered = useMemo(() => sortEvents(events.filter(event => filters[event.ownerScope] && (!searching || `${event.title} ${event.location} ${event.note}`.toLocaleLowerCase("ko").includes(query.trim().toLocaleLowerCase("ko"))))), [events, filters, searching, query]);
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  const selectedEvents = filtered.filter(event => occursOn(event, selected));
  const monthEvents = filtered.filter(event => event.endDate >= monthStart(cursor) && event.startDate <= monthEnd(cursor));
  const upcomingAnniversary = useMemo(() => {
    const candidates = events.filter(event => event.category === "anniversary" && event.startDate >= today).map(event => ({ title: event.title, startDate: event.startDate }));
    const anniversary = !isDemo ? snapshot?.household?.anniversary : null;
    if (anniversary) {
      const firstYear = Math.max(Number(today.slice(0, 4)), Number(anniversary.slice(0, 4)));
      for (let year = firstYear; year <= firstYear + 4; year++) {
        const date = `${year}-${anniversary.slice(5)}`;
        if (validDate(date) && date >= today && date >= anniversary) { candidates.push({ title: "우리의 기념일", startDate: date }); break; }
      }
    }
    return candidates.sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  }, [events, isDemo, snapshot, today]);
  const activeView = searching ? "list" : view;
  const connected = !isDemo && !!snapshot?.household;
  const allConnected = connected && snapshot!.members.length === 2 && snapshot!.members.every(member => member.connected);
  const hasFilters = OWNERS.some(owner => filters[owner]);

  const openNotification = useCallback(async (item: NotificationItem) => {
    const requestedDate = item.occurrenceDate || "";
    const date = validDate(requestedDate) && requestedDate >= "1970-01-01" && requestedDate <= "2100-12-31" ? requestedDate : today;
    setNotificationView(null); setSettings(null); setEditor(null); setDetail(null); setQuery(""); setSearchOpen(false); setView("month"); setCursor(monthStart(date)); setSelected(date);
    function revealDay() { window.requestAnimationFrame(() => { const agenda = document.getElementById("day-agenda"); agenda?.scrollIntoView({ behavior: "auto", block: "start" }); agenda?.focus({ preventScroll: true }); }); }
    if (!item.eventId || item.kind === "event_deleted") { if (item.kind === "event_deleted") setToast("삭제된 일정이에요. 해당 날짜의 다른 약속을 확인해보세요."); revealDay(); return; }
    try {
      const dayEvents = isDemo ? expandEvents(demoEvents, date, date) : (await api<CalendarState>(`/api/state?from=${date}&to=${date}`)).events;
      const found = dayEvents.find(event => event.id === item.eventId && occursOn(event, date));
      if (found) setDetail(found);
      else { setToast("일정이 변경되었거나 삭제됐어요. 해당 날짜의 약속을 확인해주세요."); revealDay(); }
    } catch (cause) { setToast(cause instanceof Error ? cause.message : "일정을 확인하지 못했어요. 다시 시도해주세요."); }
  }, [isDemo, demoEvents, today]);

  useEffect(() => {
    if (notificationLinkHandled.current || isDemo || !snapshot?.household) return;
    notificationLinkHandled.current = true;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("notification") || "";
    const eventId = url.searchParams.get("event") || "";
    const date = url.searchParams.get("date") || "";
    if (!id && !eventId && !date) return;
    const safeId = /^[a-zA-Z0-9_.:-]{1,160}$/.test(id) ? id : "";
    const safeEvent = /^[a-zA-Z0-9_-]{1,120}$/.test(eventId) ? eventId : null;
    const safeDate = validDate(date) && date >= "1970-01-01" && date <= "2100-12-31" ? date : null;
    for (const key of ["notification", "event", "date"]) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (safeId) void api("/api/notifications", { method: "PATCH", body: JSON.stringify({ ids: [safeId] }) }).then(() => setNotificationRefresh(previous => previous + 1)).catch(() => {});
    // Restore a notification destination from the external browser URL after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (safeEvent || safeDate) void openNotification({ id: safeId, kind: "reminder", title: "", body: "", eventId: safeEvent, occurrenceDate: safeDate, createdAt: "", readAt: null });
  }, [isDemo, snapshot?.household, openNotification]);

  function selectDate(date: string) { setSelected(date); if (date.slice(0, 7) !== cursor.slice(0, 7)) setCursor(monthStart(date)); setSidebarOpen(false); }
  function move(amount: number) {
    if (view === "week") { const date = addDays(selected, amount * 7); setSelected(date); setCursor(monthStart(date)); }
    else { const date = shiftMonth(cursor, amount); setCursor(date); setSelected(date); }
  }
  function goToday() { setCursor(monthStart(today)); setSelected(today); }
  function toggleMobileSearch() {
    setSearchOpen(!searchOpen);
    if (searchOpen) setQuery("");
    else window.requestAnimationFrame(() => searchInput.current?.focus());
  }
  function showDayAgenda(date: string) {
    selectDate(date);
    window.requestAnimationFrame(() => {
      const agenda = document.getElementById("day-agenda");
      agenda?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      agenda?.focus({ preventScroll: true });
    });
  }
  function showMobileView(next: View) {
    setView(next);
    setQuery("");
    document.getElementById("calendar-main")?.scrollIntoView({ behavior: "auto", block: "start" });
  }
  function openSettings() {
    if (!snapshot && !requiresSignIn) {
      setToast(loading ? "캘린더 연결을 확인하고 있어요. 잠시만 기다려주세요." : "연결을 확인한 뒤 다시 시도해주세요.");
      return;
    }
    setSettings(snapshot?.household ? "settings" : initialSetup === "join" || joinCode ? "join" : "create");
    setSidebarOpen(false);
  }
  function create(date = selected) {
    if (!isDemo && (!snapshot?.household || requiresSignIn)) { openSettings(); return; }
    // Mount and focus the modal in this same tap. Delaying focus until an effect
    // runs after the gesture can prevent iOS from opening its software keyboard.
    flushSync(() => {
      selectDate(date); setQuery(""); setSearchOpen(false); setDetail(null);
      setEditor({ date });
    });
  }
  function openFeedback() {
    flushSync(() => { setSettings(null); setSidebarOpen(false); setNotificationView(null); setFeedbackOpen(true); });
  }
  function showLive() { modeIntent.current = "live"; setMode("live"); setSettings(null); window.history.replaceState({}, "", "/app"); }
  function showDemo() { modeIntent.current = "demo"; setMode("demo"); window.history.replaceState({}, "", "/app?demo=1"); }
  async function saveEvent(input: CalendarEventInput, event?: CalendarEvent, clientRequestId?: string) {
    if (isDemo) {
      const id = event?.id || `demo-${crypto.randomUUID()}`;
      setDemoEvents(old => [...old.filter(item => item.id !== id), { ...input, id, revision: (event?.revision || 0) + 1 }]);
    } else {
      await api(event ? `/api/events/${encodeURIComponent(event.id)}` : "/api/events", { method: event ? "PATCH" : "POST", body: JSON.stringify({ ...input, ...(event ? { revision: event.revision } : { clientRequestId }) }) });
      await refresh(true);
    }
    setEditor(null); setToast(isDemo ? "예시 일정을 바꿨어요. 실제 캘린더에는 저장되지 않아요." : "일정을 저장했어요.");
  }
  async function deleteEvent(event: CalendarEvent) {
    if (isDemo) setDemoEvents(old => old.filter(item => item.id !== event.id));
    else { await api(`/api/events/${encodeURIComponent(event.id)}`, { method: "DELETE", body: JSON.stringify({ revision: event.revision }) }); await refresh(true); }
    setDetail(null); setToast(isDemo ? "예시 일정을 삭제했어요." : "일정을 삭제했어요.");
  }
  async function createHousehold(input: HouseholdInput) {
    await api("/api/household", { method: "POST", body: JSON.stringify(input) }); await refresh(true); modeIntent.current = "live"; setMode("live"); setSettings("settings"); window.history.replaceState({}, "", "/app"); setToast("둘만의 캘린더가 생겼어요. 이제 짝꿍을 초대해보세요.");
  }
  async function updateHousehold(input: HouseholdInput) {
    await api("/api/household", { method: "PATCH", body: JSON.stringify({ ...input, revision: snapshot?.household?.revision }) }); await refresh(true); setMode("live");
  }
  async function joinHousehold(code: string) {
    await api("/api/invites/join", { method: "POST", body: JSON.stringify({ code }) }); await refresh(true); modeIntent.current = "live"; setMode("live"); setSettings(null); setJoinCode(""); window.history.replaceState({}, "", "/app"); setToast("짝꿍의 캘린더에 연결됐어요.");
  }
  function exportView() {
    const list = searching ? filtered : activeView === "week" ? filtered.filter(event => event.endDate >= weekStart(selected) && event.startDate <= addDays(weekStart(selected), 6)) : monthEvents;
    downloadCalendar(list, searching ? "검색결과" : monthLabel(cursor)); setToast(`현재 보이는 일정 ${list.length}개를 내보냈어요. 다른 달은 해당 달에서 내보내세요.`);
  }

  return <div className="sai-app">
    <a className="skip-link" href="#calendar-main">캘린더로 바로 가기</a>
    {sidebarOpen ? <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="메뉴 닫기" /> : null}
    <aside className={`app-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label="캘린더 메뉴">
      <div className="sidebar-brand"><Brand /><button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="메뉴 닫기"><X size={20} /></button></div>
      <p className="brand-tagline">각자의 하루, 함께하는 시간.</p>
      <button className="primary-button sidebar-create" onClick={() => create()}><Plus size={18} />일정 만들기</button>
      <nav className="main-nav"><button className={view !== "list" ? "active" : ""} onClick={() => { setView("month"); setQuery(""); setSidebarOpen(false); }}><CalendarDays size={19} />우리 캘린더<span className="nav-active-dot" /></button><button className={view === "list" ? "active" : ""} onClick={() => { setView("list"); setSidebarOpen(false); }}><List size={19} />일정 모아보기</button></nav>
      <div className="mini-calendar"><div className="mini-heading"><strong>{monthLabel(cursor)}</strong><div><button className="tiny-icon-button" onClick={() => setCursor(shiftMonth(cursor, -1))} aria-label="작은 달력 이전 달"><ChevronLeft size={15} /></button><button className="tiny-icon-button" onClick={() => setCursor(shiftMonth(cursor, 1))} aria-label="작은 달력 다음 달"><ChevronRight size={15} /></button></div></div><div className="mini-grid">{WEEKDAYS.map(day => <span key={day} className="mini-weekday">{day}</span>)}{cells.map(date => <button key={date} className={`${date.slice(0, 7) !== cursor.slice(0, 7) ? "outside" : ""} ${date === selected ? "selected" : ""} ${date === today ? "today" : ""}`} aria-label={fullDate(date)} aria-current={date === today ? "date" : undefined} onClick={() => selectDate(date)}>{dayNumber(date)}</button>)}</div></div>
      <section className="calendar-filters"><div className="sidebar-section-label">우리의 캘린더<span>3</span></div>{OWNERS.map(owner => <button key={owner} className={`filter-row owner-${owner}`} aria-pressed={filters[owner]} onClick={() => setFilters(old => ({ ...old, [owner]: !old[owner] }))}><span className={`filter-check ${filters[owner] ? "checked" : ""}`}>{filters[owner] ? <Check size={12} strokeWidth={2.5} /> : null}</span><span>{names[owner]}</span>{owner === "both" ? <Heart size={14} /> : <span className="filter-type">{isDemo ? "예시" : snapshot?.viewerSlot === owner ? "나" : "짝꿍"}</span>}</button>)}</section>
      <div className="sidebar-bottom"><div className="shared-space"><span className="space-icon"><Users size={19} /></span><div><strong>{isDemo ? "둘만의 작은 공간" : allConnected ? "두 사람이 연결됐어요" : "짝꿍과 함께 시작해요"}</strong><p>{isDemo ? "우리의 하루를 더 가깝게" : allConnected ? `${names.a} · ${names.b}` : "초대 링크를 보내보세요"}</p></div></div><button className="sidebar-settings" onClick={openSettings}><Settings2 size={18} />캘린더 설정<ChevronRight size={15} /></button><button className="sidebar-settings" onClick={openFeedback}><MessageSquare size={18} />의견 보내기<ChevronRight size={15} /></button>{feedbackAdmin && !isDemo ? <a className="sidebar-settings feedback-admin-link" href="/backlog"><ClipboardList size={18} />피드백 백로그<ChevronRight size={15} /></a> : null}<p className="sidebar-footnote">MADE FOR TWO, BY SAI.</p></div>
    </aside>

    <div className="app-workspace">
      <header className={`app-header ${searchOpen ? "has-search" : ""}`}><div className="header-title-group"><button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="메뉴 열기"><Menu size={22} /></button><div><h1>{householdName}</h1><p>소소한 일상부터, 소중한 약속까지.</p></div></div><div className="header-actions"><button ref={searchToggle} className="icon-button mobile-search-toggle" aria-label={searchOpen ? "일정 검색 닫기" : "일정 검색 열기"} aria-expanded={searchOpen} onClick={toggleMobileSearch}><Search size={20} /></button><label className="search-field"><Search size={17} /><span className="sr-only">일정 검색</span><input ref={searchInput} aria-label="일정 검색" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setQuery(""); setSearchOpen(false); if (window.matchMedia("(max-width: 640px)").matches) searchToggle.current?.focus(); } }} placeholder="일정 검색" />{query ? <button className="tiny-icon-button" onClick={() => setQuery("")} aria-label="검색어 지우기"><X size={14} /></button> : <span className="search-shortcut">⌕</span>}</label><NotificationCenter demo={isDemo} enabled={connected && !requiresSignIn} userId={snapshot?.user.id} events={events} view={notificationView} refreshKey={notificationRefresh} onViewChange={setNotificationView} onOpenEvent={openNotification} onConnect={openSettings} /><button className="people-button" onClick={openSettings} aria-label={isDemo ? "우리 캘린더 시작하기" : "공유 연결 설정"}><span className="paired-avatars"><span className="avatar owner-a">{names.a.slice(0, 1)}</span><span className="avatar owner-b">{names.b.slice(0, 1)}</span></span><span className="people-label">{isDemo ? "함께 시작하기" : allConnected ? "우리 둘" : "짝꿍 초대"}<ChevronRight size={13} /></span></button></div></header>
      {isDemo ? <div className="demo-banner"><span className="demo-badge"><Sparkles size={13} />둘러보기</span><p><span className="desktop-copy">예시 일정으로 사이를 만나보세요.</span> 실제 일정은 우리 캘린더에서 시작해요.</p><button onClick={() => { if (snapshot?.household) showLive(); else setSettings("create"); }}>{snapshot?.household ? "내 캘린더로 이동" : "우리 캘린더 만들기"}<ArrowRight size={14} /></button></div> : connectionError ? <div className="connection-banner" role="alert"><AlertCircle size={16} /><span>{connectionError}</span><button onClick={() => void refresh().catch(() => {})}>다시 연결</button></div> : loading && !snapshot ? <div className="connection-banner" role="status"><LoaderCircle size={16} className="spin" /><span>우리 캘린더 연결을 확인하고 있어요.</span></div> : !snapshot?.household ? <div className="invite-banner"><Heart size={15} /><span>우리 캘린더를 만들거나 짝꿍의 초대로 연결해보세요.</span><button onClick={openSettings}>함께 시작하기<ArrowRight size={13} /></button></div> : !allConnected ? <div className="invite-banner"><Link2 size={15} /><span>짝꿍을 초대하면 두 사람의 일정을 함께 볼 수 있어요.</span><button onClick={openSettings}>짝꿍 초대하기<ArrowRight size={13} /></button></div> : null}

      <main id="calendar-main" className="calendar-main">
        <section className="calendar-center" aria-label="캘린더">
          <div className="calendar-toolbar"><div className="month-title"><div><p className="eyebrow">OUR DAYS, TOGETHER</p><h2>{searching ? "일정 검색" : activeView === "week" ? `${shortDate(weekStart(selected))} — ${shortDate(addDays(weekStart(selected), 6))}` : monthLabel(cursor)}</h2></div><div className="calendar-arrows"><button className="icon-button" onClick={() => move(-1)} aria-label={view === "week" ? "이전 주" : "이전 달"}><ChevronLeft size={18} /></button><button className="icon-button" onClick={() => move(1)} aria-label={view === "week" ? "다음 주" : "다음 달"}><ChevronRight size={18} /></button><button className="today-button" onClick={goToday}>오늘</button></div></div><div className="calendar-tools"><div className="view-segment" aria-label="캘린더 보기">{([ ["month", "월"], ["week", "주"], ["list", "목록"] ] as const).map(([value, label]) => <button key={value} className={activeView === value ? "active" : ""} aria-pressed={activeView === value} onClick={() => { setView(value); setQuery(""); }}>{label}</button>)}</div><button className="icon-button export-button" title="현재 보이는 일정 내보내기 (.ics)" aria-label="현재 보이는 일정 내보내기" disabled={!filtered.length} onClick={exportView}><ArrowDownToLine size={18} /></button><button className="primary-button toolbar-create" onClick={() => create()}><Plus size={17} />일정 만들기</button></div></div>
          <div className="calendar-subline"><span>{searching ? `앞으로 12개월에서 검색 · ${filtered.length}개 결과` : activeView === "week" ? "일주일의 흐름을 함께 살펴봐요." : `두 사람이 채워가는 ${Number(cursor.slice(5, 7))}월`}</span><span className={`sync-state ${connectionError && !isDemo ? "has-error" : ""}`}>{isDemo ? <><span className="status-dot" />예시 일정</> : loading ? <><LoaderCircle size={12} className="spin" />불러오는 중</> : connectionError ? <><AlertCircle size={12} />연결 확인 필요</> : <><CircleCheck size={12} />{lastRefreshed} 갱신<button className="tiny-icon-button" onClick={() => void refresh().catch(() => {})} aria-label="일정 새로고침"><RefreshCw size={11} /></button></>}</span></div>
          <div className="mobile-calendar-filters" aria-label="표시할 일정">{OWNERS.map(owner => <button key={owner} className={`owner-${owner}`} aria-label={`${names[owner]} 일정 표시`} aria-pressed={filters[owner]} onClick={() => setFilters(old => ({ ...old, [owner]: !old[owner] }))}><span className="owner-dot" aria-hidden="true" /><span>{names[owner]}</span></button>)}</div>
          {!hasFilters ? <div className="filter-empty"><span>표시할 캘린더를 선택해주세요.</span><button className="text-button" onClick={() => setFilters(ALL_FILTERS)}>모두 보기</button></div> : null}
          {activeView === "month" ? <div className="month-calendar"><div className="weekday-row">{WEEKDAYS.map((day, index) => <span key={day} className={index === 0 ? "sunday" : index === 6 ? "saturday" : ""}>{day}</span>)}</div><div className="month-grid" style={{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(110px, 1fr))` }} aria-label={monthLabel(cursor)}>{cells.map(date => {
            const dayEvents = filtered.filter(event => occursOn(event, date));
            return <div key={date} className={`month-cell ${date.slice(0, 7) !== cursor.slice(0, 7) ? "outside-month" : ""} ${date === selected ? "selected-day" : ""} ${date === today ? "is-today" : ""}`}><button className="day-button" onClick={() => create(date)} aria-label={`${fullDate(date)}, 일정 ${dayEvents.length}개, 새 일정 등록`} aria-haspopup="dialog" aria-pressed={date === selected} aria-current={date === today ? "date" : undefined}><span className={`day-number ${dayOfWeek(date) === 0 ? "sunday" : dayOfWeek(date) === 6 ? "saturday" : ""}`}>{dayNumber(date)}</span>{date === today ? <span className="today-label">오늘</span> : null}</button><div className="cell-events">{dayEvents.slice(0, 3).map(event => <button key={event.occurrenceId} className={`event-pill owner-${event.ownerScope} ${event.allDay ? "all-day-pill" : ""}`} onClick={() => { selectDate(date); setDetail(event); }} title={`${event.title} · ${names[event.ownerScope]}`} aria-label={`${fullDate(date)} · ${event.title} · ${names[event.ownerScope]} · ${eventTime(event, date)}`}><span className="event-pill-dot" aria-hidden="true" />{!event.allDay ? <span className="pill-time">{eventTime(event, date)}</span> : null}<span className="pill-title">{event.title}</span>{event.category === "anniversary" ? <Heart size={10} /> : null}</button>)}{dayEvents.length > 3 ? <button className="more-events more-events-desktop" aria-label={`${fullDate(date)} 전체 일정 ${dayEvents.length}개 보기`} onClick={() => showDayAgenda(date)}>+{dayEvents.length - 3}개 더</button> : null}{dayEvents.length > 2 ? <button className="more-events more-events-mobile" aria-label={`${fullDate(date)} 전체 일정 ${dayEvents.length}개 보기`} onClick={() => showDayAgenda(date)}>+{dayEvents.length - 2}개</button> : null}</div></div>;
          })}</div></div> : activeView === "week" ? <WeekView date={selected} today={today} events={filtered} names={names} onSelect={create} onDetail={setDetail} onCreate={create} /> : <AgendaList events={searching ? filtered : monthEvents} names={names} today={today} searching={searching} onDetail={setDetail} onCreate={() => create()} onClear={() => setQuery("")} />}
          <div className="calendar-footer"><span><span className="small-heart">♡</span>일상을 나누는 가장 다정한 방법</span><span>한국 시간 · 서울</span></div>
        </section>

        <aside id="day-agenda" className="day-agenda" tabIndex={-1} aria-label={`${shortDate(selected)} 일정`}><div className="agenda-heading"><p className="eyebrow">{selected === today ? "TODAY’S MOMENTS" : "A DAY IN OUR LIFE"}</p><div className="agenda-date"><h2>{shortDate(selected)}</h2><span>{FULL_WEEKDAYS[dayOfWeek(selected)]}</span></div><p className="agenda-count">{selectedEvents.length ? `오늘의 약속 ${selectedEvents.length}개` : "여유를 담을 수 있는 하루"}</p></div><div className="agenda-content">{selectedEvents.length ? <div className="day-events">{selectedEvents.map(event => <button key={event.occurrenceId} className={`agenda-event owner-${event.ownerScope}`} onClick={() => setDetail(event)}><div className="agenda-event-time"><span className="timeline-dot" />{eventTime(event, selected)}{event.repeat !== "none" ? <Repeat2 size={12} /> : null}</div><div className="agenda-event-body"><span className="agenda-owner">{names[event.ownerScope]}<span>·</span>{CATEGORY_NAMES[event.category]}</span><h3>{event.title}</h3>{event.location ? <p><MapPin size={12} />{event.location}</p> : null}{event.note ? <span className="agenda-note">{event.note}</span> : null}</div></button>)}</div> : <EmptyState title="아직 정해진 일정이 없어요" subtitle={isDemo ? "이 날에 예시 일정을 더해보세요." : "함께할 작은 약속을 남겨보세요."} />}</div><button className="add-day-button" onClick={() => create()}><Plus size={16} />이날 일정 추가</button><div className="agenda-bottom">{upcomingAnniversary ? <div className="anniversary-note"><span className="anniversary-icon"><Heart size={19} strokeWidth={1.4} /></span><div><p>{isDemo ? "예시 기념일" : "다가오는 기념일"}</p><h3>{upcomingAnniversary.title}</h3><span>{shortDate(upcomingAnniversary.startDate)}</span></div><strong>{dayDistance(today, upcomingAnniversary.startDate) === 0 ? "D-day" : `D−${dayDistance(today, upcomingAnniversary.startDate)}`}</strong></div> : <div className="quiet-note"><Heart size={20} strokeWidth={1.3} /><p>함께하는 평범한 하루가<br />가장 특별한 날이 되도록.</p></div>}<p className="agenda-privacy"><Users size={12} />{isDemo ? "예시 일정은 실제로 공유되지 않아요" : "모든 일정은 우리 둘에게 보여요"}</p></div></aside>
      </main>
    </div>
    <nav className="mobile-app-nav" aria-label="빠른 메뉴">
      <button aria-current={activeView !== "list" ? "page" : undefined} onClick={() => showMobileView("month")}><CalendarDays size={22} /><span>달력</span></button>
      <button aria-current={activeView === "list" ? "page" : undefined} onClick={() => showMobileView("list")}><List size={22} /><span>목록</span></button>
      <button className="mobile-nav-create" onClick={() => create()} aria-label="새 일정 만들기"><Plus size={24} /><span>일정 추가</span></button>
      <button onClick={openSettings}><Users size={22} /><span>{allConnected ? "우리 설정" : "짝꿍 초대"}</span></button>
    </nav>
    {editor ? <EventEditor key={editor.event?.occurrenceId || `new-${editor.date}`} date={editor.date} event={editor.event} events={events} names={names} demo={isDemo} onSave={saveEvent} onClose={() => setEditor(null)} /> : null}
    {detail ? <EventDetail event={detail} names={names} demo={isDemo} onClose={() => setDetail(null)} onEdit={() => { setEditor({ date: detail.startDate, event: detail }); setDetail(null); }} onDelete={() => deleteEvent(detail)} /> : null}
    {settings ? <CalendarSettings key={`${settings}-${snapshot?.household?.id || "new"}`} state={snapshot} initialTab={settings} initialCode={joinCode} connectionError={connectionError} requiresSignIn={requiresSignIn} loading={loading && !snapshot} demo={isDemo} onRetry={() => void refresh().catch(() => {})} onCreate={createHousehold} onUpdate={updateHousehold} onJoin={joinHousehold} onInvite={() => api<InviteLink>("/api/invites", { method: "POST", body: "{}" })} onRevoke={async () => { await api("/api/invites", { method: "DELETE", body: "{}" }); await refresh(true); }} onLive={showLive} onDemo={showDemo} onNotifications={() => { setSettings(null); setNotificationView("settings"); }} onFeedback={openFeedback} feedbackAdmin={feedbackAdmin && !isDemo} onClose={() => setSettings(null)} /> : null}
    {feedbackOpen ? <FeedbackDialog demo={isDemo} reporterEmail={snapshot?.user.email} onClose={() => setFeedbackOpen(false)} /> : null}
    <div className={`toast ${toast ? "visible" : ""}`} role="status" aria-live="polite">{toast ? <><CircleCheck size={17} />{toast}</> : null}</div>
    <span className="sr-only" role="status">{loading && !isDemo ? "일정을 불러오는 중" : ""}</span>
  </div>;
}

function AgendaList({ events, names, today, searching, onDetail, onCreate, onClear }: { events: CalendarEvent[]; names: OwnerNames; today: string; searching: boolean; onDetail: (event: CalendarEvent) => void; onCreate: () => void; onClear: () => void }) {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) { const list = grouped.get(event.startDate) || []; list.push(event); grouped.set(event.startDate, list); }
  return <div className="agenda-list">{events.length ? Array.from(grouped).map(([date, items]) => <section key={date} className="list-day"><div className={`list-date ${date === today ? "today" : ""}`}><strong>{dayNumber(date)}</strong><span>{Number(date.slice(5, 7))}월 · {WEEKDAYS[dayOfWeek(date)]}</span></div><div className="list-events">{items.map(event => <button key={event.occurrenceId} className={`list-event owner-${event.ownerScope}`} onClick={() => onDetail(event)}><span className="list-event-time">{eventTime(event)}{!event.allDay ? <small>{event.endDate !== event.startDate ? shortDate(event.endDate) + " " : ""}{event.endTime}</small> : null}</span><span className="list-event-info"><strong>{event.title}</strong>{event.location ? <span><MapPin size={12} />{event.location}</span> : null}</span><span className="list-owner"><i className="owner-dot" />{names[event.ownerScope]}</span><ChevronRight size={15} /></button>)}</div></section>) : <><EmptyState title={searching ? "검색에 맞는 일정이 없어요" : "함께할 첫 일정을 남겨보세요"} subtitle={searching ? "제목, 장소, 메모의 다른 단어로 찾아보세요." : "작은 약속 하나에서 우리의 하루가 시작돼요."} onCreate={searching ? undefined : onCreate} />{searching ? <button className="text-button clear-search" onClick={onClear}>검색어 지우기</button> : null}</>}</div>;
}

function WeekView({ date, today, events, names, onSelect, onDetail, onCreate }: { date: string; today: string; events: CalendarEvent[]; names: OwnerNames; onSelect: (date: string) => void; onDetail: (event: CalendarEvent) => void; onCreate: (date: string) => void }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart(date), index));
  return <div className="week-view">{days.map(day => { const items = events.filter(event => occursOn(event, day)); return <section key={day} className={`week-day ${day === date ? "selected" : ""}`}><button className="week-day-heading" onClick={() => onSelect(day)}><span>{WEEKDAYS[dayOfWeek(day)]}</span><strong className={day === today ? "today" : ""}>{dayNumber(day)}</strong></button><div className="week-day-events">{items.map(event => <button key={event.occurrenceId} className={`week-event owner-${event.ownerScope}`} onClick={() => onDetail(event)}><span>{eventTime(event, day)}</span><strong>{event.title}</strong><small>{names[event.ownerScope]}</small></button>)}<button className="week-add" onClick={() => onCreate(day)} aria-label={`${shortDate(day)} 일정 추가`}><Plus size={15} /></button></div></section>; })}</div>;
}

function EventDetail({ event, names, demo, onClose, onEdit, onDelete }: { event: CalendarEvent; names: OwnerNames; demo: boolean; onClose: () => void; onEdit: () => void; onDelete: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() { setBusy(true); setError(""); try { await onDelete(); } catch (err) { setError(err instanceof Error ? err.message : "삭제하지 못했어요. 다시 시도해주세요."); setBusy(false); } }
  return <Dialog title={confirm ? "일정을 삭제할까요?" : event.title} eyebrow={demo ? "둘러보기 · 예시 일정" : "OUR MOMENT"} onClose={() => { if (!busy) onClose(); }} className={`event-detail owner-${event.ownerScope}`}><div className="dialog-body">{confirm ? <><p className="delete-explanation">‘{event.title}’ 일정이 캘린더에서 사라져요.{event.repeat !== "none" ? " 전체 반복 일정이 함께 삭제돼요." : ""}</p><div className="button-row"><button className="secondary-button" onClick={() => setConfirm(false)} disabled={busy}>돌아가기</button><button className="danger-button" onClick={() => void remove()} disabled={busy}>{busy ? "삭제 중…" : "일정 삭제"}</button></div></> : <><div className="detail-tags"><span className="owner-tag"><i className="owner-dot" />{names[event.ownerScope]}</span><span className="category-tag">{CATEGORY_NAMES[event.category]}</span></div><div className="detail-row"><CalendarDays size={19} /><p>{eventRange(event)}</p></div>{event.repeat !== "none" ? <div className="detail-row"><Repeat2 size={19} /><div><p>{REPEAT_NAMES[event.repeat]}{event.repeatUntil ? ` · ${shortDate(event.repeatUntil)}까지` : " 반복"}</p><small>수정·삭제하면 전체 반복 일정에 적용돼요.</small></div></div> : null}{event.location ? <div className="detail-row"><MapPin size={19} /><p>{event.location}</p></div> : null}{event.note ? <div className="detail-row"><AlignLeft size={19} /><p className="detail-note">{event.note}</p></div> : null}<p className="detail-shared"><Users size={14} />{demo ? "실제 공유되지 않는 예시 일정이에요." : "우리 둘이 함께 보는 일정이에요."}</p></>}{error ? <p className="form-error" role="alert"><AlertCircle size={16} />{error}</p> : null}</div>{!confirm ? <footer className="dialog-footer detail-footer"><button className="text-button danger-text" onClick={() => setConfirm(true)}><Trash2 size={16} />삭제</button><button className="primary-button" onClick={onEdit}><Pencil size={15} />일정 수정</button></footer> : null}</Dialog>;
}
