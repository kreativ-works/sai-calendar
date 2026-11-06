import CalendarApp from "@/components/calendar/calendar-app";
import SessionBridge from "@/components/auth/session-bridge";
import SessionRecovery from "@/components/auth/session-recovery";
import { getAppUser } from "@/lib/server/app-auth";
import { validDate } from "@/lib/domain/calendar";

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
  const user = await getAppUser().catch(() => null);
  if (!initialDemo && !user) return <SessionRecovery returnTo={returnTo} anonymousHref={`/login?returnTo=${encodeURIComponent(returnTo)}`} />;
  return <>{user && !initialDemo ? <SessionBridge userId={user.userId} /> : null}<CalendarApp initialDemo={initialDemo} initialSetup={initialSetup} initialJoinCode={initialJoinCode} signedIn={!!user} /></>;
}
