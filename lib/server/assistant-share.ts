import { env } from "cloudflare:workers";
import { getAppUser, authJson } from "./app-auth";
import { CalendarError } from "../domain/calendar";
import { parseAssistantInput } from "../domain/assistant";
import { decryptSecret, encryptSecret } from "./assistant-settings";

const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
const runtimeKey = () => (env as unknown as Record<string, unknown>).SAI_AI_ENCRYPTION_KEY;
function destination(request: Request, query: string): Response {
  return new Response(null, { status: 303, headers: { ...privateHeaders, Location: new URL(`/assistant?${query}`, request.url).href } });
}

export async function receiveAssistantShare(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)(;|$)/i.test(contentType) || contentType.length > 250) return destination(request, "shareError=invalid");
  if (Number(request.headers.get("content-length")) > 64_000) return destination(request, "shareError=large");
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && origin !== new URL(request.url).origin) return destination(request, "shareError=invalid");
  try {
    if (!request.body) return destination(request, "shareError=invalid");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.byteLength;
        if (length > 64_000) { await reader.cancel(); return destination(request, "shareError=large"); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
    const parts = ["title", "text", "url"].map(key => { const value = form.get(key); if (value !== null && typeof value !== "string") throw new Error(); return value || ""; });
    const input = parseAssistantInput({ text: [...new Set(parts.filter(Boolean))].join("\n"), source: "share" });
    const user = await getAppUser();
    if (!user) return destination(request, "shareError=signin");
    if (!env.DB) return destination(request, "shareError=unavailable");
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const ciphertext = await encryptSecret(input.text, runtimeKey(), `assistant-handoff:${user.userId}:${id}`);
    await env.DB.prepare("DELETE FROM assistant_handoffs WHERE expires_at <= ?").bind(now).run();
    const result = await env.DB.prepare("INSERT INTO assistant_handoffs (id,user_id,ciphertext,expires_at,created_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM assistant_handoffs WHERE user_id=? AND expires_at>?) < 8")
      .bind(id, user.userId, ciphertext, expiresAt, now, user.userId, now).run();
    if (!result.meta.changes) return destination(request, "shareError=limit");
    return destination(request, `share=${id}`);
  } catch { return destination(request, "shareError=unavailable"); }
}

export async function consumeAssistantShare(id: string): Promise<Response> {
  const user = await getAppUser();
  if (!user) throw new CalendarError(401, "SIGN_IN_REQUIRED", "로그인 후 공유한 내용을 확인해 주세요.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) || !env.DB) throw new CalendarError(404, "SHARE_EXPIRED", "공유 내용이 만료됐거나 이미 열었어요. 다시 공유해 주세요.");
  const row = await env.DB.prepare("DELETE FROM assistant_handoffs WHERE id=? AND user_id=? AND expires_at>? RETURNING ciphertext")
    .bind(id, user.userId, new Date().toISOString()).first<{ ciphertext: string }>();
  if (!row) throw new CalendarError(404, "SHARE_EXPIRED", "공유 내용이 만료됐거나 이미 열었어요. 다시 공유해 주세요.");
  const text = await decryptSecret(row.ciphertext, runtimeKey(), `assistant-handoff:${user.userId}:${id}`);
  return authJson({ text });
}
