import { receiveAssistantShare } from "@/lib/server/assistant-share";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return receiveAssistantShare(request); }
