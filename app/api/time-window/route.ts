// app/api/time-window/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** แปลง input (string) เป็น Date (UTC) อย่างปลอดภัย */
function toUTC(v?: unknown): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // ถ้ามี timezone หรือ Z อยู่แล้ว -> ให้ Date แปลงตรง ๆ
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // รูปแบบ 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DDTHH:mm' -> ตีความเป็นเวลา UTC
  const m = s.replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}Z`);
    return isNaN(d.getTime()) ? null : d;
  }

  // เผื่อกรณีเป็น ISO ปรกติ
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// GET: ?latest=1  -> ดึงงวดล่าสุด
//      ?page=1&pageSize=20 -> รายการทั้งหมดแบบแบ่งหน้า (เรียง id DESC)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latest = searchParams.get('latest');
    if (latest === '1') {
      const row = await prisma.timeWindow.findFirst({
        orderBy: { id: 'desc' },
      });
      return NextResponse.json(row ?? null);
    }

    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') ?? 20)));

    const [items, total] = await Promise.all([
      prisma.timeWindow.findMany({
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.timeWindow.count(),
    ]);

    return NextResponse.json({ page, pageSize, total, items });
  } catch (e: any) {
    console.error('GET /api/time-window error', e);
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}

// POST: { startAt: string|ISO, endAt: string|ISO, note?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const startAt = toUTC(body?.startAt);
    const endAt = toUTC(body?.endAt);
    const note = (body?.note ?? '').toString().trim() || null;

    if (!startAt || !endAt) {
      return NextResponse.json({ error: 'ต้องระบุ startAt / endAt' }, { status: 400 });
    }
    if (endAt <= startAt) {
      return NextResponse.json({ error: 'endAt ต้องมากกว่า startAt' }, { status: 400 });
    }

    const created = await prisma.timeWindow.create({
      data: { startAt, endAt, note: note ?? undefined },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/time-window error', e);
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}
