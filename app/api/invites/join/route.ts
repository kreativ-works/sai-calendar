import { api, joinInvite } from "../../../../lib/server/calendar-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return api(() => joinInvite(request), request); }
