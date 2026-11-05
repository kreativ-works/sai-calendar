import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/server/app-auth";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Start() {
  const user = await getAppUser();
  if (!user) redirect("/signup?returnTo=%2Fapp%3Fsetup%3D1");
  redirect("/app?setup=1");
}
