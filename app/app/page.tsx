import CalendarApp from "@/components/calendar/calendar-app";
import SessionBridge from "@/components/auth/session-bridge";
import SessionRecovery from "@/components/auth/session-recovery";
import { getAppAccess } from "@/lib/server/app-auth";
import { isFeedbackAdmin } from "@/lib/server/feedback-service";
import { validDate } from "@/lib/domain/calendar";
import { readStateForUser } from "@/lib/server/calendar-service";
import { initialCalendarRange } from "@/lib/client/calendar-bootstrap";
import { todayInSeoul } from "@/lib/client/calendar-view";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
type SearchParams = Record<string, string | string[] | undefined>;
type Setup = "create" | "join" | null;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const initialDemo = params.demo === "1";
  const initialJoinCode = typeof params.join === "string" ? params.join.trim() : "";
  const initialSetup: Setup = initialJoinCode || params.setup === "join" ? "join" : params.setup === "1" ? "create" : null;
  const preserved = new URLSearchParams();
  if (params.setup === "1" || params.setup === "join") preserved.set("setup", params.setup);
  if (initialJoinCode) preserved.set("join", initialJoinCode);
  if (typeof params.notification === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(params.notification)) preserved.set("notification", params.notification);
  if (typeof params.event === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(params.event)) preserved.set("event", params.event);
  if (typeof params.date === "string" && validDate(params.date)) preserved.set("date", params.date);
  const returnTo = `/app${preserved.size ? `?${preserved.toString()}` : ""}`;
  // Preserve invitations, onboarding and safe notification destinations through sign-in.
  return <CalendarAccess initialDemo={initialDemo} initialSetup={initialSetup} initialJoinCode={initialJoinCode} returnTo={returnTo} />;
}

async function CalendarAccess({ initialDemo, initialSetup, initialJoinCode, returnTo }: { initialDemo: boolean; initialSetup: Setup; initialJoinCode: string; returnTo: string }) {
  const today = todayInSeoul();
  // The example calendar must not inspect a real account or fetch private state.
  if (initialDemo) return <CalendarApp initialDemo initialToday={today} initialSetup={initialSetup} initialJoinCode={initialJoinCode} />;
  const access = await getAppAccess().catch(() => null);
  if (!access) return <SessionRecovery returnTo={returnTo} anonymousHref={`/login?returnTo=${encodeURIComponent(returnTo)}`} />;
  const { user, bootstrap } = access;
  const range = initialCalendarRange(today);
  // Reuse the identity verified above. A storage failure retains the existing
  // client loading/retry flow instead of turning it into a false sign-out.
  const state = await readStateForUser(user, range.from, range.to).catch(() => null);
  return <><SessionBridge userId={user.userId} bootstrap={bootstrap} /><CalendarApp initialToday={today} initialCalendar={state ? { today, ...range, state } : undefined} initialSetup={initialSetup} initialJoinCode={initialJoinCode} signedIn feedbackAdmin={isFeedbackAdmin(user)} /></>;
}
