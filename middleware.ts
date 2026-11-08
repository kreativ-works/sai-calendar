import { NextResponse } from "next/server";

export function middleware() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}
export const config = { matcher: ["/app", "/assistant/:path*", "/admin/:path*", "/backlog", "/api/:path*"] };
