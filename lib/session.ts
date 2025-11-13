// lib/session.ts
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'sid';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 วัน

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET in env');
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: number;
  username: string;
  role: 'USER' | 'ADMIN';
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.user as SessionUser;
  } catch {
    return null;
  }
}

export async function setSession(user: SessionUser) {
  const token = await new SignJWT({ user })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
