import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./mobile-refinements.css";
import "./mobile-first.css";
import "./landing.css";
import "./auth.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://sai-our-calendar.seonguk.chatgpt.site"),
  title: "사이 — 우리의 시간을 함께",
  description: "각자의 하루부터 함께할 약속까지. 두 사람의 시간을 다정하게 잇는 공유 캘린더.",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "사이",
    title: "각자의 하루가, 우리의 시간이 되는 곳 · 사이",
    description: "일상, 데이트, 기념일까지. 두 사람의 약속을 한곳에서 나누는 공유 캘린더.",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "사이", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8f8f6",
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
