import { authApi, linkLegacyCalendar } from "../../../../lib/server/app-auth";

export const dynamic = "force-dynamic";
export async function POST(request: Request) { return authApi(request, () => linkLegacyCalendar(request)); }
