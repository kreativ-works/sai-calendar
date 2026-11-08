import { CalendarError } from "../domain/calendar.ts";
import { disabledAssistantConfig, parseAssistantModel, type AssistantConfig, type AssistantProvider } from "../domain/assistant.ts";

const encode = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function validEncryptionKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try { return encode(decode(value)) === value && decode(value).length === 32; } catch { return false; }
}
async function key(value: unknown): Promise<CryptoKey> {
  if (!validEncryptionKey(value)) throw new CalendarError(503, "AI_ENCRYPTION_UNAVAILABLE", "AI 연결을 안전하게 저장할 서버 설정이 준비되지 않았어요. 운영자에게 문의해 주세요.");
  return crypto.subtle.importKey("raw", decode(value), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptSecret(value: string, encryptionKey: unknown, context = "sai-ai-settings:v1"): Promise<string> {
  const imported = await key(encryptionKey), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) }, imported, new TextEncoder().encode(value));
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function decryptSecret(ciphertext: string, encryptionKey: unknown, context = "sai-ai-settings:v1"): Promise<string> {
  const imported = await key(encryptionKey);
  try {
    const parts = ciphertext.split(".");
    if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]{16}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{22,44000}$/.test(parts[2])) throw new Error();
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(parts[1]), additionalData: new TextEncoder().encode(context) }, imported, decode(parts[2]));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { throw new CalendarError(503, "AI_CONFIGURATION_INVALID", "저장된 AI 연결을 확인하지 못했어요. 운영자가 API 키를 다시 연결해 주세요."); }
}
type SettingsRow = { provider: AssistantProvider; model: string; ciphertext: string };
export type PrivateAssistantSettings = { provider: AssistantProvider; model: string; apiKey: string };
export async function readPrivateAssistantSettings(db: D1Database, encryptionKey: unknown): Promise<PrivateAssistantSettings | null> {
  if (!validEncryptionKey(encryptionKey)) return null;
  const row = await db.prepare("SELECT provider,model,ciphertext FROM ai_settings WHERE id = 1").first<SettingsRow>();
  if (!row) return null;
  if (row.provider !== "gemini" && row.provider !== "openai") throw new CalendarError(503, "AI_CONFIGURATION_INVALID", "AI 제공자 설정을 다시 연결해 주세요.");
  const model = parseAssistantModel(row.provider, row.model);
  const apiKey = await decryptSecret(row.ciphertext, encryptionKey);
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(apiKey)) throw new CalendarError(503, "AI_CONFIGURATION_INVALID", "저장된 AI 연결을 확인하지 못했어요. 운영자가 API 키를 다시 연결해 주세요.");
  return { provider: row.provider, model, apiKey };
}
export async function publicAssistantConfig(db: D1Database, encryptionKey: unknown): Promise<AssistantConfig> {
  try {
    const config = await readPrivateAssistantSettings(db, encryptionKey);
    return config ? { configured: true, provider: config.provider, model: config.model } : disabledAssistantConfig();
  } catch { return disabledAssistantConfig(); }
}
export async function saveAssistantSettings(db: D1Database, encryptionKey: unknown, settings: PrivateAssistantSettings, actorId: string, now = new Date()): Promise<AssistantConfig> {
  const ciphertext = await encryptSecret(settings.apiKey, encryptionKey);
  await db.prepare("INSERT INTO ai_settings (id,provider,model,ciphertext,updated_by,updated_at) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model,ciphertext=excluded.ciphertext,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
    .bind(settings.provider, settings.model, ciphertext, actorId, now.toISOString()).run();
  return { configured: true, provider: settings.provider, model: settings.model };
}
