import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-secret');
const COOKIE_NAME = 'session';

export type Role = 'USER' | 'ADMIN';
export type Session = {
  uid: number;
  username: string;
  role: Role;
  approved: boolean;
  exp: number;
};

export async function createToken(
  payload: Omit<Session, 'exp'>,
  ttlSec = 60 * 60 * 6
) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(exp)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const c = await cookies();                 // ✅ ถูกต้อง: ต้องเรียกเป็นฟังก์ชัน
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return await verifyToken(token);
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24,
  });
}

export function clearSessionCookie(res: NextResponse) {
  // ล้างโดยเซ็ตหมดอายุทันที
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    path: '/',
    maxAge: 0,
  });
}
