// app/api/settle/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Category, CapMode } from '@prisma/client';

// ===== helpers =====
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
    // 1) ช่วงเวลา
    let from: Date | undefined;
    let to: Date | undefined;
    try {
      if (req.headers.get('content-type')?.includes('application/json')) {
        const body = await req.json().catch(() => ({} as any));
        from = parseDateUTC(body?.from);
        to   = parseDateUTC(body?.to);
      }
    } catch {}

    // หา TW ล่าสุดเป็นฐาน
    let tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (!tw) return NextResponse.json({ error: 'ยังไม่มี time-window' }, { status: 400 });

    // ถ้ามี from/to มา และอยู่ในงวดไหน ให้ใช้งวดนั้น
    if (from && to) {
      const host = await prisma.timeWindow.findFirst({
        where: { startAt: { lte: from }, endAt: { gte: to } },
        orderBy: { id: 'desc' },
      });
      if (host) tw = host;
    }

    const startAt = tw.startAt;
    const endAt   = tw.endAt;
    const _from = from ? new Date(Math.max(startAt.getTime(), from.getTime())) : startAt;
    const _to   = to   ? new Date(Math.min(endAt.getTime(),   to.getTime()))   : endAt;

    // กันซ้ำ: batch ช่วงเดียวกันเคยทำแล้วหรือยัง
    const existing = await prisma.settleBatch.findFirst({
      where: { from: _from, to: _to },
      select: { id: true },
    });
    if (existing) {
      const count = await prisma.excessBuy.count({ where: { batchId: existing.id } });
      return NextResponse.json({ alreadyExists: true, batchId: existing.id, createdCount: count });
    }

    // 2) โหลด Cap ปัจจุบัน
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

    // 3) รวมยอดซื้อสะสมตั้งแต่ต้นงวดจนถึง _to
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

    // 3.1 แปลง TOD3 → TOP3 (ถ้าเปิด) แล้วรวม inflow ต่อหมวดสุดท้าย
    type Key = string;
    const inflowBy = new Map<Key, { cat: Category; number: string; amount: number }>();
    const idTop3ByNum = new Map<string, number>();
    const idOtherByKey = new Map<Key, number>();

    for (const r of inflowsRaw) {
      if (r.category === 'TOP3') {
        idTop3ByNum.set(r.number, r.productId);
        const k: Key = `TOP3|${r.number}`;
        inflowBy.set(k, { cat: 'TOP3', number: r.number, amount: (inflowBy.get(k)?.amount ?? 0) + r.inflow });
      } else if (r.category === 'TOD3' && cap.convertTod3ToTop3) {
        const each = r.inflow / 6;
        for (const nn of perms3(r.number)) {
          const k: Key = `TOP3|${nn}`;
          inflowBy.set(k, { cat: 'TOP3', number: nn, amount: (inflowBy.get(k)?.amount ?? 0) + each });
        }
      } else {
        const k: Key = `${r.category}|${r.number}`;
        idOtherByKey.set(k, r.productId);
        inflowBy.set(k, { cat: r.category, number: r.number, amount: (inflowBy.get(k)?.amount ?? 0) + r.inflow });
      }
    }

    if (inflowBy.size === 0) {
      const empty = await prisma.settleBatch.create({ data: { from: _from, to: _to } });
      return NextResponse.json({ batchId: empty.id, createdCount: 0, created: [] });
    }

    // 4) ยอดที่ส่งไปแล้วในงวดนี้ก่อนหน้า (ทั้งหมดจนถึง < _to)
    const sentRaw = await prisma.$queryRaw<{ productId: number; sent: number }[]>`
      SELECT ex."productId" AS "productId", COALESCE(SUM(ex.amount),0)::float AS "sent"
      FROM "ExcessBuy" ex
      JOIN "SettleBatch" b ON ex."batchId" = b.id
      WHERE b."from" >= ${startAt} AND b."to" < ${_to}
      GROUP BY ex."productId"
    `;
    const sentByProduct = new Map<number, number>();
    for (const r of sentRaw) sentByProduct.set(r.productId, r.sent);

    // 5) คำนวณ needToCreate รอบนี้ (incremental)
    const rows: { productId: number; amount: number; }[] = [];

    for (const { cat, number, amount } of inflowBy.values()) {
      const capAmt = capFor(cat, cap as CapRow) ?? 0;
      const demandTotal = Math.max(amount - capAmt, 0);
      if (demandTotal <= 0) continue;

      let productId: number | undefined;
      if (cat === 'TOP3') {
        if (!idTop3ByNum.has(number)) {
          const p = await prisma.product.upsert({
            where: { category_number: { category: 'TOP3', number } },
            create: { category: 'TOP3', number },
            update: {},
            select: { id: true },
          });
          idTop3ByNum.set(number, p.id);
        }
        productId = idTop3ByNum.get(number)!;
      } else {
        const k: Key = `${cat}|${number}`;
        productId = idOtherByKey.get(k);
        if (!productId) {
          const p = await prisma.product.upsert({
            where: { category_number: { category: cat, number } },
            create: { category: cat, number },
            update: {},
            select: { id: true },
          });
          productId = p.id;
          idOtherByKey.set(k, productId);
        }
      }

      const sent = sentByProduct.get(productId) ?? 0;
      const need = demandTotal - sent;
      if (need > 0) rows.push({ productId, amount: need });
    }

    // --- LOG ไว้ตรวจใน server console ---
    console.log('[SETTLE] range', _from.toISOString(), '→', _to.toISOString(),
      ' rowsToInsert=', rows.length);

    // 6) เขียนลง DB ด้วย transaction + createMany
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.settleBatch.create({ data: { from: _from, to: _to } });
      if (rows.length === 0) return { batchId: batch.id, count: 0 };

      await tx.excessBuy.createMany({
        data: rows.map(r => ({ batchId: batch.id, productId: r.productId, amount: r.amount })),
      });

      const created = await tx.excessBuy.findMany({
        where: { batchId: batch.id },
        select: { id: true, productId: true, amount: true, createdAt: true },
      });
      return { batchId: batch.id, count: created.length, created };
    });

    return NextResponse.json({
      batchId: result.batchId,
      createdCount: result.count,
      created: result.count ? result.created : [],
      window: { startAt, endAt, appliedFrom: _from, appliedTo: _to },
    });

  } catch (e: any) {
    console.error('SETTLE ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'settle failed' }, { status: 500 });
  }
}
