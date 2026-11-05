import AuthScreen from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "로그인 · 사이", robots: { index: false, follow: false } };
type Params = Record<string, string | string[] | undefined>;

export default async function Login({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  return <AuthScreen mode="login" returnTo={typeof params.returnTo === "string" ? params.returnTo : "/app"} />;
}
