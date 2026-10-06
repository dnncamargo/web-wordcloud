import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SKY_SESSION_COOKIE, verifySkySession } from "@/lib/sky/auth";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/sky/login") return NextResponse.next();

  const session = request.cookies.get(SKY_SESSION_COOKIE)?.value;

  if (verifySkySession(session)) return NextResponse.next();

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/sky/login";
  loginUrl.search = "";

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: "/sky/:path*",
};
