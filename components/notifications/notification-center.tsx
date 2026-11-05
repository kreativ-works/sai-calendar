"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Bell, CalendarDays, CheckCheck, ChevronRight, Clock3, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import type { CalendarEvent } from "@/lib/domain/calendar";
import type { NotificationItem, NotificationPreferences, NotificationsState } from "@/lib/domain/notifications";
import { api } from "@/lib/client/api";
import { demoNotifications, notificationTime, preparePush, pushApplicationKey, pushEnvironment, type PushDevice } from "@/lib/client/notifications";
import Dialog from "@/components/calendar/dialog";
import NotificationSettings from "./notification-settings";

export type NotificationView = "inbox" | "settings" | null;
type Props = { demo: boolean; enabled: boolean; userId?: string; events: CalendarEvent[]; view: NotificationView; refreshKey?: number; onViewChange: (view: NotificationView) => void; onOpenEvent: (item: NotificationItem) => Promise<void>; onConnect: () => void };
const EMPTY_DEVICE: PushDevice = { supported: false, needsInstall: false, permission: "unsupported", subscription: null };

export default function NotificationCenter({ demo, enabled, userId, events, view, refreshKey = 0, onViewChange, onOpenEvent, onConnect }: Props) {
  const [state, setState] = useState<NotificationsState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [marking, setMarking] = useState(false);
  const [device, setDevice] = useState<PushDevice>(EMPTY_DEVICE);
  const [registered, setRegistered] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const [pushNotice, setPushNotice] = useState("");
  const alive = useRef(true);
  const requests = useRef(0);
  const demoEvents = useRef(events);
  useEffect(() => { demoEvents.current = events; }, [events]);
  const refresh = useCallback(async (quiet = false) => {
    if (demo || !enabled) return null;
    const request = ++requests.current;
    if (!quiet) setLoading(true);
    try {
      const next = await api<NotificationsState>("/api/notifications");
      if (alive.current && request === requests.current) { setState(next); setError(""); }
      return next;
    } catch (cause) { if (alive.current && request === requests.current) setError(cause instanceof Error ? cause.message : "알림을 불러오지 못했어요."); return null; }
    finally { if (alive.current && request === requests.current) setLoading(false); }
  }, [demo, enabled]);

  // Hydrate account-scoped external data; demo notifications never reach the API.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    alive.current = true;
    ++requests.current;
    setState(null); setError(""); setRegistered(false); setPushError(""); setPushNotice("");
    if (demo) setState(demoNotifications(demoEvents.current));
    else if (enabled) void refresh();
    return () => { alive.current = false; };
  }, [demo, enabled, userId, refresh, refreshKey]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (demo || !enabled) return;
    const update = () => { if (!document.hidden) void refresh(true); };
    const workerMessage = (event: MessageEvent) => { if (event.data?.type === "sai:notification") update(); };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", workerMessage);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", workerMessage); };
  }, [demo, enabled, refresh]);
  useEffect(() => {
    if (demo || !enabled || !state?.push.configured) return;
    let active = true;
    async function inspect() {
      const environment = pushEnvironment();
      if (environment.needsInstall || !environment.supported) { if (active) { setDevice({ ...environment, subscription: null }); setRegistered(false); } return; }
      try {
        const registration = await preparePush();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription && environment.permission === "granted") await api("/api/notifications/subscriptions", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) });
        if (active) { setDevice({ ...environment, subscription }); setRegistered(!!subscription && environment.permission === "granted"); }
      } catch (cause) { if (active) { setDevice({ ...environment, subscription: null }); setPushError(cause instanceof Error ? cause.message : "기기 알림 연결을 확인해주세요."); } }
    }
    void inspect();
    const onFocus = () => { if (!document.hidden) void inspect(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, [demo, enabled, userId, state?.push.configured, view]);

  async function markRead(ids?: string[]) {
    if (!state || marking) return;
    const timestamp = new Date().toISOString();
    const selected = new Set(ids || state.items.map(item => item.id));
    const changed = state.items.filter(item => !item.readAt && selected.has(item.id)).length;
    setState(previous => previous ? { ...previous, unreadCount: ids ? Math.max(0, previous.unreadCount - changed) : 0, items: previous.items.map(item => selected.has(item.id) ? { ...item, readAt: item.readAt || timestamp } : item) } : previous);
    if (demo) return;
    setMarking(true); setError("");
    try { await api("/api/notifications", { method: "PATCH", body: JSON.stringify(ids ? { ids } : { allBefore: timestamp }) }); await refresh(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "읽음 상태를 저장하지 못했어요."); setState(state); }
    finally { setMarking(false); }
  }

  async function savePreferences(preferences: NotificationPreferences) {
    if (demo) { const next = { ...preferences, revision: preferences.revision + 1 }; setState(previous => previous ? { ...previous, preferences: next } : previous); return next; }
    await api("/api/notifications/preferences", { method: "PATCH", body: JSON.stringify(preferences) });
    const next = await refresh(true);
    if (!next) throw new Error("저장한 설정을 다시 확인해주세요. 입력한 내용은 그대로 있어요.");
    return next.preferences;
  }
  async function pushAction(work: () => Promise<void>) {
    if (pushBusy || demo) return;
    setPushBusy(true); setPushError(""); setPushNotice("");
    try { await work(); }
    catch (cause) { setPushError(cause instanceof Error ? cause.message : "기기 알림을 연결하지 못했어요."); }
    finally { setPushBusy(false); }
  }
  function enablePush() {
    if (demo || pushBusy || !state?.push.configured || !state.push.publicKey) return;
    const environment = pushEnvironment();
    if (!environment.supported || environment.needsInstall) return;
    // Request immediately from this tap; never after awaiting registration/network work.
    let permission: Promise<NotificationPermission>;
    try { permission = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission); }
    catch { setPushError("알림 권한 창을 열지 못했어요. Safari·Chrome 또는 홈 화면에 추가한 사이에서 다시 시도해주세요."); return; }
    void pushAction(async () => {
      const allowed = await permission;
      setDevice(previous => ({ ...previous, ...environment, permission: allowed }));
      if (allowed !== "granted") { setPushNotice(allowed === "denied" ? "기기 설정에서 알림을 허용하면 다시 연결할 수 있어요." : "지금은 알림을 켜지 않았어요. 원할 때 다시 켤 수 있어요."); return; }
      const registration = await preparePush();
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushApplicationKey(state.push.publicKey!) });
      await api("/api/notifications/subscriptions", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) });
      setDevice({ ...environment, permission: allowed, subscription }); setRegistered(true); setPushNotice("이 기기에서 사이의 알림을 받을 수 있어요.");
    });
  }
  function disablePush() {
    const subscription = device.subscription;
    if (!subscription) return;
    void pushAction(async () => { await subscription.unsubscribe(); setDevice(previous => ({ ...previous, subscription: null })); setRegistered(false); await api("/api/notifications/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); setPushNotice("이 기기의 알림을 껐어요. 다른 기기의 설정은 그대로예요."); });
  }
  function testPush() { if (device.subscription && registered) void pushAction(async () => { await api("/api/notifications/test", { method: "POST", body: JSON.stringify({ endpoint: device.subscription!.endpoint }) }); setPushNotice("테스트 알림을 요청했어요. 기기의 알림을 확인해주세요."); }); }
  const count = state?.unreadCount || 0;
  return <><button type="button" className="icon-button notification-bell" aria-label={`알림${count ? `, 읽지 않은 알림 ${count}개` : ""}`} aria-haspopup="dialog" onClick={() => onViewChange("inbox")}><Bell size={21} />{count ? <span className="notification-badge" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}</button>
    {view ? <Dialog title={view === "settings" ? "내 알림 설정" : "둘의 소식"} eyebrow={demo ? "둘러보기 · 예시 알림" : "A LITTLE NOTE FOR YOU"} onClose={() => onViewChange(null)} className="notification-dialog">
      {view === "settings" && state ? <NotificationSettings state={state} demo={demo} device={device} pushActive={registered && !!device.subscription} pushBusy={pushBusy} pushError={pushError} pushNotice={pushNotice} onBack={() => onViewChange("inbox")} onSave={savePreferences} onEnable={enablePush} onDisable={disablePush} onTest={testPush} /> : <div className="dialog-body notification-inbox"><div className="notification-inbox-toolbar"><span>{count ? `아직 읽지 않은 소식 ${count}개` : "우리의 새로운 소식을 모았어요"}</span><div><button type="button" className="icon-button" aria-label="알림 새로고침" disabled={loading || demo || !enabled} onClick={() => void refresh()}><RefreshCw size={17} className={loading ? "spin" : ""} /></button><button type="button" className="icon-button" aria-label="알림 설정" disabled={!state} onClick={() => onViewChange("settings")}><Settings2 size={18} /></button></div></div>
        {demo ? <p className="notification-demo-note">예시 알림이에요. 실제로 전송되거나 공유되지 않아요.</p> : null}
        {error ? <p className="notice-message error" role="alert"><AlertCircle size={16} />{error}</p> : null}
        {loading && !state ? <div className="notification-empty" role="status"><LoaderCircle size={26} className="spin" /><h3>새로운 소식을 불러오고 있어요</h3></div> : !enabled && !demo ? <div className="notification-empty"><Bell size={32} strokeWidth={1.3} /><h3>{userId ? "우리 캘린더를 먼저 연결해요" : "로그인하고 소식을 받아보세요"}</h3><p>짝꿍이 남긴 약속과 다가오는 시간을<br />이곳에서 함께 확인할 수 있어요.</p>{userId ? <button type="button" className="primary-button" onClick={() => { onViewChange(null); onConnect(); }}>우리 캘린더 시작하기</button> : <a className="primary-button" href="/login?returnTo=%2Fapp">로그인하고 시작하기</a>}</div> : state?.items.length ? <><div className="notification-mark-row"><button type="button" className="text-button" disabled={!count || marking} onClick={() => void markRead()}><CheckCheck size={16} />모두 읽음</button></div><ul className="notification-items">{state.items.map(item => <li key={item.id}><button type="button" className={`notification-item ${item.readAt ? "" : "is-unread"}`} onClick={() => { if (!item.readAt) void markRead([item.id]); onViewChange(null); void onOpenEvent(item); }}><span className={`notification-item-icon ${item.kind === "reminder" ? "is-reminder" : ""}`}>{item.kind === "reminder" ? <Clock3 size={20} /> : <CalendarDays size={20} />}</span><span className="notification-item-copy"><span className="notification-item-title">{item.title}{!item.readAt ? <i aria-label="읽지 않음" /> : null}</span><span className="notification-item-body">{item.body}</span><time dateTime={item.createdAt}>{notificationTime(item.createdAt)}{item.kind === "event_deleted" ? " · 삭제된 일정" : ""}</time></span>{item.eventId && item.kind !== "event_deleted" ? <ChevronRight size={16} /> : null}</button></li>)}</ul></> : <div className="notification-empty"><Bell size={34} strokeWidth={1.2} /><h3>아직 도착한 소식이 없어요</h3><p>짝꿍이 약속을 남기거나 바꾸면<br />여기에 새로운 소식이 쌓여요.</p><button type="button" className="secondary-button" disabled={!state} onClick={() => onViewChange("settings")}><Settings2 size={16} />알림 설정 살펴보기</button></div>}
      </div>}
    </Dialog> : null}
  </>;
}
