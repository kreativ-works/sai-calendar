import { env } from "cloudflare:workers";

export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

const values = () => env as unknown as Record<string, unknown>;

export function getFirebaseConfig(): FirebaseConfig | null {
  const source = values();
  const read = (name: string) => typeof source[name] === "string" ? (source[name] as string).trim() : "";
  const apiKey = read("SAI_FIREBASE_API_KEY");
  const authDomain = read("SAI_FIREBASE_AUTH_DOMAIN");
  const projectId = read("SAI_FIREBASE_PROJECT_ID");
  const appId = read("SAI_FIREBASE_APP_ID");
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId) || !/^[a-z0-9.-]+$/i.test(authDomain)) return null;
  return { apiKey, authDomain, projectId, appId };
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

// Vite removes this development-only branch from production builds. A deployed
// Worker cannot opt into unsigned emulator tokens through runtime configuration.
export function getFirebaseEmulatorUrl(requestUrl: string): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const request = new URL(requestUrl);
    if (!isLoopbackHost(request.hostname)) return null;
    const configured = values().SAI_FIREBASE_AUTH_EMULATOR_URL;
    if (typeof configured !== "string" || !configured) return null;
    const emulator = new URL(configured);
    if (emulator.protocol !== "http:" || !isLoopbackHost(emulator.hostname) || emulator.username || emulator.password || emulator.search || emulator.hash || emulator.pathname !== "/") return null;
    return emulator.origin;
  } catch { return null; }
}

declare global {
  interface ImportMetaEnv { readonly DEV: boolean }
  interface ImportMeta { readonly env: ImportMetaEnv }
}
