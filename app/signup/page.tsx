import AuthScreen from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "회원가입 · 사이", robots: { index: false, follow: false } };
type Params = Record<string, string | string[] | undefined>;

export default async function Signup({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  return <AuthScreen mode="signup" returnTo={typeof params.returnTo === "string" ? params.returnTo : "/app?setup=1"} />;
}
