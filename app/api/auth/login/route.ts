// app/api/login/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createToken, setSessionCookie } from '@/lib/auth';

export async function POST(req: Request) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'missing' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  // demo: เปรียบเทียบแบบ plain ก่อน
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

  // ตอบกลับ uid ด้วย เพื่อให้ฝั่ง client เคลียร์/ตั้งค่าใหม่ได้แน่ๆ
  const res = NextResponse.json({ ok: true, uid: user.id });

  // เซ็ต session cookie ตามเดิม
  setSessionCookie(res, token);

  // เสริม: ยิง cookie x-user-id แบบ short-lived (ไม่ HttpOnly)
  // เพื่อให้ client อ่านได้และ sync ทันที (ฝั่ง server ใช้ session เป็นหลักอยู่แล้ว)
  res.headers.append(
    'Set-Cookie',
    `x-user-id=${user.id}; Path=/; Max-Age=86400; SameSite=Lax`
  );

  return res;
}
