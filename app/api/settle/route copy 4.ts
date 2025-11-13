// app/api/settle/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Category, CapMode, Prisma } from '@prisma/client';

// ---------- helpers ----------
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
    const t = (v: any) => Number(v ?? 0);
    switch (cat) {
      case 'TOP3':       return t(cap.autoThresholdTop3);
      case 'TOD3':       return t(cap.autoThresholdTod3);
      case 'TOP2':       return t(cap.autoThresholdTop2);
      case 'BOTTOM2':    return t(cap.autoThresholdBottom2);
      case 'RUN_TOP':    return t(cap.autoThresholdRunTop);
      case 'RUN_BOTTOM': return t(cap.autoThresholdRunBottom);
    }
  } else {
    const n = (v: number|null) => Number(v ?? 0);
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
    // 1) รับช่วงเวลา
    let from: Date | undefined;
    let to: Date | undefined;
    try {
      if (req.headers.get('content-type')?.includes('application/json')) {
        const body = await req.json().catch(() => ({} as any));
        from = parseDateUTC(body?.from);
        to   = parseDateUTC(body?.to);
      }
    } catch {}

    // หา time-window ล่าสุดเป็น default
    let tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (!tw) return NextResponse.json({ error: 'ยังไม่มี time-window' }, { status: 400 });

    // ถ้ามี from/to พยายามหา TW ที่ครอบคลุม
    if (from && to) {
      const hostTW = await prisma.timeWindow.findFirst({
        where: { startAt: { lte: from }, endAt: { gte: to } },
        orderBy: { id: 'desc' },
      });
      if (hostTW) tw = hostTW;
    }
    const startAt = tw.startAt;
    const endAt   = tw.endAt;

    // clamp ให้อยู่ในงวด
    const _from = from ? new Date(Math.max(startAt.getTime(), from.getTime())) : startAt;
    const _to   = to   ? new Date(Math.min(endAt.getTime(),   to.getTime()))   : endAt;

    // กันรันซ้ำช่วงย่อยเดิมเป๊ะ ๆ
    const existed = await prisma.settleBatch.findFirst({
      where: { from: _from, to: _to },
      select: { id: true },
    });
    if (existed) {
      const count = await prisma.excessBuy.count({ where: { batchId: existed.id } });
      return NextResponse.json({ alreadyExists: true, batchId: existed.id, createdCount: count });
    }

    // 2) โหลด cap ปัจจุบัน
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

    // 3) รวมยอดซื้อ (cumulative) ตั้งแต่ต้นงวด.._to
    const inflowsRaw = await prisma.$queryRaw<
      { productId: number; category: Category; number: string; inflow: number }[]
    >(Prisma.sql`
      SELECT p.id        AS "productId",
             p.category  AS "category",
             p.number    AS "number",
             COALESCE(SUM(oi."sumAmount"),0)::float AS "inflow"
      FROM "OrderItem" oi
      JOIN "Order" o   ON oi."orderId" = o.id
      JOIN "Product" p ON oi."productId" = p.id
      WHERE o."createdAt" >= ${startAt} AND o."createdAt" < ${_to}
      GROUP BY p.id, p.category, p.number
    `);

    // 4) รวม TOD3 → TOP3 ก่อนคำนวณอั้น
    type Key = string; // `${cat}|${number}`
    const inflowBy = new Map<Key, { cat: Category; number: string; amount: number }>();
    const top3IdByNumber = new Map<string, number>();
    const idByKey = new Map<Key, number>();

    for (const r of inflowsRaw) {
      if (r.category === 'TOP3') {
        top3IdByNumber.set(r.number, r.productId);
        const k: Key = `TOP3|${r.number}`;
        const cur = inflowBy.get(k)?.amount ?? 0;
        inflowBy.set(k, { cat: 'TOP3', number: r.number, amount: cur + r.inflow });
      } else if (r.category === 'TOD3') {
        if (cap.convertTod3ToTop3) {
          const list = perms3(r.number);
          const perEach = r.inflow / list.length;
          for (const nn of list) {
            const k: Key = `TOP3|${nn}`;
            const cur = inflowBy.get(k)?.amount ?? 0;
            inflowBy.set(k, { cat: 'TOP3', number: nn, amount: cur + perEach });
          }
        } else {
          const k: Key = `TOD3|${r.number}`;
          idByKey.set(k, r.productId);
          const cur = inflowBy.get(k)?.amount ?? 0;
          inflowBy.set(k, { cat: 'TOD3', number: r.number, amount: cur + r.inflow });
        }
      } else {
        const k: Key = `${r.category}|${r.number}`;
        idByKey.set(k, r.productId);
        const cur = inflowBy.get(k)?.amount ?? 0;
        inflowBy.set(k, { cat: r.category, number: r.number, amount: cur + r.inflow });
      }
    }

    if (inflowBy.size === 0) {
      const empty = await prisma.settleBatch.create({ data: { from: _from, to: _to } });
      return NextResponse.json({ batchId: empty.id, createdCount: 0, created: [] });
    }

    // 5) อ่าน “ยอดที่เคยส่งแล้ว” ตั้งแต่ต้นงวด.._to
    const sentRaw = await prisma.$queryRaw<{ productId: number; sent: number }[]>(Prisma.sql`
      SELECT ex."productId" AS "productId",
             COALESCE(SUM(ex.amount),0)::float AS "sent"
      FROM "ExcessBuy" ex
      JOIN "SettleBatch" b ON ex."batchId" = b."id"
      WHERE b."from" >= ${startAt} AND b."to" <= ${_to}
      GROUP BY ex."productId"
    `);
    const sentByProductId = new Map<number, number>();
    for (const r of sentRaw) sentByProductId.set(r.productId, r.sent);

    // 6) คำนวณ “ส่วนที่ยังต้องสร้างเพิ่ม” รอบนี้
    const toCreate: { productId: number; amount: number }[] = [];

    for (const { cat, number, amount: inflow } of inflowBy.values()) {
      const capAmt = capFor(cat, cap as CapRow) ?? 0;
      const demandTotal = Math.max(inflow - capAmt, 0);
      if (demandTotal <= 0) continue;

      let productId: number | undefined;
      if (cat === 'TOP3') {
        if (!top3IdByNumber.has(number)) {
          const p = await prisma.product.upsert({
            where: { category_number: { category: 'TOP3', number } },
            create: { category: 'TOP3', number },
            update: {},
            select: { id: true },
          });
          top3IdByNumber.set(number, p.id);
        }
        productId = top3IdByNumber.get(number)!;
      } else {
        const k: Key = `${cat}|${number}`;
        productId = idByKey.get(k);
        if (!productId) {
          const p = await prisma.product.upsert({
            where: { category_number: { category: cat, number } },
            create: { category: cat, number },
            update: {},
            select: { id: true },
          });
          idByKey.set(k, p.id);
          productId = p.id;
        }
      }

      const already = sentByProductId.get(productId) ?? 0;
      const need = demandTotal - already;
      if (need > 0) toCreate.push({ productId, amount: need });
    }

    // 7) บันทึกเป็น batch ใหม่
    const batch = await prisma.settleBatch.create({ data: { from: _from, to: _to } });
    const created: any[] = [];
    for (const row of toCreate) {
      const ex = await prisma.excessBuy.create({
        data: { productId: row.productId, amount: row.amount, batchId: batch.id },
      });
      created.push(ex);
    }

    return NextResponse.json({
      batchId: batch.id,
      createdCount: created.length,
      window: { startAt, endAt, appliedFrom: _from, appliedTo: _to },
      created,
    });
  } catch (e: any) {
    console.error('SETTLE ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'settle failed' }, { status: 500 });
  }
}
