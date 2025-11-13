import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken, setSessionCookie } from '@/lib/auth';

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'missing' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });

  // เวอร์ชันทดสอบ: เทียบรหัสแบบ plain (จะย้ายเป็น bcrypt ภายหลัง)
  if (!user || user.password !== password) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 401 });
  }

  if (!user.approved) {
    return NextResponse.json({ ok: false, error: 'not_approved' }, { status: 403 });
  }

  const token = await createToken({
    uid: user.id,
    username: user.username,
    role: user.role as 'USER' | 'ADMIN',
    approved: user.approved,
  });

  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, token);
  return res;
}
