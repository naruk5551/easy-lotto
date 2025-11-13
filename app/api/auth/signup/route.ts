import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'missing' }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    return NextResponse.json({ ok: false, error: 'duplicated' }, { status: 409 });
  }

  await prisma.user.create({
    data: {
      username,
      password,      // TODO: ค่อยย้ายเป็น bcrypt ภายหลัง
      role: 'USER',
      approved: false,
    },
  });

  return NextResponse.json({ ok: true });
}
