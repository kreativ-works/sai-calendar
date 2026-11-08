"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, KeyRound, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import type { AssistantConfig, AssistantProvider } from "@/lib/domain/assistant";

export default function AiSettingsClient() {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [provider, setProvider] = useState<AssistantProvider>("gemini");
  const [model, setModel] = useState("gemini-flash-latest");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const alive = useRef(true), pending = useRef(false), generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    const started = generation.current;
    const changed = () => { ++generation.current; setApiKey(""); setConfig(null); setNotice(""); setRestricted(true); setConfirmDelete(false); setError("계정이 바뀌었어요. 관리자 페이지를 다시 열어주세요."); };
    window.addEventListener("sai:session-changed", changed);
    void api<AssistantConfig>("/api/admin/ai").then(value => { if (!alive.current || started !== generation.current) return; setConfig(value); if (value.provider) setProvider(value.provider); if (value.model) setModel(value.model); }).catch(cause => { if (alive.current && started === generation.current) setError(cause instanceof Error ? cause.message : "설정을 불러오지 못했어요."); });
    return () => { alive.current = false; window.removeEventListener("sai:session-changed", changed); };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending.current || !config || restricted) return;
    const started = generation.current;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/admin/ai", { method: "PUT", body: JSON.stringify({ provider, model, apiKey: apiKey.trim() }) });
      if (!alive.current || started !== generation.current) return;
      setApiKey(""); setConfig({ configured: true, provider, model });
      setNotice("설정을 안전하게 저장했어요. 실제 모델 연결은 일정 분석을 실행할 때 확인합니다.");
    } catch (cause) { if (alive.current && started === generation.current) { if (cause instanceof ApiError && [401, 403, 409].includes(cause.status)) { ++generation.current; setApiKey(""); setConfig(null); setRestricted(true); } setError(cause instanceof Error ? cause.message : "설정을 저장하지 못했어요."); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function disconnect() {
    if (pending.current || restricted) return; const started = generation.current; pending.current = true; setBusy(true); setError(""); setNotice("");
    try { await api("/api/admin/ai", { method: "DELETE", body: "{}" }); if (alive.current && started === generation.current) { setApiKey(""); setConfig({ configured: false, provider: null, model: null }); setConfirmDelete(false); setNotice("API 연결 설정을 삭제했어요."); } }
    catch (cause) { if (alive.current && started === generation.current) { if (cause instanceof ApiError && [401, 403, 409].includes(cause.status)) { ++generation.current; setApiKey(""); setConfig(null); setRestricted(true); } setError(cause instanceof Error ? cause.message : "연결을 해제하지 못했어요."); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <main className="ai-settings"><header className="ai-settings-heading"><p><Sparkles size={15} />AI CONNECTION</p><h1>일정 도우미 연결</h1><span>사용자가 확인한 일정을 캘린더로 이어주는 AI 모델을 설정해요.</span></header>
    <section className="ai-settings-status"><ShieldCheck size={23} /><div><strong>{config ? config.configured ? "API 설정이 저장되어 있어요" : "AI 서비스 연결이 필요해요" : "연결 상태를 확인하고 있어요"}</strong><p>{config?.configured ? `${config.provider === "gemini" ? "Google Gemini" : "OpenAI"} · ${config.model}` : "키를 연결하기 전에는 대화 내용을 분석하거나 가짜 결과를 만들지 않아요."}</p></div></section>
    <form className="ai-settings-form" onSubmit={save}><h2><KeyRound size={19} />모델과 API 키</h2><fieldset disabled={busy || !config}><label className="field"><span>AI 제공자</span><select value={provider} onChange={event => { const value = event.target.value as AssistantProvider; setProvider(value); setModel(value === "gemini" ? "gemini-flash-latest" : ""); setApiKey(""); }}><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option></select></label><label className="field"><span>모델 ID</span><input required maxLength={100} value={model} onChange={event => setModel(event.target.value.trim())} placeholder={provider === "gemini" ? "gemini-flash-latest" : "API에서 사용 가능한 모델 ID"} autoComplete="off" /></label><label className="field"><span>{config?.configured ? "새 API 키로 교체" : "API 키"}</span><input type="password" required minLength={16} maxLength={512} autoComplete="new-password" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="키를 여기에 입력해 주세요" /></label><p className="field-hint">API 키는 서버에서 암호화해 보관하며 다시 표시하지 않습니다. ChatGPT·Gemini 앱 구독과 API 이용 요금은 별도일 수 있습니다.</p><button className="primary-button" type="submit" disabled={busy || !apiKey.trim() || !model}>{busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}암호화하여 저장</button></fieldset>
      {error ? <p className="ai-settings-message is-error" role="alert"><AlertCircle size={17} />{error}</p> : null}{notice ? <p className="ai-settings-message" role="status"><CheckCircle2 size={17} />{notice}</p> : null}
    </form>
    <section className="ai-settings-policy"><h2>어떤 내용을 분석하나요?</h2><p>사용자가 보내기로 선택한 텍스트와 일부 캘린더 정보가 선택한 AI 제공자에게 전달됩니다. 원문은 일정 메모에 자동 저장하지 않으며, 일정 변경에는 사용자의 확인을 받습니다.</p><p>일일 분석 한도를 적용합니다. API 제공자의 요금·데이터 처리 정책과 프로젝트 사용량 제한도 함께 확인해 주세요.</p><div><a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Gemini API 키 관리 ↗</a><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI API 키 관리 ↗</a><a href="/assistant">일정 도우미 열기 ↗</a></div></section>
    {config?.configured ? <section className="ai-settings-disconnect">{confirmDelete ? <><p>API 연결을 해제할까요? 캘린더 일정은 유지됩니다.</p><div><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void disconnect()}>연결 설정 삭제</button></div></> : <button type="button" className="text-button" disabled={busy} onClick={() => setConfirmDelete(true)}>AI 연결 해제</button>}</section> : null}
  </main>;
}
