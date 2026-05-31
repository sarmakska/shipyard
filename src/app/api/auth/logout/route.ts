import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { AuthService, SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    new AuthService(db()).logout(token);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
