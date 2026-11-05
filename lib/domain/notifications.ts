import { CalendarError } from "./calendar.ts";

export type NotificationKind = "event_created" | "event_updated" | "event_deleted" | "reminder";

export interface NotificationPreferences {
  partnerChanges: boolean;
  reminders: boolean;
  includePartner: boolean;
  minutes: 10 | 30 | 60 | 1440;
  allDayTime: string;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  preview: boolean;
  revision: number;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  partnerChanges: true, reminders: true, includePartner: false, minutes: 30,
  allDayTime: "09:00", quietEnabled: false, quietStart: "22:00", quietEnd: "08:00",
  preview: false, revision: 1,
};

export const defaultNotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES;

export function parseNotificationPreferences(value: unknown): NotificationPreferences {
  const invalid = (): never => { throw new CalendarError(422, "INVALID_NOTIFICATION_PREFERENCES", "알림 설정을 확인해 주세요."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  for (const key of ["partnerChanges", "reminders", "includePartner", "quietEnabled", "preview"]) if (typeof data[key] !== "boolean") return invalid();
  for (const key of ["allDayTime", "quietStart", "quietEnd"]) if (typeof data[key] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data[key] as string)) return invalid();
  if (![10, 30, 60, 1440].includes(data.minutes as number) || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1) return invalid();
  if (data.quietEnabled && data.quietStart === data.quietEnd) return invalid();
  return {
    partnerChanges: data.partnerChanges as boolean, reminders: data.reminders as boolean,
    includePartner: data.includePartner as boolean, minutes: data.minutes as NotificationPreferences["minutes"],
    allDayTime: data.allDayTime as string, quietEnabled: data.quietEnabled as boolean,
    quietStart: data.quietStart as string, quietEnd: data.quietEnd as string,
    preview: data.preview as boolean, revision: data.revision as number,
  };
}

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  eventId: string | null;
  occurrenceDate: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsState {
  items: NotificationItem[];
  unreadCount: number;
  preferences: NotificationPreferences;
  push: { configured: boolean; publicKey: string | null; schedulerReady: boolean };
}

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  ttlSeconds?: number;
}
