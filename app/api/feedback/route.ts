import { authApi } from "../../../lib/server/app-auth";
import { readFeedback, submitFeedback } from "../../../lib/server/feedback-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return authApi(request, () => readFeedback(request)); }
export async function POST(request: Request) { return authApi(request, () => submitFeedback(request)); }
