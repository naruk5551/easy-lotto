import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

export async function GET() {
  const token = (await cookies()).get("session")?.value;
  if (!token) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ ok: false, message: "invalid token" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, username: true, role: true, approved: true },
  });

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  return NextResponse.json({ ok: true, user });
}
