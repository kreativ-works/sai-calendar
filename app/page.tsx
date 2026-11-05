import { redirect } from "next/navigation";
import LandingPage from "@/components/landing/landing-page";
import { getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";
type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const join = typeof params.join === "string" ? params.join.trim() : "";
  if (join) redirect(`/app?join=${encodeURIComponent(join)}`);
  if (params.demo === "1") redirect("/app?demo=1");
  if (params.setup === "1" || params.setup === "join") redirect(`/app?setup=${params.setup}`);
  const user = await getChatGPTUser();
  return <LandingPage signedIn={!!user} />;
}
