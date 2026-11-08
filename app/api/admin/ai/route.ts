import { authApi } from "../../../../lib/server/app-auth";
import { deleteAdminAiConfig, readAdminAiConfig, updateAdminAiConfig } from "../../../../lib/server/assistant-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return authApi(request, readAdminAiConfig); }
export async function PUT(request: Request) { return authApi(request, () => updateAdminAiConfig(request)); }
export async function DELETE(request: Request) { return authApi(request, () => deleteAdminAiConfig(request)); }
