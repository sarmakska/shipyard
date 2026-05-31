import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

/**
 * Edge middleware: the first stage of every request.
 *
 * The middleware does the cheap, request-scoped work that must happen before a
 * route runs: it reads the session cookie and forwards a stable correlation
 * header so tenant resolution downstream is consistent, and it short-circuits
 * unauthenticated access to the protected app surface. The authoritative tenant
 * and role resolution happens inside the route via resolveContext, because the
 * middleware runtime does not have a database connection. This keeps the
 * security decision on the server where the data lives, and uses the middleware
 * only as a fast gate.
 */

const PROTECTED_PREFIXES = ["/app", "/api/protected"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (isProtected && !token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  // A correlation id ties together middleware, route and audit entries.
  response.headers.set("x-shipyard-request-id", crypto.randomUUID());
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/api/protected/:path*"],
};
