// app/api/keep/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Category, CapMode } from '@prisma/client';

function parseDateUTC(v?: unknown): Date | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const m = s.replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) return new Date(`${m[1]}T${m[2]}Z`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

type CapRow = {
  mode: CapMode;
  top3: number|null; tod3: number|null; top2: number|null;
  bottom2: number|null; runTop: number|null; runBottom: number|null;
  autoThresholdTop3: any|null; autoThresholdTod3: any|null; autoThresholdTop2: any|null;
  autoThresholdBottom2: any|null; autoThresholdRunTop: any|null; autoThresholdRunBottom: any|null;
  convertTod3ToTop3: boolean;
};

function capFor(cat: Category, cap: CapRow): number {
  if (cap.mode === 'AUTO') {
    const t = (v:any)=> Number(v ?? 0);
    switch (cat) {
      case 'TOP3':       return t(cap.autoThresholdTop3);
      case 'TOD3':       return t(cap.autoThresholdTod3);
      case 'TOP2':       return t(cap.autoThresholdTop2);
      case 'BOTTOM2':    return t(cap.autoThresholdBottom2);
      case 'RUN_TOP':    return t(cap.autoThresholdRunTop);
      case 'RUN_BOTTOM': return t(cap.autoThresholdRunBottom);
    }
  } else {
    const n = (v:number|null)=> Number(v ?? 0);
    switch (cat) {
      case 'TOP3':       return n(cap.top3);
      case 'TOD3':       return n(cap.tod3);
      case 'TOP2':       return n(cap.top2);
      case 'BOTTOM2':    return n(cap.bottom2);
      case 'RUN_TOP':    return n(cap.runTop);
      case 'RUN_BOTTOM': return n(cap.runBottom);
    }
  }
}

function perms3(s: string) {
  if ((s ?? '').length !== 3) return [s];
  const a = s[0], b = s[1], c = s[2];
  return Array.from(new Set([
    `${a}${b}${c}`, `${a}${c}${b}`,
    `${b}${a}${c}`, `${b}${c}${a}`,
    `${c}${a}${b}`, `${c}${b}${a}`,
  ]));
}

export async function POST(req: NextRequest) {
  try {
    let from: Date | undefined;
    let to: Date | undefined;
    try {
      if (req.headers.get('content-type')?.includes('application/json')) {
        const body = await req.json().catch(()=>({}));
        from = parseDateUTC((body as any)?.from);
        to   = parseDateUTC((body as any)?.to);
      }
    } catch {}

    let tw = await prisma.timeWindow.findFirst({ orderBy: { id:'desc' } });
    if (!tw) return NextResponse.json({ error: 'ยังไม่มี time-window' }, { status: 400 });

    if (from && to) {
      const host = await prisma.timeWindow.findFirst({
        where: { startAt: { lte: from }, endAt: { gte: to } }, orderBy: { id: 'desc' }
      });
      if (host) tw = host;
    }

    const startAt = tw.startAt;
    const endAt   = tw.endAt;
    const _from = from ? new Date(Math.max(startAt.getTime(), from.getTime())) : startAt;
    const _to   = to   ? new Date(Math.min(endAt.getTime(),   to.getTime()))   : endAt;

    if (!(_from < _to)) {
      return NextResponse.json({ created: 0, window: { startAt, endAt, appliedFrom: _from, appliedTo: _to } });
    }

    // snapshot cap
    const cap = await prisma.capRule.upsert({
      where: { id: 1 },
      create: { id: 1, mode: 'MANUAL' },
      update: {},
      select: {
        mode: true,
        top3: true, tod3: true, top2: true, bottom2: true, runTop: true, runBottom: true,
        autoThresholdTop3: true, autoThresholdTod3: true, autoThresholdTop2: true,
        autoThresholdBottom2: true, autoThresholdRunTop: true, autoThresholdRunBottom: true,
        convertTod3ToTop3: true,
      },
    });

    // inflow ตั้งแต่ต้นงวด.._to
    const inflowsRaw = await prisma.$queryRaw<
      { productId: number; category: Category; number: string; inflow: number }[]
    >`
      SELECT p.id AS "productId", p.category AS "category", p.number AS "number",
             COALESCE(SUM(oi."sumAmount"),0)::float AS "inflow"
      FROM "OrderItem" oi
      JOIN "Order" o   ON oi."orderId" = o.id
      JOIN "Product" p ON oi."productId" = p.id
      WHERE o."createdAt" >= ${startAt} AND o."createdAt" < ${_to}
      GROUP BY p.id, p.category, p.number
    `;

    // รวม TOD3 -> TOP3 ถ้าตั้งค่าไว้
    type Key = string;
    const inflowBy = new Map<Key, { cat: Category; number: string; amount: number }>();
    for (const r of inflowsRaw) {
      if (r.category === 'TOD3' && cap.convertTod3ToTop3) {
        const perms = perms3(r.number);
        const perEach = r.inflow / perms.length;
        for (const nn of perms) {
          const k: Key = `TOP3|${nn}`;
          inflowBy.set(k, { cat:'TOP3', number: nn, amount: (inflowBy.get(k)?.amount ?? 0) + perEach });
        }
      } else {
        const k: Key = `${r.category}|${r.number}`;
        inflowBy.set(k, { cat: r.category, number: r.number, amount: (inflowBy.get(k)?.amount ?? 0) + r.inflow });
      }
    }

    // already kept ภายในงวดจนถึง _to
    const keptRaw = await prisma.$queryRaw<{ category: Category; number: string; kept: number }[]>`
      SELECT a.category AS "category", a.number AS "number",
             COALESCE(SUM(a.amount),0)::float AS "kept"
      FROM "AcceptSelf" a
      WHERE a."createdAt" >= ${startAt} AND a."createdAt" < ${_to}
      GROUP BY a.category, a.number
    `;
    const keptByKey = new Map<Key, number>();
    for (const r of keptRaw) {
      keptByKey.set(`${r.category}|${r.number}`, r.kept);
    }

    let created = 0;
    for (const { cat, number, amount } of inflowBy.values()) {
      const capAmt = capFor(cat, cap as CapRow) ?? 0;
      const target = Math.min(amount, capAmt); // รับเองได้รวมทั้งงวด
      const already = keptByKey.get(`${cat}|${number}`) ?? 0;
      const need = target - already;
      if (need > 0) {
        await prisma.acceptSelf.create({
          data: { category: cat, number, amount: need }
        });
        created++;
      }
    }

    return NextResponse.json({
      created,
      window: { startAt, endAt, appliedFrom: _from, appliedTo: _to }
    });
  } catch (e: any) {
    console.error('KEEP ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'keep failed' }, { status: 500 });
  }
}
