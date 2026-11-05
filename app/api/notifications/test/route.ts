import { api } from "../../../../lib/server/calendar-service";
import { testPushSubscription } from "../../../../lib/server/notification-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return api(() => testPushSubscription(request), request); }
