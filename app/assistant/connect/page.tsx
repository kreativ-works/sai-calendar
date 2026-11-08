import AssistantHeader from "@/components/assistant/assistant-header";
import ConnectionGuide from "@/components/assistant/connection-guide";
export const metadata = { title: "Siri·Android 기기 연동 · 사이", robots: { index: false, follow: false } };
export default function ConnectionPage() { return <div className="assistant-page"><AssistantHeader /><ConnectionGuide /></div>; }
