import { authApi } from "../../../../lib/server/app-auth";
import { readAssistantConfig } from "../../../../lib/server/assistant-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return authApi(request, readAssistantConfig); }
