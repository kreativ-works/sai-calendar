import { CalendarError, parseEvent, type CalendarEventInput, type StoredEvent } from "./calendar.ts";

export type AssistantProvider = "gemini" | "openai";
export type AssistantSource = "paste" | "share" | "voice";
export interface AssistantConfig { configured: boolean; provider: AssistantProvider | null; model: string | null }
export interface AssistantCandidate {
  id: string; action: "create" | "update" | "delete"; event: CalendarEventInput;
  previous: CalendarEventInput | null; eventId: string | null; revision: number | null;
  reason: string; needsReview: boolean; warnings: string[];
}
export interface AssistantResult { candidates: AssistantCandidate[]; summary: string }
export const ASSISTANT_TEXT_MAX = 6_000;
export const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";
export const ASSISTANT_CANDIDATE_MAX = 8;
export const disabledAssistantConfig = (): AssistantConfig => ({ configured: false, provider: null, model: null });
const invalid = (): never => { throw new CalendarError(422, "INVALID_ASSISTANT_INPUT", "분석할 내용과 입력 방식을 확인해 주세요. 내용은 6,000자까지 입력할 수 있어요."); };
export function parseAssistantInput(value: unknown): { text: string; source: AssistantSource } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  if (typeof data.text !== "string" || !data.text.trim() || data.text.length > ASSISTANT_TEXT_MAX || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(data.text) || !["paste", "share", "voice"].includes(data.source as string)) return invalid();
  return { text: data.text.trim(), source: data.source as AssistantSource };
}
export function parseAssistantModel(provider: AssistantProvider, value: unknown): string {
  const model = provider === "gemini" && (value === "" || value == null) ? GEMINI_DEFAULT_MODEL : value;
  if (typeof model !== "string" || !(provider === "gemini" ? /^gemini-[a-z0-9][a-z0-9._-]{0,79}$/ : /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/).test(model)) throw new CalendarError(422, "INVALID_AI_SETTINGS", "올바른 모델 ID를 입력해 주세요. OpenAI 모델은 직접 지정해야 해요.");
  return model;
}
export function parseAssistantSettings(value: Record<string, unknown>): { provider: AssistantProvider; model: string; apiKey: string } {
  if (value.provider !== "gemini" && value.provider !== "openai") throw new CalendarError(422, "INVALID_AI_SETTINGS", "AI 제공자를 선택해 주세요.");
  if (typeof value.apiKey !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(value.apiKey)) throw new CalendarError(422, "INVALID_AI_SETTINGS", "API 키 형식을 확인해 주세요.");
  return { provider: value.provider, model: parseAssistantModel(value.provider, value.model), apiKey: value.apiKey };
}

const badResult = (): never => { throw new CalendarError(502, "AI_RESULT_INVALID", "AI가 안전하게 확인할 수 있는 일정 초안을 만들지 못했어요. 내용을 더 구체적으로 입력해 주세요."); };
const resultText = (value: unknown, max: number): string => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) ? value.trim() : badResult();

/** Treat every model field as untrusted; only server-loaded household IDs can be changed. */
export function validateAssistantResult(value: unknown, context: StoredEvent[]): AssistantResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return badResult();
  const data = value as Record<string, unknown>;
  const summary = resultText(data.summary, 1_000);
  if (!Array.isArray(data.candidates) || data.candidates.length > ASSISTANT_CANDIDATE_MAX) return badResult();
  const known = new Map(context.map(event => [event.id, event]));
  const changedIds = new Set<string>();
  const candidates: AssistantCandidate[] = data.candidates.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badResult();
    const candidate = raw as Record<string, unknown>;
    const action = candidate.action;
    if (action !== "create" && action !== "update" && action !== "delete") return badResult();
    const reason = resultText(candidate.reason, 500);
    if (typeof candidate.needsReview !== "boolean" || !Array.isArray(candidate.warnings) || candidate.warnings.length > 8) return badResult();
    const warnings = candidate.warnings.map(warning => resultText(warning, 250));
    let previous: CalendarEventInput | null = null, eventId: string | null = null, revision: number | null = null;
    let event: CalendarEventInput;
    try {
      if (action !== "create") {
        if (typeof candidate.eventId !== "string" || changedIds.has(candidate.eventId)) return badResult();
        const stored = known.get(candidate.eventId);
        if (!stored || !Number.isSafeInteger(stored.revision) || stored.revision < 1) return badResult();
        changedIds.add(stored.id);
        previous = parseEvent(stored); eventId = stored.id; revision = stored.revision;
        // Existing private notes are not sent to the model and must not be erased by its replacement object.
        event = action === "delete" ? previous : parseEvent({ ...(candidate.event as Record<string, unknown>), note: previous.note });
        if (previous.repeat !== "none") warnings.push("반복 일정 전체에 적용돼요. 한 번의 일정만 바꾸는 작업이 아니에요.");
      } else {
        if (candidate.eventId !== null) return badResult();
        // A pasted conversation is input for interpretation, never an implicit shared event memo.
        event = parseEvent({ ...(candidate.event as Record<string, unknown>), note: "" });
      }
    } catch { return badResult(); }
    // Every AI proposal needs human review, including a valid-looking date inferred from ambiguous language.
    warnings.push("AI가 해석한 날짜·시간·일정의 주인공을 확인해 주세요.");
    return { id: crypto.randomUUID(), action, event, previous, eventId, revision, reason, needsReview: true, warnings: [...new Set(warnings)] };
  });
  return { candidates, summary };
}

const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const eventProperties = {
  title: string, startDate: string, endDate: string, startTime: nullableString, endTime: nullableString,
  allDay: { type: "boolean" }, ownerScope: { type: "string", enum: ["a", "b", "both"] },
  category: { type: "string", enum: ["life", "date", "family", "work", "anniversary"] },
  location: string, note: string, repeat: { type: "string", enum: ["none", "weekly", "monthly", "yearly"] }, repeatUntil: nullableString,
};
export const ASSISTANT_RESPONSE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "candidates"], properties: {
    summary: string,
    candidates: { type: "array", maxItems: ASSISTANT_CANDIDATE_MAX, items: { type: "object", additionalProperties: false,
      required: ["action", "eventId", "event", "reason", "needsReview", "warnings"], properties: {
        action: { type: "string", enum: ["create", "update", "delete"] }, eventId: nullableString,
        event: { anyOf: [{ type: "object", additionalProperties: false, required: Object.keys(eventProperties), properties: eventProperties }, { type: "null" }] },
        reason: string, needsReview: { type: "boolean" }, warnings: { type: "array", maxItems: 8, items: string },
      } } },
  },
};
