import AdminShell from "@/components/admin/admin-shell";
import AiSettingsClient from "@/components/admin/ai-settings-client";
import SessionBridge from "@/components/auth/session-bridge";
import SessionRecovery from "@/components/auth/session-recovery";
import { getAppAccess } from "@/lib/server/app-auth";
import { isFeedbackAdmin } from "@/lib/server/feedback-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI 연결 설정 · 사이 어드민", robots: { index: false, follow: false } };
export default async function AiSettingsPage() {
  const access = await getAppAccess().catch(() => null);
  if (!access) return <SessionRecovery returnTo="/admin/ai" anonymousHref="/login?returnTo=%2Fadmin%2Fai" />;
  if (!isFeedbackAdmin(access.user)) return <main className="session-recovery"><div className="session-recovery__stage"><section className="session-recovery__card"><h1>운영자 전용 공간이에요</h1><p className="session-recovery__copy">AI 연결은 등록된 운영자가 설정할 수 있어요.</p><div className="session-recovery__actions"><a className="session-recovery__button is-primary" href="/app">캘린더로</a><a className="session-recovery__button is-secondary" href="/logout">계정 바꾸기</a></div></section></div></main>;
  return <><SessionBridge userId={access.user.userId} bootstrap={access.bootstrap} /><AdminShell name={access.user.displayName} email={access.user.email} section="ai"><AiSettingsClient /></AdminShell></>;
}
