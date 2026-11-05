import { api } from "../../../../lib/server/calendar-service";
import { deletePushSubscription, registerPushSubscription } from "../../../../lib/server/notification-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return api(() => registerPushSubscription(request), request); }
export async function DELETE(request: Request) { return api(() => deletePushSubscription(request), request); }
