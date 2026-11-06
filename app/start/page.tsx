import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/server/app-auth";
import SessionRecovery from "@/components/auth/session-recovery";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Start() {
  const user = await getAppUser().catch(() => null);
  if (!user) return <SessionRecovery returnTo="/app?setup=1" anonymousHref="/signup?returnTo=%2Fapp%3Fsetup%3D1" />;
  redirect("/app?setup=1");
}
