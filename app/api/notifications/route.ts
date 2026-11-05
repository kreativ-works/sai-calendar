import { api } from "../../../lib/server/calendar-service";
import { markNotificationsRead, readNotifications } from "../../../lib/server/notification-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return api(readNotifications, request); }
export async function PATCH(request: Request) { return api(() => markNotificationsRead(request), request); }
