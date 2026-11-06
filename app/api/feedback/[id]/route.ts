import { authApi } from "../../../../lib/server/app-auth";
import { readFeedbackItem, updateFeedback } from "../../../../lib/server/feedback-service";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return authApi(request, async () => readFeedbackItem((await context.params).id)); }
export async function PATCH(request: Request, context: Context) { return authApi(request, async () => updateFeedback(request, (await context.params).id)); }
