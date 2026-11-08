import { CalendarError, shiftDate, type StoredEvent } from "../domain/calendar.ts";

export async function claimAssistantQuota(db: D1Database, userId: string, now = new Date()): Promise<void> {
  const current = now.toISOString(), minute = new Date(now.getTime() - 60_000).toISOString(), day = new Date(now.getTime() - 86_400_000).toISOString();
  const results = await db.batch([
    db.prepare("DELETE FROM assistant_usage WHERE created_at < ?").bind(new Date(now.getTime() - 172_800_000).toISOString()),
    db.prepare("INSERT INTO assistant_usage (id,user_id,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM assistant_usage WHERE user_id = ? AND created_at > ?) < 3 AND (SELECT COUNT(*) FROM assistant_usage WHERE user_id = ? AND created_at > ?) < 20 AND (SELECT COUNT(*) FROM assistant_usage WHERE created_at > ?) < 200")
      .bind(crypto.randomUUID(), userId, current, userId, minute, userId, day, day),
  ]);
  if (!results[1].meta.changes) throw new CalendarError(429, "AI_RATE_LIMIT", "AI 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요. 사용자별 1분 3회·24시간 20회까지 사용할 수 있어요.");
}
type EventRow = {
  id: string; title: string; start_date: string; end_date: string; start_time: string | null; end_time: string | null;
  all_day: number; owner_scope: StoredEvent["ownerScope"]; category: StoredEvent["category"]; location: string;
  note: string; repeat_rule: StoredEvent["repeat"]; repeat_until: string | null; revision: number;
};
export async function readAssistantEvents(db: D1Database, householdId: string, now = new Date()): Promise<{ events: StoredEvent[]; truncated: boolean }> {
  const today = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const from = shiftDate(today, -30), to = shiftDate(today, 90);
  const result = await db.prepare("SELECT id,title,start_date,end_date,start_time,end_time,all_day,owner_scope,category,location,note,repeat_rule,repeat_until,revision FROM events WHERE household_id = ? AND start_date <= ? AND (end_date >= ? OR (repeat_rule != 'none' AND (repeat_until IS NULL OR repeat_until >= ?))) ORDER BY CASE WHEN start_date >= ? THEN 0 ELSE 1 END,start_date DESC,id DESC LIMIT 101")
    .bind(householdId, to, from, from, from).all<EventRow>();
  return { truncated: result.results.length > 100, events: result.results.slice(0, 100).map(row => ({ id: row.id, title: row.title, startDate: row.start_date, endDate: row.end_date, startTime: row.start_time, endTime: row.end_time, allDay: !!row.all_day, ownerScope: row.owner_scope, category: row.category, location: row.location, note: row.note, repeat: row.repeat_rule, repeatUntil: row.repeat_until, revision: row.revision })) };
}
