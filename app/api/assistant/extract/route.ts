import { authApi } from "../../../../lib/server/app-auth";
import { extractAssistant } from "../../../../lib/server/assistant-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return authApi(request, () => extractAssistant(request)); }
