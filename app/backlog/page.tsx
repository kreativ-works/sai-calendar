import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "피드백 백로그 · 사이", robots: { index: false, follow: false } };

export default function BacklogPage() { redirect("/admin/backlog"); }
