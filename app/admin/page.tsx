import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "관리자 페이지 · 사이", robots: { index: false, follow: false } };

export default function AdminPage() { redirect("/admin/backlog"); }
