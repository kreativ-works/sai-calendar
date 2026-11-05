import { api, updateEvent, deleteEvent } from "../../../../lib/server/calendar-service";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: RouteContext) {
  return api(async () => updateEvent(request, (await context.params).id), request);
}
export async function DELETE(request: Request, context: RouteContext) {
  return api(async () => deleteEvent(request, (await context.params).id), request);
}
