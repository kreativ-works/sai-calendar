import { CalendarError } from "../domain/calendar.ts";
import { feedbackCursor, type FeedbackBacklog, type FeedbackInput, type FeedbackItem, type FeedbackQuery, type FeedbackUpdate } from "../domain/feedback.ts";

type FeedbackRow = {
  id: string; title: string; message: string; category: FeedbackItem["category"]; page: string;
  reporter_id: string; reporter_name: string; reporter_email: string; status: FeedbackItem["status"];
  priority: FeedbackItem["priority"]; internal_note: string; revision: number; created_at: string; updated_at: string;
};
export type FeedbackReporter = { userId: string; displayName: string; email: string };
const item = (row: FeedbackRow): FeedbackItem => ({
  id: row.id, title: row.title, message: row.message, category: row.category, page: row.page,
  reporterName: row.reporter_name, reporterEmail: row.reporter_email, status: row.status, priority: row.priority,
  internalNote: row.internal_note, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
});
const conflict = (): never => { throw new CalendarError(409, "FEEDBACK_REQUEST_CONFLICT", "이 요청을 저장하지 못했어요. 새 의견으로 다시 작성해 주세요."); };
function receipt(row: FeedbackRow, reporter: FeedbackReporter, input: FeedbackInput) {
  if (row.reporter_id !== reporter.userId || row.category !== input.category || row.message !== input.message || row.page !== input.page) return conflict();
  return { ok: true as const, id: row.id, createdAt: row.created_at };
}
export async function storeFeedback(db: D1Database, reporter: FeedbackReporter, input: FeedbackInput, now = new Date()): Promise<{ created: boolean; receipt: { ok: true; id: string; createdAt: string } }> {
  const existing = await db.prepare("SELECT * FROM feedback WHERE id = ?").bind(input.id).first<FeedbackRow>();
  if (existing) return { created: false, receipt: receipt(existing, reporter, input) };
  const time = now.toISOString(), shortWindow = new Date(now.getTime() - 600_000).toISOString(), dayWindow = new Date(now.getTime() - 86_400_000).toISOString();
  const title = Array.from(input.message.replace(/\s+/g, " ")).slice(0, 80).join("");
  // A single conditional INSERT makes each quota check and write atomic, including concurrent requests.
  const inserted = await db.prepare("INSERT INTO feedback (id,title,message,category,page,reporter_id,reporter_name,reporter_email,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM feedback WHERE reporter_id = ? AND created_at > ?) < 5 AND (SELECT COUNT(*) FROM feedback WHERE reporter_id = ? AND created_at > ?) < 20 ON CONFLICT(id) DO NOTHING")
    .bind(input.id, title, input.message, input.category, input.page, reporter.userId, reporter.displayName.slice(0, 200), reporter.email, time, time, reporter.userId, shortWindow, reporter.userId, dayWindow).run();
  // Re-read handles a simultaneous retry, without disclosing another reporter's data.
  const saved = await db.prepare("SELECT * FROM feedback WHERE id = ?").bind(input.id).first<FeedbackRow>();
  if (saved) return { created: !!inserted.meta.changes, receipt: receipt(saved, reporter, input) };
  throw new CalendarError(429, "FEEDBACK_RATE_LIMIT", "의견은 10분에 5개, 하루에 20개까지 보낼 수 있어요. 잠시 후 다시 시도해 주세요.");
}
export async function getFeedbackItem(db: D1Database, id: string): Promise<FeedbackItem> {
  const row = await db.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first<FeedbackRow>();
  if (!row) throw new CalendarError(404, "FEEDBACK_NOT_FOUND", "의견을 찾지 못했어요. 목록을 새로고침해 주세요.");
  return item(row);
}
export async function listFeedback(db: D1Database, query: FeedbackQuery): Promise<FeedbackBacklog> {
  const clauses: string[] = [], values: string[] = [];
  if (query.category !== "all") { clauses.push("category = ?"); values.push(query.category); }
  if (query.priority !== "all") { clauses.push("priority = ?"); values.push(query.priority); }
  if (query.q) { clauses.push("instr(lower(title || ' ' || message || ' ' || reporter_name || ' ' || reporter_email), lower(?)) > 0"); values.push(query.q); }
  const countWhere = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const countQuery = db.prepare(`SELECT status, COUNT(*) AS total FROM feedback${countWhere} GROUP BY status`).bind(...values).all<{ status: FeedbackItem["status"]; total: number }>();
  if (query.status !== "all") { clauses.push("status = ?"); values.push(query.status); }
  if (query.cursor) { clauses.push("(created_at < ? OR (created_at = ? AND id < ?))"); values.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id); }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const [result, grouped] = await Promise.all([db.prepare(`SELECT * FROM feedback${where} ORDER BY created_at DESC, id DESC LIMIT 51`).bind(...values).all<FeedbackRow>(), countQuery]);
  const counts: FeedbackBacklog["counts"] = { all: 0, new: 0, planned: 0, in_progress: 0, done: 0, declined: 0 };
  for (const row of grouped.results) { counts[row.status] = row.total; counts.all += row.total; }
  const items = result.results.slice(0, 50).map(item);
  return { items, nextCursor: result.results.length > 50 ? feedbackCursor(items[items.length - 1]) : null, counts };
}
export async function changeFeedback(db: D1Database, id: string, update: FeedbackUpdate, now = new Date()): Promise<FeedbackItem> {
  const time = now.toISOString();
  // RETURNING returns the exact version we wrote, even if another admin updates immediately afterwards.
  const row = await db.prepare("UPDATE feedback SET status = ?, priority = ?, internal_note = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? RETURNING *")
    .bind(update.status, update.priority, update.internalNote, time, id, update.revision).first<FeedbackRow>();
  if (!row) {
    const exists = await db.prepare("SELECT id FROM feedback WHERE id = ?").bind(id).first();
    if (!exists) throw new CalendarError(404, "FEEDBACK_NOT_FOUND", "의견을 찾지 못했어요. 목록을 새로고침해 주세요.");
    throw new CalendarError(409, "REVISION_CONFLICT", "다른 화면에서 변경됐어요. 최신 내용을 불러온 후 다시 저장해 주세요.");
  }
  return item(row);
}
