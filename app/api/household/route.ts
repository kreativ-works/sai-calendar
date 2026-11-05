import { api, createHousehold, updateHousehold } from "../../../lib/server/calendar-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return api(() => createHousehold(request), request); }
export async function PATCH(request: Request) { return api(() => updateHousehold(request), request); }
