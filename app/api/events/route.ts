import { api, createEvent } from "../../../lib/server/calendar-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return api(() => createEvent(request), request); }
