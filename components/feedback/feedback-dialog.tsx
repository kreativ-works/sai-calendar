"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, Bug, Check, Heart, Lightbulb, LoaderCircle, MessageCircle, Send, ShieldCheck } from "lucide-react";
import Dialog from "@/components/calendar/dialog";
import { api } from "@/lib/client/api";
import { FEEDBACK_CATEGORY_LABELS, FEEDBACK_MESSAGE_MIN, FEEDBACK_TEXT_MAX, type FeedbackCategory } from "@/lib/domain/feedback";

type Props = { demo: boolean; reporterEmail?: string | null; onClose: () => void };
const categories = ["bug", "idea", "other"] as const;
const categoryIcons = { bug: Bug, idea: Lightbulb, other: MessageCircle };

export default function FeedbackDialog({ demo, reporterEmail, onClose }: Props) {
  const fieldId = useId();
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const sending = useRef(false);
  const attempt = useRef<{ id: string; payload: string } | null>(null);
  const length = message.trim().length;

  function close() {
    if (sending.current) return;
    if (!receipt && message.trim()) setDiscard(true);
    else onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    if (length < FEEDBACK_MESSAGE_MIN) { setError("상황을 알 수 있도록 10자 이상 적어주세요."); return; }
    const input = { category, message: message.trim(), page: "/app" };
    const payload = JSON.stringify(input);
    // Lost-response retries retain their receipt; an edited draft is a new request.
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { id: crypto.randomUUID(), payload };
    const id = attempt.current.id;
    sending.current = true; setBusy(true); setError("");
    try {
      if (demo) setReceipt(id);
      else {
        const result = await api<{ ok: true; id: string; createdAt: string }>("/api/feedback", { method: "POST", body: JSON.stringify({ id, ...input }) });
        setReceipt(result.id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "의견을 보내지 못했어요. 내용을 그대로 두었으니 다시 시도해주세요."); }
    finally { sending.current = false; setBusy(false); }
  }

  return <Dialog title={receipt ? "의견을 잘 받았어요" : "의견 보내기"} eyebrow="A BETTER SAI, TOGETHER" onClose={close} className="feedback-dialog">
    {discard ? <div className="feedback-discard"><div className="feedback-round-icon"><MessageCircle size={25} /></div><h3>작성 중인 의견을 닫을까요?</h3><p>아직 보내지 않은 내용은 저장되지 않아요.</p><div className="feedback-action-row"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscard(false)}>계속 작성하기</button><button type="button" className="primary-button" onClick={onClose}>닫기</button></div></div> : receipt ? <>
      <div className="feedback-success feedback-scroll-body"><div className="feedback-success-symbol"><Check size={29} strokeWidth={1.7} /><Heart size={15} /></div><p className="feedback-success-kicker">{demo ? "예시 체험 완료" : "소중한 의견, 고마워요"}</p><h3>{demo ? "이렇게 의견을 보낼 수 있어요" : "더 좋은 사이를 만드는 데 참고할게요"}</h3><p>{demo ? "예시 모드라 실제로 전달되지는 않았어요. 내 캘린더에서는 운영자가 확인할 수 있도록 의견이 저장돼요." : "보내주신 내용은 사이의 개선 목록에 남겨두었어요. 운영자가 하나씩 확인할게요."}</p><div className="feedback-receipt"><span>{demo ? "예시 접수 번호" : "접수 번호"}</span><strong>#{receipt.slice(0, 8).toUpperCase()}</strong></div></div>
      <div className="feedback-footer"><button type="button" className="primary-button" autoFocus onClick={onClose}>캘린더로 돌아가기<ArrowRight size={16} /></button></div>
    </> : <form className="feedback-form" onSubmit={submit}>
      <div className="feedback-scroll-body"><p className="feedback-intro">불편했던 순간도, 떠오른 아이디어도.<br />사이를 함께 다듬어주세요.</p>
        {demo ? <p className="feedback-demo-note">예시 체험이에요. 작성한 의견은 실제로 전송되지 않아요.</p> : null}
        <fieldset className="feedback-inputs" disabled={busy}><legend className="sr-only">보내실 의견</legend><div className="feedback-kind-label" id={`${fieldId}-kind`}>어떤 이야기인가요?</div><div className="feedback-kind-options" role="group" aria-labelledby={`${fieldId}-kind`}>{categories.map(value => { const Icon = categoryIcons[value]; return <button type="button" key={value} aria-pressed={category === value} className={category === value ? "active" : ""} onClick={() => { setCategory(value); setError(""); }}><Icon size={17} />{FEEDBACK_CATEGORY_LABELS[value]}</button>; })}</div>
          <label className="feedback-message-label" htmlFor={`${fieldId}-message`}>조금 더 들려주세요</label><textarea id={`${fieldId}-message`} autoFocus required minLength={FEEDBACK_MESSAGE_MIN} maxLength={FEEDBACK_TEXT_MAX} rows={6} placeholder={category === "bug" ? "어떤 화면에서 무슨 일이 있었나요? 기대했던 동작도 함께 알려주세요." : category === "idea" ? "사이에 이런 기능이 있으면 좋겠어요. 어떤 순간에 도움이 될지도 알려주세요." : "사이를 사용하며 느낀 점을 편하게 적어주세요."} value={message} onChange={event => { setMessage(event.target.value); setError(""); }} aria-describedby={`${fieldId}-hint ${fieldId}-privacy`} /><div className="feedback-message-meta" id={`${fieldId}-hint`}>10자 이상 적어주세요<span>{message.length.toLocaleString("ko-KR")} / 2,000</span></div>
        </fieldset>
        <div className="feedback-privacy" id={`${fieldId}-privacy`}><ShieldCheck size={17} /><p>{demo ? "실제로 보낼 때는 계정의 이름·이메일과 작성한 내용이 운영자에게 전달돼요." : <>계정의 이름·이메일{reporterEmail ? ` (${reporterEmail})` : ""}과 작성한 내용이 운영자에게 전달돼요.</>} 일정이나 화면은 자동으로 첨부되지 않아요.</p></div>
        {error ? <p className="feedback-message error" role="alert"><AlertCircle size={17} />{error}</p> : null}
      </div>
      <footer className="feedback-footer"><button className="primary-button" disabled={busy || length < FEEDBACK_MESSAGE_MIN} type="submit">{busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}{busy ? "보내는 중…" : demo ? "의견 보내기 체험" : "의견 보내기"}</button></footer>
    </form>}
  </Dialog>;
}
