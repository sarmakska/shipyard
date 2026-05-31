import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { AuthService } from "@/lib/auth";
import { errorResponse, setSessionCookie } from "@/lib/http";
import { RateLimiter, RATE_LIMITS } from "@/lib/rate-limit";

const authLimiter = new RateLimiter(RATE_LIMITS.auth);

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? "local";
    if (!authLimiter.consume(`login:${ip}`).allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    const body = (await req.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 },
      );
    }
    const result = new AuthService(db()).login(body.email, body.password);
    const response = NextResponse.json({
      userId: result.user.id,
      organisationId: result.organisationId,
    });
    setSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
