import { env } from "cloudflare:workers";
import { CalendarError } from "../domain/calendar";
import { isAllowedFeedbackAdmin, parseFeedback, parseFeedbackId, parseFeedbackQuery, parseFeedbackUpdate } from "../domain/feedback";
import { authBody, authJson, getAppUser, type AppUser } from "./app-auth";
import { changeFeedback, getFeedbackItem, listFeedback, storeFeedback } from "./feedback-db";

export function isFeedbackAdmin(user: { email: string } | null): boolean {
  return isAllowedFeedbackAdmin(user, (env as unknown as Record<string, unknown>).SAI_FEEDBACK_ADMIN_EMAILS);
}
async function context(admin = false): Promise<{ user: AppUser; db: D1Database }> {
  const user = await getAppUser();
  if (!user) throw new CalendarError(401, "SIGN_IN_REQUIRED", "로그인 후 의견을 보내 주세요.");
  if (admin && !isFeedbackAdmin(user)) throw new CalendarError(403, "FEEDBACK_ADMIN_REQUIRED", "백로그를 확인할 권한이 없어요.");
  if (!env.DB) throw new CalendarError(503, "DATABASE_UNAVAILABLE", "의견 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return { user, db: env.DB };
}
export async function submitFeedback(request: Request): Promise<Response> {
  const { user, db } = await context();
  const result = await storeFeedback(db, user, parseFeedback(await authBody(request)));
  return authJson(result.receipt, result.created ? 201 : 200);
}
export async function readFeedback(request: Request): Promise<Response> {
  const { db } = await context(true);
  return authJson(await listFeedback(db, parseFeedbackQuery(new URL(request.url).searchParams)));
}
export async function readFeedbackItem(id: string): Promise<Response> {
  const { db } = await context(true);
  return authJson({ item: await getFeedbackItem(db, parseFeedbackId(id)) });
}
export async function updateFeedback(request: Request, id: string): Promise<Response> {
  const { db } = await context(true);
  return authJson({ ok: true, item: await changeFeedback(db, parseFeedbackId(id), parseFeedbackUpdate(await authBody(request))) });
}
