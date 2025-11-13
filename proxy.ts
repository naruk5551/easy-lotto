// proxy.ts (วางที่รากโปรเจกต์)
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Proxy (แทน middleware แบบใหม่ใน Next.js 16)
 * - ป้องกันหน้า /home, /order/*, /admin/* ถ้าไม่ล็อกอิน
 * - แก้ชื่อคุกกี้ session ให้ตรงกับระบบของคุณ (เช่น 'session' หรือ 'sb-access-token')
 */
export function proxy(req: NextRequest) {
  const { pathname, origin } = req.nextUrl;

  const needAuth =
    pathname === '/home' ||
    pathname.startsWith('/order') ||
    pathname.startsWith('/admin');

  if (needAuth) {
    const hasSession =
      req.cookies.get('session') ||       // ← ปรับชื่อให้ตรงระบบ
      req.cookies.get('sb-access-token'); // ← ตัวอย่างสำหรับ Supabase

    if (!hasSession) {
      const url = new URL('/login', origin);
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

// เผื่อบางสภาพแวดล้อมยังอ้าง default export
export default proxy;

export const config = {
  matcher: ['/home', '/order/:path*', '/admin/:path*'],
};
