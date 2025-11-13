import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    return NextResponse.json({ error: "มีชื่อผู้ใช้นี้แล้ว" }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { username, password: hash },
  });

  return NextResponse.json({ ok: true });
}
