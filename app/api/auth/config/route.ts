import { authJson } from "../../../../lib/server/app-auth";
import { getFirebaseConfig, getFirebaseEmulatorUrl } from "../../../../lib/server/firebase-config";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const firebase = getFirebaseConfig();
  const emulatorUrl = firebase ? getFirebaseEmulatorUrl(request.url) : null;
  return authJson({ configured: !!firebase, firebase, providers: { email: true, google: true }, ...(emulatorUrl ? { emulatorUrl } : {}) });
}
