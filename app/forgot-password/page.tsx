import AuthScreen from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "비밀번호 찾기 · 사이", robots: { index: false, follow: false } };
type Params = Record<string, string | string[] | undefined>;

export default async function ForgotPassword({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  return <AuthScreen mode="forgot" returnTo={typeof params.returnTo === "string" ? params.returnTo : "/app"} />;
}
