/* eslint-disable @next/next/no-html-link-for-pages -- Admin entry uses a full document navigation. */
import BacklogClient from "@/components/feedback/backlog-client";
import SessionBridge from "@/components/auth/session-bridge";
import SessionRecovery from "@/components/auth/session-recovery";
import { getAppUser } from "@/lib/server/app-auth";
import { isFeedbackAdmin } from "@/lib/server/feedback-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "피드백 백로그 · 사이", robots: { index: false, follow: false } };

export default async function BacklogPage() {
  const user = await getAppUser().catch(() => null);
  if (!user) return <SessionRecovery returnTo="/backlog" anonymousHref="/login?returnTo=%2Fbacklog" />;
  if (!isFeedbackAdmin(user)) return <main className="session-recovery"><header className="session-recovery__header"><a className="session-recovery__brand" href="/app" aria-label="내 캘린더">sai<span>.</span></a></header><div className="session-recovery__stage"><section className="session-recovery__card"><p className="session-recovery__eyebrow">SAI FEEDBACK</p><h1>운영자 전용 공간이에요</h1><p className="session-recovery__copy">피드백 백로그는 등록된 운영자 계정으로 확인할 수 있어요.</p><div className="session-recovery__actions"><a className="session-recovery__button is-primary" href="/app">내 캘린더로</a><a className="session-recovery__button is-secondary" href="/logout">로그아웃하고 계정 바꾸기</a></div></section></div></main>;
  return <><SessionBridge userId={user.userId} /><BacklogClient /></>;
}
