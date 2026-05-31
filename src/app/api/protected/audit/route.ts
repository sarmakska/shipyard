import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { listAudit } from "@/lib/audit";
import { withGuard } from "@/lib/http";

export async function GET(req: NextRequest) {
  return withGuard(
    { permission: "audit:read" },
    (ctx) => {
      const entries = listAudit(db(), ctx.organisationId);
      return NextResponse.json({ entries });
    },
    req,
  );
}
