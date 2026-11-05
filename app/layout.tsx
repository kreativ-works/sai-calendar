import type { Metadata } from "next";
import "./globals.css";
import "./mobile-refinements.css";

export const metadata: Metadata = {
  title: "사이 — 우리의 시간을 함께",
  description: "각자의 하루부터 함께할 약속까지. 두 사람의 시간을 다정하게 잇는 공유 캘린더.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "사이", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
