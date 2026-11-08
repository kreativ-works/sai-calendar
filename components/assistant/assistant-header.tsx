import { ArrowLeft, Smartphone, Sparkles } from "lucide-react";

export default function AssistantHeader() {
  return <header className="assistant-header"><div className="assistant-header-inner"><a className="assistant-brand" href="/assistant"><Sparkles size={20} aria-hidden="true" /><span>사이 일정 도우미</span></a><nav className="assistant-header-actions" aria-label="일정 도우미 메뉴"><a href="/assistant/connect"><Smartphone size={17} aria-hidden="true" />기기 연동</a><a href="/app"><ArrowLeft size={17} aria-hidden="true" />캘린더</a></nav></div></header>;
}
