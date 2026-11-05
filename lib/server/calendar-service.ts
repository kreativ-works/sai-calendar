import { env } from "cloudflare:workers";
import { getChatGPTUser, type ChatGPTUser } from "../../app/chatgpt-auth";
import {
  CalendarError, boundedText, expandEvents, parseEvent, parseHousehold,
  parseRange, parseRevision, type CalendarState, type MemberSlot,
  type StoredEvent,
} from "../domain/calendar";

type MemberRow = { user_id: string; household_id: string; slot: MemberSlot };
type HouseholdRow = { id: string; name: string; a_name: string; b_name: string; anniversary: string | null; revision: number };
type EventRow = {
  id: string; title: string; start_date: string; end_date: string;
  start_time: string | null; end_time: string | null; all_day: number;
  owner_scope: StoredEvent["ownerScope"]; category: StoredEvent["category"];
  location: string; note: string; repeat_rule: StoredEvent["repeat"];
  repeat_until: string | null; revision: number;
};

export function database(): D1Database {
  if (!env.DB) throw new CalendarError(503, "DATABASE_UNAVAILABLE", "공유 저장소를 연결하는 중이에요. 잠시 후 다시 시도해 주세요.");
  return env.DB;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}

async function discardUnreadBody(request: Request): Promise<void> {
  if (!request.body || request.bodyUsed) return;
  const reader = request.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      received += chunk.value.byteLength;
      if (received > 24_000) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // A disconnected client must not change the already determined API result.
  } finally { reader.releaseLock(); }
}

export async function api(action: () => Promise<unknown>, request: Request): Promise<Response> {
  try {
    const result = await action();
    // Some actions intentionally do not parse a body. Drain it before returning
    // so keep-alive requests remain usable through the local Worker proxy too.
    await discardUnreadBody(request);
    return json(result);
  }
  catch (error) {
    await discardUnreadBody(request);
    if (error instanceof CalendarError) return json({ error: { code: error.code, message: error.message } }, error.status);
    console.error("Calendar request failed", error instanceof Error ? error.message : "Unknown failure");
    return json({ error: { code: "SERVER_ERROR", message: "저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." } }, 503);
  }
}

async function context(request: Request, requireMember = true): Promise<{ db: D1Database; user: ChatGPTUser; member: MemberRow | null }> {
  const user = await getChatGPTUser();
  if (!user) throw new CalendarError(401, "SIGN_IN_REQUIRED", "ChatGPT로 로그인하면 두 분의 일정을 안전하게 저장할 수 있어요.");
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new CalendarError(403, "ORIGIN_DENIED", "이 캘린더 화면에서 다시 시도해 주세요.");
    const contentType = request.headers.get("content-type");
    if (request.method !== "DELETE" && !contentType?.toLowerCase().startsWith("application/json")) throw new CalendarError(415, "JSON_REQUIRED", "올바른 형식으로 다시 시도해 주세요.");
  }
  const db = database();
  const member = await db.prepare("SELECT user_id, household_id, slot FROM members WHERE user_id = ?").bind(user.userId).first<MemberRow>();
  if (requireMember && !member) throw new CalendarError(403, "HOUSEHOLD_REQUIRED", "캘린더를 만들거나 파트너의 초대 코드로 연결해 주세요.");
  return { db, user, member };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 24_000) throw new CalendarError(413, "BODY_TOO_LARGE", "입력 내용이 너무 길어요.");
  const text = await request.text();
  if (text.length > 24_000) throw new CalendarError(413, "BODY_TOO_LARGE", "입력 내용이 너무 길어요.");
  try {
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new CalendarError(422, "INVALID_JSON", "입력 내용을 확인해 주세요."); }
}

function fromRow(row: EventRow): StoredEvent {
  return { id: row.id, title: row.title, startDate: row.start_date, endDate: row.end_date,
    startTime: row.start_time, endTime: row.end_time, allDay: !!row.all_day,
    ownerScope: row.owner_scope, category: row.category, location: row.location,
    note: row.note, repeat: row.repeat_rule, repeatUntil: row.repeat_until, revision: row.revision };
}

export async function readState(request: Request): Promise<CalendarState> {
  const { db, user, member } = await context(request, false);
  const url = new URL(request.url);
  const { from, to } = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const userInfo = { id: user.userId, name: user.displayName, email: user.email };
  if (!member) return { user: userInfo, viewerSlot: null, household: null, members: [], events: [], invite: null };
  const [household, members, events, invite] = await Promise.all([
    db.prepare("SELECT id, name, a_name, b_name, anniversary, revision FROM households WHERE id = ?").bind(member.household_id).first<HouseholdRow>(),
    db.prepare("SELECT user_id, household_id, slot FROM members WHERE household_id = ?").bind(member.household_id).all<MemberRow>(),
    db.prepare("SELECT * FROM events WHERE household_id = ? AND start_date <= ? AND (repeat_rule != 'none' OR end_date >= ?) ORDER BY start_date LIMIT 2001").bind(member.household_id, to, from).all<EventRow>(),
    db.prepare("SELECT expires_at FROM invitations WHERE household_id = ? AND revoked_at IS NULL AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1").bind(member.household_id, new Date().toISOString()).first<{ expires_at: string }>(),
  ]);
  if (!household) throw new CalendarError(404, "HOUSEHOLD_NOT_FOUND", "캘린더를 찾지 못했어요.");
  if ((events.results?.length ?? 0) > 2000) throw new CalendarError(422, "TOO_MANY_EVENTS", "일정이 많아요. 조회 기간을 줄여 주세요.");
  return {
    user: userInfo, viewerSlot: member.slot,
    household: { id: household.id, name: household.name, timeZone: "Asia/Seoul", anniversary: household.anniversary, revision: household.revision },
    members: (["a", "b"] as const).map((slot) => {
      const connection = members.results.find((item) => item.slot === slot);
      return { slot, name: slot === "a" ? household.a_name : household.b_name, connected: !!connection, ...(connection ? { userId: connection.user_id } : {}) };
    }),
    events: expandEvents(events.results.map(fromRow), from, to),
    invite: invite ? { expiresAt: invite.expires_at } : null,
  };
}

export async function createHousehold(request: Request): Promise<{ ok: true }> {
  const { db, user, member } = await context(request, false);
  if (member) throw new CalendarError(409, "ALREADY_CONNECTED", "이미 연결된 캘린더가 있어요. 새로고침해 주세요.");
  const profile = parseHousehold(await body(request));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare("INSERT INTO households (id, name, a_name, b_name, anniversary, revision, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").bind(id, profile.name, profile.aName, profile.bName, profile.anniversary, now),
      db.prepare("INSERT INTO members (user_id, household_id, slot, email, joined_at) VALUES (?, ?, 'a', ?, ?)").bind(user.userId, id, user.email, now),
    ]);
  } catch (error) {
    const existing = await db.prepare("SELECT user_id FROM members WHERE user_id = ?").bind(user.userId).first();
    if (existing) throw new CalendarError(409, "ALREADY_CONNECTED", "이미 캘린더가 만들어졌어요. 새로고침해 주세요.");
    throw error;
  }
  return { ok: true };
}

export async function updateHousehold(request: Request): Promise<{ ok: true }> {
  const { db, member } = await context(request);
  const data = await body(request);
  const profile = parseHousehold(data);
  const revision = parseRevision(data.revision);
  const result = await db.prepare("UPDATE households SET name = ?, a_name = ?, b_name = ?, anniversary = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
    .bind(profile.name, profile.aName, profile.bName, profile.anniversary, member!.household_id, revision).run();
  if (!result.meta.changes) throw new CalendarError(409, "REVISION_CONFLICT", "파트너가 캘린더 정보를 바꿨어요. 새로고침 후 다시 저장해 주세요.");
  return { ok: true };
}

export async function createEvent(request: Request): Promise<{ ok: true }> {
  const { db, user, member } = await context(request);
  const data = await body(request);
  const event = parseEvent(data);
  let id = crypto.randomUUID();
  if (data.clientRequestId !== undefined) {
    if (typeof data.clientRequestId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.clientRequestId)) throw new CalendarError(422, "INVALID_REQUEST_ID", "저장 요청을 다시 시작해 주세요.");
    id = data.clientRequestId;
    const previous = await db.prepare("SELECT id FROM events WHERE id = ? AND household_id = ? AND created_by = ?").bind(id, member!.household_id, user.userId).first();
    if (previous) return { ok: true };
  }
  try {
    const result = await db.prepare("INSERT INTO events (id, household_id, title, start_date, end_date, start_time, end_time, all_day, owner_scope, category, location, note, repeat_rule, repeat_until, revision, created_by, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE (SELECT COUNT(*) FROM events WHERE household_id = ?) < 2000")
      .bind(id, member!.household_id, event.title, event.startDate, event.endDate, event.startTime, event.endTime, +event.allDay, event.ownerScope, event.category, event.location, event.note, event.repeat, event.repeatUntil, user.userId, new Date().toISOString(), member!.household_id).run();
    if (!result.meta.changes) throw new CalendarError(422, "EVENT_LIMIT", "캘린더는 최대 2,000개 일정을 저장할 수 있어요.");
  } catch (error) {
    // A lost response or simultaneous retry with the same request UUID is success
    // only when the resulting record belongs to this same actor and household.
    if (data.clientRequestId !== undefined) {
      const saved = await db.prepare("SELECT id FROM events WHERE id = ? AND household_id = ? AND created_by = ?").bind(id, member!.household_id, user.userId).first();
      if (saved) return { ok: true };
    }
    throw error;
  }
  return { ok: true };
}

export async function updateEvent(request: Request, id: string): Promise<{ ok: true }> {
  const { db, member } = await context(request);
  const data = await body(request);
  const event = parseEvent(data);
  const revision = parseRevision(data.revision);
  const result = await db.prepare("UPDATE events SET title = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, all_day = ?, owner_scope = ?, category = ?, location = ?, note = ?, repeat_rule = ?, repeat_until = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND household_id = ? AND revision = ?")
    .bind(event.title, event.startDate, event.endDate, event.startTime, event.endTime, +event.allDay, event.ownerScope, event.category, event.location, event.note, event.repeat, event.repeatUntil, new Date().toISOString(), id, member!.household_id, revision).run();
  if (!result.meta.changes) await notFoundOrConflict(db, id, member!.household_id);
  return { ok: true };
}

export async function deleteEvent(request: Request, id: string): Promise<{ ok: true }> {
  const { db, member } = await context(request);
  const revision = parseRevision((await body(request)).revision);
  const result = await db.prepare("DELETE FROM events WHERE id = ? AND household_id = ? AND revision = ?").bind(id, member!.household_id, revision).run();
  if (!result.meta.changes) await notFoundOrConflict(db, id, member!.household_id);
  return { ok: true };
}

async function notFoundOrConflict(db: D1Database, id: string, householdId: string): Promise<never> {
  const exists = await db.prepare("SELECT id FROM events WHERE id = ? AND household_id = ?").bind(id, householdId).first();
  if (!exists) throw new CalendarError(404, "EVENT_NOT_FOUND", "일정이 삭제되었거나 이 캘린더의 일정이 아니에요.");
  throw new CalendarError(409, "REVISION_CONFLICT", "파트너가 이 일정을 먼저 수정했어요. 입력 내용은 유지했으니 최신 일정을 확인한 뒤 다시 저장해 주세요.");
}

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

export async function createInvite(request: Request): Promise<{ code: string; url: string; expiresAt: string }> {
  const { db, user, member } = await context(request);
  if (member!.slot !== "a") throw new CalendarError(403, "INVITE_OWNER_ONLY", "캘린더를 만든 분만 연결 초대를 관리할 수 있어요.");
  const partner = await db.prepare("SELECT user_id FROM members WHERE household_id = ? AND slot = 'b'").bind(member!.household_id).first();
  if (partner) throw new CalendarError(409, "HOUSEHOLD_FULL", "이미 두 분의 계정이 연결되어 있어요.");
  const random = crypto.getRandomValues(new Uint8Array(12));
  const code = `SAI-${Array.from(random, (item) => item.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  const hash = await hashCode(code);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await db.batch([
    db.prepare("UPDATE invitations SET revoked_at = ? WHERE household_id = ? AND revoked_at IS NULL AND used_at IS NULL").bind(now, member!.household_id),
    db.prepare("INSERT INTO invitations (id, household_id, code_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), member!.household_id, hash, expiresAt, user.userId, now),
  ]);
  const url = new URL(request.url);
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("join", code);
  return { code, url: url.toString(), expiresAt };
}

export async function revokeInvites(request: Request): Promise<{ ok: true }> {
  const { db, member } = await context(request);
  if (member!.slot !== "a") throw new CalendarError(403, "INVITE_OWNER_ONLY", "캘린더를 만든 분만 연결 초대를 관리할 수 있어요.");
  await db.prepare("UPDATE invitations SET revoked_at = ? WHERE household_id = ? AND revoked_at IS NULL AND used_at IS NULL").bind(new Date().toISOString(), member!.household_id).run();
  return { ok: true };
}

export async function joinInvite(request: Request): Promise<{ ok: true }> {
  const { db, user, member } = await context(request, false);
  if (member) throw new CalendarError(409, "ALREADY_CONNECTED", "이미 캘린더에 연결되어 있어요. 하나의 계정은 하나의 캘린더에 연결할 수 있어요.");
  const rawCode = boundedText((await body(request)).code, "초대 코드", 80, true);
  const code = rawCode.replace(/\s/g, "").toUpperCase();
  const hash = await hashCode(code);
  const now = new Date().toISOString();
  const invitation = await db.prepare("SELECT id, household_id FROM invitations WHERE code_hash = ? AND revoked_at IS NULL AND used_at IS NULL AND expires_at > ?").bind(hash, now).first<{ id: string; household_id: string }>();
  if (!invitation) throw new CalendarError(422, "INVALID_INVITE", "초대 코드가 만료되었거나 사용할 수 없어요. 파트너에게 새 코드를 요청해 주세요.");
  try {
    const results = await db.batch([
      db.prepare("INSERT INTO members (user_id, household_id, slot, email, joined_at) SELECT ?, household_id, 'b', ?, ? FROM invitations WHERE id = ? AND revoked_at IS NULL AND used_at IS NULL AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM members WHERE household_id = invitations.household_id AND slot = 'b')")
        .bind(user.userId, user.email, now, invitation.id, now),
      db.prepare("UPDATE invitations SET used_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM members WHERE user_id = ? AND household_id = invitations.household_id AND slot = 'b')").bind(now, invitation.id, user.userId),
    ]);
    if (!results[0].meta.changes) throw new CalendarError(409, "INVITE_UNAVAILABLE", "이미 사용되었거나 취소된 초대예요. 새 초대 코드를 요청해 주세요.");
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    const partner = await db.prepare("SELECT user_id FROM members WHERE household_id = ? AND slot = 'b'").bind(invitation.household_id).first();
    const existing = await db.prepare("SELECT user_id FROM members WHERE user_id = ?").bind(user.userId).first();
    if (partner || existing) throw new CalendarError(409, "INVITE_UNAVAILABLE", "이미 연결되었거나 사용된 초대예요. 새로고침 후 확인해 주세요.");
    throw error;
  }
  return { ok: true };
}
