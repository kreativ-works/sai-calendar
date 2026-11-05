"use client";

import type { NotificationItem, NotificationsState } from "@/lib/domain/notifications";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/domain/notifications";
import type { CalendarEvent } from "@/lib/domain/calendar";

export type PushDevice = { supported: boolean; needsInstall: boolean; permission: NotificationPermission | "unsupported"; subscription: PushSubscription | null };

export function pushEnvironment(): Omit<PushDevice, "subscription"> {
  if (typeof window === "undefined") return { supported: false, needsInstall: false, permission: "unsupported" };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
  const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { supported, needsInstall: ios && !installed, permission: "Notification" in window ? Notification.permission : "unsupported" };
}

export async function preparePush(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  if (registration.active) return registration;
  return new Promise((resolve, reject) => {
    const worker = registration.installing || registration.waiting;
    if (!worker) { reject(new Error("알림 연결을 준비하지 못했어요. 새로고침 후 다시 시도해주세요.")); return; }
    const timer = window.setTimeout(() => { worker.removeEventListener("statechange", changed); reject(new Error("알림 연결에 시간이 걸려요. 잠시 후 다시 시도해주세요.")); }, 12_000);
    function changed() {
      if (worker?.state === "activated") { window.clearTimeout(timer); worker.removeEventListener("statechange", changed); resolve(registration); }
      else if (worker?.state === "redundant") { window.clearTimeout(timer); worker.removeEventListener("statechange", changed); reject(new Error("알림 연결을 다시 준비해주세요.")); }
    }
    worker.addEventListener("statechange", changed);
    changed();
  });
}

export function pushApplicationKey(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

export function notificationTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false }).format(date);
}

export function demoNotifications(events: CalendarEvent[]): NotificationsState {
  const first = events[0];
  const second = events[1] || first;
  const now = Date.now();
  const items: NotificationItem[] = [
    { id: "demo-notice-1", kind: "event_created", title: "짝꿍이 새로운 약속을 남겼어요", body: first ? first.title : "주말에 함께 산책하기", eventId: first?.id || null, occurrenceDate: first?.startDate || null, createdAt: new Date(now - 12 * 60_000).toISOString(), readAt: null },
    { id: "demo-notice-2", kind: "reminder", title: "곧 함께할 시간이 다가와요", body: second ? `${second.title} · 30분 전` : "우리의 저녁 약속 · 30분 전", eventId: second?.id || null, occurrenceDate: second?.startDate || null, createdAt: new Date(now - 60 * 60_000).toISOString(), readAt: null },
    { id: "demo-notice-3", kind: "event_updated", title: "짝꿍이 약속을 수정했어요", body: "둘의 일정이 바뀌면 이곳에 소식을 남겨요.", eventId: first?.id || null, occurrenceDate: first?.startDate || null, createdAt: new Date(now - 3 * 60 * 60_000).toISOString(), readAt: new Date(now - 2 * 60 * 60_000).toISOString() },
  ];
  return { items, unreadCount: 2, preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES }, push: { configured: false, publicKey: null, schedulerReady: false } };
}
