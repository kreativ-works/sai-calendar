import AssistantClient from "@/components/assistant/assistant-client";
import AssistantHeader from "@/components/assistant/assistant-header";
import SessionBridge from "@/components/auth/session-bridge";
import SessionRecovery from "@/components/auth/session-recovery";
import { getAppAccess } from "@/lib/server/app-auth";
import { readStateForUser } from "@/lib/server/calendar-service";
import { addDays, todayInSeoul } from "@/lib/client/calendar-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "일정 도우미 · 사이", robots: { index: false, follow: false } };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const share = typeof params.share === "string" && /^[0-9a-f-]{36}$/.test(params.share) ? params.share : "";
  const issue = typeof params.shareError === "string" && /^[a-z]{1,20}$/.test(params.shareError) ? params.shareError : "";
  const query = new URLSearchParams(); if (share) query.set("share", share); if (issue) query.set("shareError", issue);
  const returnTo = `/assistant${query.size ? `?${query}` : ""}`;
  const access = await getAppAccess().catch(() => null);
  if (!access) return <SessionRecovery returnTo={returnTo} anonymousHref={`/login?returnTo=${encodeURIComponent(returnTo)}`} preserveFragment />;
  const today = todayInSeoul();
  let state;
  try { state = await readStateForUser(access.user, addDays(today, -30), addDays(today, 90)); }
  catch { return <div className="assistant-page"><AssistantHeader /><main className="assistant-guide"><h1>캘린더에 다시 연결해 주세요</h1><p>일정을 확인한 뒤 도우미를 다시 열어주세요. 입력 내용은 전송되지 않았어요.</p><a href="/assistant">다시 시도</a> · <a href="/app">캘린더로</a></main></div>; }
  return <><SessionBridge userId={access.user.userId} bootstrap={access.bootstrap} /><div className="assistant-page"><AssistantHeader />{state.household ? <AssistantClient userId={access.user.userId} initialState={state} /> : <main className="assistant-guide"><h1>우리 캘린더부터 연결해요</h1><p>캘린더를 만들거나 짝꿍의 초대로 연결하면 일정 도우미를 사용할 수 있어요.</p><a className="primary-button" href="/app?setup=1">캘린더 시작하기</a></main>}</div></>;
}
