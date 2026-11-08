import { api } from "./api.ts";
import { parseAssistantInput } from "../domain/assistant.ts";

export type AssistantHandoff = { text: string; source: "share" | "voice"; notice?: string };

export function assistantFragmentText(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.has("text")) return null;
  return parseAssistantInput({ text: params.get("text"), source: "voice" }).text;
}

export function createAssistantHandoffReader(dependencies: { url: () => URL; replace: (url: URL) => void; read: (id: string) => Promise<{ text: string }> }) {
let pending: { userId: string; promise: Promise<AssistantHandoff | null> } | null = null;
let generation = 0;
function clear() { ++generation; pending = null; }
function take(userId: string): Promise<AssistantHandoff | null> {
  if (pending?.userId === userId) return pending.promise;
  if (pending) clear();
  const started = generation;
  const promise = (async (): Promise<AssistantHandoff | null> => {
    const url = dependencies.url();
    let text: string | null = null;
    const hasText = new URLSearchParams(url.hash.slice(1)).has("text");
    // Remove private dictated text before any asynchronous operation or request.
    if (hasText) {
      const hash = url.hash; url.hash = "";
      dependencies.replace(url);
      text = assistantFragmentText(hash);
    }
    if (text) return { text, source: "voice" };
    const share = url.searchParams.get("share"), issue = url.searchParams.get("shareError");
    if (!share && !issue) return null;
    url.searchParams.delete("share"); url.searchParams.delete("shareError");
    dependencies.replace(url);
    if (issue) throw new Error(issue === "signin" ? "로그인한 뒤 내용을 다시 공유하거나 단축어를 다시 실행해 주세요. 공유 내용은 일정으로 등록되지 않았어요." : issue === "large" ? "공유 내용은 6,000자까지 가져올 수 있어요. 필요한 부분만 다시 공유해 주세요." : "공유 내용을 가져오지 못했어요. 필요한 부분을 다시 공유하거나 붙여넣어 주세요.");
    if (!share || !/^[0-9a-f-]{36}$/.test(share)) throw new Error("공유 링크를 확인해 주세요.");
    const result = await dependencies.read(share);
    return { text: parseAssistantInput({ text: result.text, source: "share" }).text, source: "share", notice: "공유한 내용을 가져왔어요. 확인 후 일정 찾기를 눌러 주세요." };
  })().then(result => { if (started !== generation) throw new Error("계정이 바뀌어 공유 내용을 지웠어요. 현재 계정에서 다시 공유해 주세요."); return result; });
  pending = { userId, promise };
  return promise;
}
return { take, clear };
}

const reader = createAssistantHandoffReader({
  url: () => new URL(window.location.href),
  replace: url => window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash),
  read: id => api<{ text: string }>(`/api/assistant/shared/${id}`),
});
export const takeAssistantHandoff = reader.take;
export const clearAssistantHandoff = reader.clear;
