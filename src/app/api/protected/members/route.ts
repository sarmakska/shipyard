import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { MembersService } from "@/lib/members";
import { withGuard, errorResponse } from "@/lib/http";
import type { Role } from "@/db/schema";

export async function GET(req: NextRequest) {
  return withGuard(
    { permission: "members:read" },
    (ctx) => {
      const members = new MembersService(db()).list(ctx);
      return NextResponse.json({ members });
    },
    req,
  );
}

export async function POST(req: NextRequest) {
  return withGuard(
    { permission: "members:invite" },
    async (ctx, request) => {
      try {
        const body = (await request.json()) as { email?: string; role?: Role };
        if (!body.email || !body.role) {
          return NextResponse.json(
            { error: "email and role are required" },
            { status: 400 },
          );
        }
        const membership = new MembersService(db()).invite(
          ctx,
          body.email,
          body.role,
        );
        return NextResponse.json({ membership });
      } catch (error) {
        return errorResponse(error);
      }
    },
    req,
  );
}
