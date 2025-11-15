// app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // origin จาก request จริง (รองรับทุก env)
  const url = new URL('/', req.nextUrl.origin);

  // ใช้ 302 ให้ browser เปลี่ยนเป็น GET เมื่อ redirect ไปหน้า /
  const res = NextResponse.redirect(url, 302);

  // เคลียร์ session cookie ตามเดิม
  clearSessionCookie(res);

  // กัน cache หน้านี้ไว้หน่อย
  res.headers.set('Cache-Control', 'no-store');

  return res;
}
