import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { SESSION_COOKIE, AuthError } from "./auth";
import { resolveContext, TenantResolutionError } from "./context";
import { ForbiddenError, type Permission } from "./rbac";
import { UsageLimitError } from "./billing/service";
import { RateLimiter, RATE_LIMITS, type RateLimitConfig } from "./rate-limit";
import type { RequestContext } from "./context";

/**
 * Route plumbing shared by every protected API handler.
 *
 * `withGuard` resolves the request context, applies a token-bucket rate limit
 * keyed by tenant and route, asserts the required permissions, and translates
 * the library error types into the correct HTTP status. A handler therefore
 * deals only with business logic and trusts that, by the time it runs, the
 * caller is authenticated, scoped to a tenant, within budget, and authorised.
 */

// Limiters are module-scoped so their buckets persist across requests within an
// instance. For multi-instance deployments swap the store for Redis.
const limiters = new Map<string, RateLimiter>();
function limiterFor(group: string, config: RateLimitConfig): RateLimiter {
  let limiter = limiters.get(group);
  if (!limiter) {
    limiter = new RateLimiter(config);
    limiters.set(group, limiter);
  }
  return limiter;
}

export interface GuardOptions {
  permission: Permission;
  rateLimitGroup?: keyof typeof RATE_LIMITS;
}

export async function withGuard(
  options: GuardOptions,
  handler: (ctx: RequestContext, req: NextRequest) => Promise<NextResponse> | NextResponse,
  req: NextRequest,
): Promise<NextResponse> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    const ctx = resolveContext(db(), token);

    const group = options.rateLimitGroup ?? "api";
    const limiter = limiterFor(group, RATE_LIMITS[group]);
    const result = limiter.consume(`${ctx.organisationId}:${group}`);
    if (!result.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
            "X-RateLimit-Remaining": String(result.remaining),
          },
        },
      );
    }

    return await handler(ctx, req);
  } catch (error) {
    return errorResponse(error);
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof TenantResolutionError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof UsageLimitError) {
    return NextResponse.json({ error: error.message }, { status: 402 });
  }
  const message = error instanceof Error ? error.message : "internal error";
  return NextResponse.json({ error: message }, { status: 400 });
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}
