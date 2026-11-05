import CalendarApp from "@/components/calendar/calendar-app";
import { getChatGPTUser, requireChatGPTUser } from "../chatgpt-auth";

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
  const returnTo = `/app${preserved.size ? `?${preserved.toString()}` : ""}`;
  // Authentication runs in a nested component after the complete return path is
  // computed, preserving a partner's invite through dispatch-owned sign-in.
  return <CalendarAccess initialDemo={initialDemo} initialSetup={initialSetup} initialJoinCode={initialJoinCode} returnTo={returnTo} />;
}

async function CalendarAccess({ initialDemo, initialSetup, initialJoinCode, returnTo }: { initialDemo: boolean; initialSetup: Setup; initialJoinCode: string; returnTo: string }) {
  const user = initialDemo ? await getChatGPTUser() : await requireChatGPTUser(returnTo);
  return <CalendarApp initialDemo={initialDemo} initialSetup={initialSetup} initialJoinCode={initialJoinCode} signedIn={!!user} />;
}
