import { api } from "../../../../lib/server/calendar-service";
import { updateNotificationPreferences } from "../../../../lib/server/notification-service";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request) { return api(() => updateNotificationPreferences(request), request); }
