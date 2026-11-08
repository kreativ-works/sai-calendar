import { env } from "cloudflare:workers";
import { CalendarError, type MemberSlot } from "../domain/calendar";
import { parseAssistantInput, parseAssistantSettings, validateAssistantResult } from "../domain/assistant";
import { authBody, authJson, getAppUser } from "./app-auth";
import { isFeedbackAdmin } from "./feedback-service";
import { claimAssistantQuota, readAssistantEvents } from "./assistant-db";
import { assistantPrompt, requestAssistant } from "./assistant-provider";
import { publicAssistantConfig, readPrivateAssistantSettings, saveAssistantSettings } from "./assistant-settings";

const encryptionKey = () => (env as unknown as Record<string, unknown>).SAI_AI_ENCRYPTION_KEY;
async function context(admin = false) {
  const user = await getAppUser();
  if (!user) throw new CalendarError(401, "SIGN_IN_REQUIRED", "로그인 후 AI 일정 도우미를 사용할 수 있어요.");
  if (admin && !isFeedbackAdmin(user)) throw new CalendarError(403, "FEEDBACK_ADMIN_REQUIRED", "AI 연결을 관리할 권한이 없어요.");
  if (!env.DB) throw new CalendarError(503, "DATABASE_UNAVAILABLE", "공유 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return { user, db: env.DB };
}
export async function readAssistantConfig(): Promise<Response> {
  const { db } = await context();
  return authJson(await publicAssistantConfig(db, encryptionKey()));
}
export async function readAdminAiConfig(): Promise<Response> {
  const { db } = await context(true);
  return authJson(await publicAssistantConfig(db, encryptionKey()));
}
export async function updateAdminAiConfig(request: Request): Promise<Response> {
  const { db, user } = await context(true);
  return authJson(await saveAssistantSettings(db, encryptionKey(), parseAssistantSettings(await authBody(request)), user.userId));
}
export async function deleteAdminAiConfig(request: Request): Promise<Response> {
  const { db } = await context(true);
  await authBody(request);
  await db.prepare("DELETE FROM ai_settings WHERE id = 1").run();
  return authJson({ configured: false, provider: null, model: null });
}
async function extractBody(request: Request): Promise<unknown> {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new CalendarError(403, "ORIGIN_DENIED", "사이 화면에서 다시 시도해 주세요.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new CalendarError(415, "JSON_REQUIRED", "올바른 입력 형식으로 다시 시도해 주세요.");
  if (Number(request.headers.get("content-length") ?? 0) > 25_000 || !request.body) throw new CalendarError(413, "BODY_TOO_LARGE", "분석할 내용은 6,000자까지 입력할 수 있어요.");
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let length = 0, text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 25_000) { await reader.cancel(); throw new CalendarError(413, "BODY_TOO_LARGE", "분석할 내용은 6,000자까지 입력할 수 있어요."); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(text) as unknown; } catch { throw new CalendarError(422, "INVALID_ASSISTANT_INPUT", "분석할 내용을 다시 확인해 주세요."); }
}
export async function extractAssistant(request: Request): Promise<Response> {
  const { db, user } = await context();
  const input = parseAssistantInput(await extractBody(request));
  const member = await db.prepare("SELECT household_id,slot FROM members WHERE user_id = ?").bind(user.userId).first<{ household_id: string; slot: MemberSlot }>();
  if (!member) throw new CalendarError(403, "HOUSEHOLD_REQUIRED", "먼저 우리 캘린더를 만들거나 짝꿍의 초대로 연결해 주세요.");
  const settings = await readPrivateAssistantSettings(db, encryptionKey());
  if (!settings) throw new CalendarError(503, "AI_NOT_CONFIGURED", "AI 일정 도우미가 아직 연결되지 않았어요. 운영자가 제공자와 API 키를 연결한 후 사용할 수 있어요.");
  await claimAssistantQuota(db, user.userId);
  const now = new Date(), contextEvents = await readAssistantEvents(db, member.household_id, now);
  const raw = await requestAssistant(settings, assistantPrompt(input.text, input.source, contextEvents.events, member.slot, now));
  const current = await db.prepare("SELECT household_id FROM members WHERE user_id = ?").bind(user.userId).first<{ household_id: string }>();
  if (current?.household_id !== member.household_id) throw new CalendarError(409, "SESSION_CHANGED", "캘린더 연결이 바뀌었어요. 새로고침 후 다시 시도해 주세요.");
  const result = validateAssistantResult(raw, contextEvents.events);
  if (contextEvents.truncated) for (const candidate of result.candidates) candidate.warnings.push("기존 일정은 최대 100개만 참고했어요. 변경 대상이 정확한지 확인해 주세요.");
  return authJson(result);
}
