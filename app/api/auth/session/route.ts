import { authApi, createAppSession, deleteAppSession, readAppSession } from "../../../../lib/server/app-auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return authApi(request, readAppSession); }
export async function POST(request: Request) { return authApi(request, () => createAppSession(request)); }
export async function DELETE(request: Request) { return authApi(request, () => deleteAppSession(request)); }
