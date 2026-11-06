import { CalendarError } from "./calendar.ts";

export type FeedbackCategory = "bug" | "idea" | "other";
export type FeedbackStatus = "new" | "planned" | "in_progress" | "done" | "declined";
export type FeedbackPriority = "none" | "low" | "medium" | "high";
export const FEEDBACK_MESSAGE_MIN = 10;
export const FEEDBACK_TEXT_MAX = 2_000;
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = { bug: "오류 제보", idea: "기능 제안", other: "기타 의견" };
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = { new: "새 의견", planned: "예정", in_progress: "진행 중", done: "완료", declined: "보류" };
export const FEEDBACK_PRIORITY_LABELS: Record<FeedbackPriority, string> = { none: "미지정", low: "낮음", medium: "보통", high: "높음" };

export interface FeedbackInput { id: string; category: FeedbackCategory; message: string; page: string }
export interface FeedbackUpdate { revision: number; status: FeedbackStatus; priority: FeedbackPriority; internalNote: string }
export interface FeedbackItem extends FeedbackInput {
  title: string; reporterName: string; reporterEmail: string; status: FeedbackStatus;
  priority: FeedbackPriority; internalNote: string; revision: number; createdAt: string; updatedAt: string;
}
export interface FeedbackBacklog {
  items: FeedbackItem[]; nextCursor: string | null;
  counts: Record<"all" | FeedbackStatus, number>;
}
export interface FeedbackQuery {
  status: FeedbackStatus | "all"; priority: FeedbackPriority | "all"; category: FeedbackCategory | "all";
  q: string; cursor: { createdAt: string; id: string } | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = (message = "입력 내용을 다시 확인해 주세요."): never => { throw new CalendarError(422, "INVALID_FEEDBACK", message); };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const has = <T extends string>(values: Record<T, string>, value: unknown): value is T => typeof value === "string" && Object.hasOwn(values, value);
const text = (value: unknown, min: number, max: number): string => {
  if (typeof value !== "string") return invalid();
  const result = value.replace(/\r\n?/g, "\n").trim();
  if (result.length < min || result.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(result)) return invalid();
  return result;
};
export function parseFeedbackId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) return invalid();
  return value.toLowerCase();
}
export function parseFeedback(value: unknown): FeedbackInput {
  const data = record(value);
  const id = parseFeedbackId(data.id);
  if (!has(FEEDBACK_CATEGORY_LABELS, data.category)) return invalid();
  const message = text(data.message, FEEDBACK_MESSAGE_MIN, FEEDBACK_TEXT_MAX);
  // Keep context useful without persisting invite codes, URL parameters, or external URLs.
  if (typeof data.page !== "string" || data.page.length > 200 || !/^\/[a-zA-Z0-9/_-]*$/.test(data.page) || data.page.includes("//")) return invalid();
  return { id, category: data.category, message, page: data.page };
}
export function parseFeedbackUpdate(value: unknown): FeedbackUpdate {
  const data = record(value);
  if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 1 || (data.revision as number) >= Number.MAX_SAFE_INTEGER || !has(FEEDBACK_STATUS_LABELS, data.status) || !has(FEEDBACK_PRIORITY_LABELS, data.priority)) return invalid();
  return { revision: data.revision as number, status: data.status, priority: data.priority, internalNote: text(data.internalNote, 0, FEEDBACK_TEXT_MAX) };
}

function encodeCursor(value: { createdAt: string; id: string }): string {
  return btoa(JSON.stringify([value.createdAt, value.id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const feedbackCursor = (item: Pick<FeedbackItem, "createdAt" | "id">): string => encodeCursor(item);
function decodeCursor(value: string): FeedbackQuery["cursor"] {
  try {
    if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return invalid();
    const parsed: unknown = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(parsed[0]) || !Number.isFinite(Date.parse(parsed[0])) || new Date(parsed[0]).toISOString() !== parsed[0]) return invalid();
    const result = { createdAt: parsed[0], id: parseFeedbackId(parsed[1]) };
    if (encodeCursor(result) !== value) return invalid();
    return result;
  } catch { return invalid("목록 위치를 확인하지 못했어요. 첫 페이지부터 다시 열어 주세요."); }
}
export function parseFeedbackQuery(params: URLSearchParams): FeedbackQuery {
  if ([...params.keys()].some((key) => !["status", "priority", "category", "q", "cursor"].includes(key) || params.getAll(key).length !== 1)) return invalid();
  const status = params.get("status") ?? "all", priority = params.get("priority") ?? "all", category = params.get("category") ?? "all";
  if ((status !== "all" && !has(FEEDBACK_STATUS_LABELS, status)) || (priority !== "all" && !has(FEEDBACK_PRIORITY_LABELS, priority)) || (category !== "all" && !has(FEEDBACK_CATEGORY_LABELS, category))) return invalid();
  const q = text(params.get("q") ?? "", 0, 100), cursor = params.get("cursor");
  return { status, priority, category, q, cursor: cursor ? decodeCursor(cursor) : null };
}

// Callers must supply a server-verified identity. Never use a client email or a household role.
export function isAllowedFeedbackAdmin(user: { email: string } | null, configuredEmails: unknown): boolean {
  if (!user || typeof configuredEmails !== "string" || configuredEmails.length > 4_096 || typeof user.email !== "string") return false;
  const emails = configuredEmails.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!emails.length || emails.length > 20 || emails.some((email) => email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email))) return false;
  return emails.includes(user.email.trim().toLowerCase());
}
