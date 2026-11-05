import { api, readState } from "../../../lib/server/calendar-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return api(() => readState(request), request); }
