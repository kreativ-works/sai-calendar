import { authApi } from "@/lib/server/app-auth";
import { consumeAssistantShare } from "@/lib/server/assistant-share";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return authApi(request, async () => consumeAssistantShare((await params).id)); }
