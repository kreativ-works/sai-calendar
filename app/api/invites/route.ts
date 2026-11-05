import { api, createInvite, revokeInvites } from "../../../lib/server/calendar-service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return api(() => createInvite(request), request); }
export async function DELETE(request: Request) { return api(() => revokeInvites(request), request); }
