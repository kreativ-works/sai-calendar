import { redirect } from "next/navigation";
import { requireChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function Start() {
  await requireChatGPTUser("/app?setup=1");
  redirect("/app?setup=1");
}
