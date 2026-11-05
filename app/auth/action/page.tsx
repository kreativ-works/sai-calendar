import AuthScreen from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "계정 확인 · 사이", robots: { index: false, follow: false } };
type Params = Record<string, string | string[] | undefined>;

export default async function AuthAction({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  // Firebase email links may include a continueUrl containing the original
  // invitation. The client normalizes it before any navigation takes place.
  let returnTo = typeof params.returnTo === "string" ? params.returnTo : "/app";
  if (typeof params.continueUrl === "string") {
    try {
      const url = new URL(params.continueUrl);
      if (["/login", "/auth/action"].includes(url.pathname)) returnTo = url.searchParams.get("returnTo") || "/app";
    } catch { /* Invalid continuation links use the safe default. */ }
  }
  return <AuthScreen mode="action" returnTo={returnTo} actionCode={typeof params.oobCode === "string" ? params.oobCode : undefined} actionMode={typeof params.mode === "string" ? params.mode : undefined} />;
}
