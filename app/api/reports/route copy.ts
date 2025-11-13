// app/api/reports/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** อ่าน cookie แบบปลอดภัย โดยไม่อิง next/headers (กัน runtime แตก) */
function readCookieValue(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  const parts = raw.split(/;\s*/);
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i === -1) continue;
    const k = decodeURIComponent(p.slice(0, i).trim());
    if (k === name) return decodeURIComponent(p.slice(i + 1));
  }
  return null;
}

/** user ปัจจุบัน: Header(x-user-id) → Cookie(x-user-id) */
function getMeId(req: Request): number | null {
  const h = req.headers.get('x-user-id');
  if (h) {
    const n = Number(h);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const c = readCookieValue(req, 'x-user-id');
  if (c) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function parseIntQ(v: string | null, d = 0) {
  if (!v) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function parseDateQ(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** ล็อครายการถ้า createdAt อยู่ในช่วงที่เคยตัดแล้ว (อ้างอิง SettleBatch) */
async function isItemLocked(createdAt: Date): Promise<boolean> {
  const batch = await prisma.settleBatch.findFirst({
    where: { from: { lte: createdAt }, to: { gt: createdAt } },
    select: { id: true },
  });
  return !!batch;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const meId = getMeId(req);

    // meta only
    if (url.searchParams.get('meta') === 'only') {
      const [windows, latest] = await Promise.all([
        prisma.timeWindow.findMany({
          orderBy: { id: 'asc' },
          select: { id: true, startAt: true, endAt: true, note: true },
        }),
        prisma.timeWindow.findFirst({
          orderBy: { id: 'desc' },
          select: { id: true, startAt: true, endAt: true, note: true },
        }),
      ]);
      return NextResponse.json({ windows, latest, meId: meId ?? null });
    }

    // query
    const page = Math.max(1, parseIntQ(url.searchParams.get('page'), 1));
    const pageSize = Math.min(200, Math.max(1, parseIntQ(url.searchParams.get('pageSize'), 10)));
    const from = parseDateQ(url.searchParams.get('from'));
    const to = parseDateQ(url.searchParams.get('to'));
    const q = (url.searchParams.get('q') || '').trim();
    const catStr = (url.searchParams.get('cat') || '').trim();
    const ownOnly = url.searchParams.get('ownOnly') === '1';

    if (!from || !to) {
      return NextResponse.json(
        { error: 'invalid time range', items: [], total: 0, from: null, to: null },
        { status: 400 },
      );
    }

    if (ownOnly && !meId) {
      return NextResponse.json(
        { error: 'missing x-user-id', items: [], total: 0, from: null, to: null, meId: null },
        { status: 401 },
      );
    }

    const where: any = { createdAt: { gte: from, lt: to } };

    if (ownOnly && meId) {
      where.order = { userId: meId }; // กรองผ่าน relation Order
    }

    if (q) {
      where.product = { is: { number: { contains: q } } };
    }

    if (catStr) {
      where.product = {
        ...(where.product || {}),
        is: {
          ...((where.product && where.product.is) || {}),
          category: catStr as any,
        },
      };
    }

    const total = await prisma.orderItem.count({ where });

    const rows = await prisma.orderItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        price: true,
        createdAt: true,
        order: { select: { userId: true } },
        product: { select: { category: true, number: true } },
      },
    });

    // ติดธง locked ต่อแถว (ไม่เปลี่ยน logic อื่น)
    const items = await Promise.all(
      rows.map(async (r) => {
        const locked = await isItemLocked(r.createdAt);
        return {
          id: r.id,
          number: r.product.number,
          category: r.product.category,
          price: Number(r.price),
          createdAt: r.createdAt.toISOString(),
          userId: r.order?.userId ?? null,
          canEdit: !locked && (ownOnly ? true : meId != null ? r.order?.userId === meId : false),
          locked,
        };
      }),
    );

    const [windows, latest] = await Promise.all([
      prisma.timeWindow.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, startAt: true, endAt: true, note: true },
      }),
      prisma.timeWindow.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true, startAt: true, endAt: true, note: true },
      }),
    ]);

    return NextResponse.json({
      items,
      total,
      from: from.toISOString(),
      to: to.toISOString(),
      windows,
      latest,
      meId: meId ?? null,
    });
  } catch (e: any) {
    console.error('REPORTS GET ERROR:', e);
    return NextResponse.json(
      { error: typeof e?.message === 'string' ? e.message : 'Reports error' },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id || 0);
    const number = String(body?.number ?? '').trim();
    const category = String(body?.category ?? '').trim();
    const price = Number(body?.price ?? NaN);
    const ownOnly = !!body?.ownOnly;
    const meId = getMeId(req);

    if (!id || !number || !category || !Number.isFinite(price)) {
      return new NextResponse('Bad request', { status: 400 });
    }

    // ตรวจสิทธิ์เจ้าของ (ถ้าร้องขอ ownOnly)
    if (ownOnly) {
      if (!meId) return new NextResponse('Unauthorized', { status: 401 });
      const owner = await prisma.orderItem.findUnique({
        where: { id },
        select: { order: { select: { userId: true } }, createdAt: true },
      });
      if (!owner || owner.order?.userId !== meId) {
        return new NextResponse('Forbidden', { status: 403 });
      }
      // บล็อคถ้าอยู่ในช่วงที่เคยตัดแล้ว
      if (await isItemLocked(owner.createdAt)) {
        return new NextResponse('Locked item (already settled)', { status: 423 }); // 423 Locked
      }
    }

    const prod = await prisma.product.findFirst({
      where: { number, category: category as any },
      select: { id: true },
    });
    if (!prod) return new NextResponse('ไม่พบสินค้า (เลข/หมวด) ที่ระบุ', { status: 404 });

    await prisma.orderItem.update({
      where: { id },
      data: {
        productId: prod.id,
        price,
        sumAmount: price,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('REPORTS PUT ERROR:', e);
    return NextResponse.json(
      { error: typeof e?.message === 'string' ? e.message : 'Update error' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id') || 0);
    const ownOnly = url.searchParams.get('ownOnly') === '1';
    const meId = getMeId(req);

    if (!id) return new NextResponse('Bad request', { status: 400 });

    // ตรวจสิทธิ์ + ล็อค
    if (ownOnly) {
      if (!meId) return new NextResponse('Unauthorized', { status: 401 });
      const owner = await prisma.orderItem.findUnique({
        where: { id },
        select: { order: { select: { userId: true } }, createdAt: true },
      });
      if (!owner || owner.order?.userId !== meId) {
        return new NextResponse('Forbidden', { status: 403 });
      }
      if (await isItemLocked(owner.createdAt)) {
        return new NextResponse('Locked item (already settled)', { status: 423 });
      }
    }

    await prisma.orderItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('REPORTS DELETE ERROR:', e);
    return NextResponse.json(
      { error: typeof e?.message === 'string' ? e.message : 'Delete error' },
      { status: 500 },
    );
  }
}
