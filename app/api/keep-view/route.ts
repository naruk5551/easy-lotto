// app/api/keep-view/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function parseDateUTC(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  // มี Z หรือมี offset → parse ตรง
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // datetime-local (ไม่มี timezone) → ถือว่าเป็นเวลาไทย +07:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const d = new Date(`${s}+07:00`);
    return isNaN(d.getTime()) ? undefined : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

const CATEGORIES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Category = (typeof CATEGORIES)[number];

// --------- helpers (เหมือน keep/settle) ----------
function perms3(s: string) {
  if ((s ?? '').length !== 3) return [s];
  const a = s[0], b = s[1], c = s[2];
  return Array.from(new Set([
    `${a}${b}${c}`, `${a}${c}${b}`,
    `${b}${a}${c}`, `${b}${c}${a}`,
    `${c}${a}${b}`, `${c}${b}${a}`,
  ]));
}

type CapMode = 'AUTO' | 'MANUAL';
type CapRow = {
  mode: CapMode;
  top3: number | null; tod3: number | null; top2: number | null;
  bottom2: number | null; runTop: number | null; runBottom: number | null;
  autoThresholdTop3: any | null; autoThresholdTod3: any | null; autoThresholdTop2: any | null;
  autoThresholdBottom2: any | null; autoThresholdRunTop: any | null; autoThresholdRunBottom: any | null;
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
    const n = (v: number | null) => Number(v ?? 0);
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

const keyOf = (c: Category, n: string) => `${c}|${n}`;

/**
 * ✅ FIX สำคัญ: keep-view ต้องคำนวณจาก "Order.createdAt" ไม่ใช้ AcceptSelf.createdAt
 * และเพื่อให้กรองช่วงย่อยได้ → ใช้ delta: accept(upto=to) - accept(upto=from)
 */
async function computeAcceptedCumulative(params: {
  startAt: Date;
  upto: Date;
  cap: CapRow;
}): Promise<Map<string, number>> {
  const { startAt, upto, cap } = params;

  // inflow สะสมตั้งแต่ต้นงวด..upto  (ยึดแบบ A: o.createdAt)
  const inflowsRaw = await prisma.$queryRaw<
    { category: Category; number: string; inflow: number }[]
  >`
    SELECT p.category AS "category",
           p.number   AS "number",
           COALESCE(SUM(oi."sumAmount"),0)::float AS "inflow"
    FROM "OrderItem" oi
    JOIN "Order" o   ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" >= ${startAt} AND o."createdAt" < ${upto}
    GROUP BY p.category, p.number
  `;

  const inflowBy = new Map<string, number>();
  for (const r of inflowsRaw) {
    const amt = Number(r.inflow ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const k = keyOf(r.category, r.number);
    inflowBy.set(k, (inflowBy.get(k) ?? 0) + amt);
  }

  const accepted = new Map<string, number>();

  const convert = !!cap.convertTod3ToTop3;
  const capTop3 = capFor('TOP3', cap) ?? 0;

  // keptPermTop3 = ยอดรับเองสะสมในเชิง "TOP3 ต่อ permutation"
  const keptPermTop3 = new Map<string, number>();

  // 1) TOP3 ตรง: รับเองได้ = min(inflow, capTop3) ต่อเลข
  for (const [k, inflow] of inflowBy.entries()) {
    const [cat, num] = k.split('|') as [Category, string];
    if (cat !== 'TOP3') continue;

    const keep = Math.min(inflow, capTop3);
    if (keep > 0) {
      accepted.set(k, keep);
      keptPermTop3.set(num, (keptPermTop3.get(num) ?? 0) + keep);
    }
  }

  // 2) หมวดอื่น ๆ (ยกเว้น TOD3 ตอน convert) → min(inflow, capหมวดนั้น)
  for (const [k, inflow] of inflowBy.entries()) {
    const [cat] = k.split('|') as [Category, string];
    if (cat === 'TOP3') continue;
    if (convert && cat === 'TOD3') continue;

    const capAmt = capFor(cat, cap) ?? 0;
    const keep = Math.min(inflow, capAmt);
    if (keep > 0) accepted.set(k, keep);
  }

  // 3) TOD3 ตอน convert: “คุมอั้นด้วย cap TOP3” แต่ “แสดงเป็น TOD3”
  if (convert) {
    for (const [k, inflow] of inflowBy.entries()) {
      const [cat, num] = k.split('|') as [Category, string];
      if (cat !== 'TOD3') continue;

      const list = perms3(num);
      const perIn = Math.round(inflow / list.length); // ✅ ต้องเหมือน settle/keep

      let addTotal = 0;
      for (const nn of list) {
        const alreadyPerm = keptPermTop3.get(nn) ?? 0;
        const remaining = Math.max(capTop3 - alreadyPerm, 0);
        const add = Math.min(perIn, remaining);
        if (add > 0) {
          addTotal += add;
          keptPermTop3.set(nn, alreadyPerm + add);
        }
      }

      if (addTotal > 0) {
        accepted.set(k, addTotal); // ✅ เก็บเป็น TOD3 เพื่อแสดงเป็นโต๊ด
      }
    }
  }

  return accepted;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const pageSize = Math.max(1, Math.min(5000, Number(searchParams.get('pageSize') ?? 2000)));
  const offset = (page - 1) * pageSize;

  const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
  if (!tw) {
    return NextResponse.json({ from: null, to: null, total: 0, items: [], page, pageSize });
  }

  const fromQ = parseDateUTC(searchParams.get('from'));
  const toQ = parseDateUTC(searchParams.get('to'));

  const from = fromQ ?? tw.startAt;
  const to = toQ ?? tw.endAt;

  // clamp ให้อยู่ในงวด
  const startAt = tw.startAt;
  const endAt = tw.endAt;
  const _from = new Date(Math.max(startAt.getTime(), from.getTime()));
  const _to = new Date(Math.min(endAt.getTime(), to.getTime()));

  if (!(_from < _to)) {
    return NextResponse.json({ from: _from, to: _to, total: 0, items: [], page, pageSize });
  }

  // ✅ ใช้ CapRule แถวล่าสุด (เหมือน settle)
  const latestCap = await prisma.capRule.findFirst({
    orderBy: { id: 'desc' },
    select: {
      mode: true,
      top3: true, tod3: true, top2: true, bottom2: true, runTop: true, runBottom: true,
      autoThresholdTop3: true, autoThresholdTod3: true, autoThresholdTop2: true,
      autoThresholdBottom2: true, autoThresholdRunTop: true, autoThresholdRunBottom: true,
      convertTod3ToTop3: true,
    },
  });

  const cap: CapRow = latestCap ? {
    mode: latestCap.mode,
    top3: latestCap.top3, tod3: latestCap.tod3, top2: latestCap.top2,
    bottom2: latestCap.bottom2, runTop: latestCap.runTop, runBottom: latestCap.runBottom,
    autoThresholdTop3: latestCap.autoThresholdTop3, autoThresholdTod3: latestCap.autoThresholdTod3, autoThresholdTop2: latestCap.autoThresholdTop2,
    autoThresholdBottom2: latestCap.autoThresholdBottom2, autoThresholdRunTop: latestCap.autoThresholdRunTop, autoThresholdRunBottom: latestCap.autoThresholdRunBottom,
    convertTod3ToTop3: latestCap.convertTod3ToTop3,
  } : {
    mode: 'MANUAL',
    top3: null, tod3: null, top2: null,
    bottom2: null, runTop: null, runBottom: null,
    autoThresholdTop3: null, autoThresholdTod3: null, autoThresholdTop2: null,
    autoThresholdBottom2: null, autoThresholdRunTop: null, autoThresholdRunBottom: null,
    convertTod3ToTop3: false,
  };

  // inflow เฉพาะช่วงย่อย (เอาไว้โชว์)
  const inflowSliceRaw = await prisma.$queryRaw<
    { category: Category; number: string; inflow: number }[]
  >`
    SELECT p.category AS "category",
           p.number   AS "number",
           COALESCE(SUM(oi."sumAmount"),0)::float AS "inflow"
    FROM "OrderItem" oi
    JOIN "Order" o   ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" >= ${_from} AND o."createdAt" < ${_to}
    GROUP BY p.category, p.number
  `;

  const inflowSliceByKey = new Map<string, number>();
  for (const r of inflowSliceRaw) {
    const amt = Number(r.inflow ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    inflowSliceByKey.set(keyOf(r.category, r.number), (inflowSliceByKey.get(keyOf(r.category, r.number)) ?? 0) + amt);
  }

  // ✅ FIX: keep delta = acceptCum(to) - acceptCum(from)
  const acceptTo = await computeAcceptedCumulative({ startAt, upto: _to, cap });
  const acceptFrom = await computeAcceptedCumulative({ startAt, upto: _from, cap });

  const keepDeltaByKey = new Map<string, number>();
  for (const [k, vTo] of acceptTo.entries()) {
    const vFrom = acceptFrom.get(k) ?? 0;
    const d = Number(vTo) - Number(vFrom);
    if (d > 0) keepDeltaByKey.set(k, d);
  }

  // union keys (มี inflow slice หรือมี keep delta)
  const allKeys = new Set<string>([...inflowSliceByKey.keys(), ...keepDeltaByKey.keys()]);

  const itemsAll: { category: Category; number: string; inflow: number; keep: number }[] = [];
  for (const k of allKeys) {
    const [cat, num] = k.split('|') as [Category, string];
    const inflow = inflowSliceByKey.get(k) ?? 0;
    const keep = keepDeltaByKey.get(k) ?? 0;
    if (inflow <= 0 && keep <= 0) continue;
    itemsAll.push({ category: cat, number: num, inflow, keep });
  }

  // จัดอันดับเหมือนเดิม: แยกหมวดแล้วเรียง keep มาก → เลข
  const byCat = new Map<Category, { category: Category; number: string; inflow: number; keep: number }[]>();
  for (const it of itemsAll) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category)!.push(it);
  }
  for (const [cat, arr] of byCat) {
    arr.sort((a, b) => (b.keep - a.keep) || a.number.localeCompare(b.number));
    byCat.set(cat, arr);
  }

  // สร้างลิสต์แบบ “ทุกหมวดเริ่มแถวแรก” (เหมือนเดิม)
  const merged: typeof itemsAll = [];
  let i = 0;
  while (true) {
    let pushed = false;
    for (const cat of CATEGORIES) {
      const arr = byCat.get(cat) ?? [];
      if (i < arr.length) {
        merged.push(arr[i]);
        pushed = true;
      }
    }
    if (!pushed) break;
    i++;
  }

  const total = merged.length;
  const paged = merged.slice(offset, offset + pageSize);

  return NextResponse.json({
    from: _from,
    to: _to,
    total,
    items: paged,
    page,
    pageSize,
  });
}
