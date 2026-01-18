// app/api/keep-view/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CATEGORIES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Category = (typeof CATEGORIES)[number];

type CapMode = 'MANUAL' | 'AUTO';

function parseDateUTC(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // NOTE: keep-view รับ query เป็น ISO Z อยู่แล้วจากหน้า (คุณส่ง ...Z)
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

type CapRow = {
  mode: CapMode;
  top3: number | null;
  tod3: number | null;
  top2: number | null;
  bottom2: number | null;
  runTop: number | null;
  runBottom: number | null;

  autoThresholdTop3: any | null;
  autoThresholdTod3: any | null;
  autoThresholdTop2: any | null;
  autoThresholdBottom2: any | null;
  autoThresholdRunTop: any | null;
  autoThresholdRunBottom: any | null;

  convertTod3ToTop3: boolean;
};

function capFor(cat: Category, cap: CapRow): number {
  if (cap.mode === 'AUTO') {
    const t = (v: any) => Number(v ?? 0);
    switch (cat) {
      case 'TOP3': return t(cap.autoThresholdTop3);
      case 'TOD3': return t(cap.autoThresholdTod3);
      case 'TOP2': return t(cap.autoThresholdTop2);
      case 'BOTTOM2': return t(cap.autoThresholdBottom2);
      case 'RUN_TOP': return t(cap.autoThresholdRunTop);
      case 'RUN_BOTTOM': return t(cap.autoThresholdRunBottom);
    }
  } else {
    const n = (v: number | null) => Number(v ?? 0);
    switch (cat) {
      case 'TOP3': return n(cap.top3);
      case 'TOD3': return n(cap.tod3);
      case 'TOP2': return n(cap.top2);
      case 'BOTTOM2': return n(cap.bottom2);
      case 'RUN_TOP': return n(cap.runTop);
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

function splitAmountExact(total: number, parts: number) {
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  const out = new Array(parts).fill(base);
  for (let i = 0; i < rem; i++) out[i] += 1;
  return out;
}

// keep สะสมถึง upto (ใช้โค้ดเดียวกับ keep)
async function computeKeepUpTo(startAt: Date, upto: Date, cap: CapRow) {
  const inflow = await prisma.$queryRaw<
    { category: Category; number: string; amount: number }[]
  >`
    SELECT
      p.category AS "category",
      p.number   AS "number",
      COALESCE(SUM(oi."sumAmount"),0)::float AS "amount"
    FROM "OrderItem" oi
    JOIN "Order" o   ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" >= ${startAt} AND o."createdAt" < ${upto}
    GROUP BY p.category, p.number
  `;

  const top3Direct = new Map<string, number>();
  const tod3 = new Map<string, number>();
  const others = new Map<string, number>();

  for (const r of inflow) {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;

    if (r.category === 'TOP3') {
      top3Direct.set(r.number, (top3Direct.get(r.number) || 0) + amt);
      continue;
    }
    if (r.category === 'TOD3') {
      tod3.set(r.number, (tod3.get(r.number) || 0) + amt);
      continue;
    }
    const k = `${r.category}|${r.number}`;
    others.set(k, (others.get(k) || 0) + amt);
  }

  const keepByKey = new Map<string, number>();

  // other cats
  for (const [k, amt] of others) {
    const [cat] = k.split('|') as [Category];
    keepByKey.set(k, Math.max(0, Math.min(amt, capFor(cat, cap))));
  }

  const capTop3 = capFor('TOP3', cap);

  if (!cap.convertTod3ToTop3) {
    for (const [n, amt] of top3Direct) keepByKey.set(`TOP3|${n}`, Math.max(0, Math.min(amt, capTop3)));
    const capTod3 = capFor('TOD3', cap);
    for (const [n, amt] of tod3) keepByKey.set(`TOD3|${n}`, Math.max(0, Math.min(amt, capTod3)));
    return keepByKey;
  }

  // convert TOD3 -> TOP3 cap, but keep displayed under TOD3
  const remainingCapByPerm = new Map<string, number>();
  const allPerms = new Set<string>();
  for (const n of top3Direct.keys()) allPerms.add(n);
  for (const n of tod3.keys()) perms3(n).forEach(p => allPerms.add(p));
  for (const p of allPerms) remainingCapByPerm.set(p, capTop3);

  // TOP3 direct first
  for (const [n, amt] of top3Direct) {
    const rem = remainingCapByPerm.get(n) ?? capTop3;
    const kept = Math.max(0, Math.min(amt, rem));
    keepByKey.set(`TOP3|${n}`, kept);
    remainingCapByPerm.set(n, rem - kept);
  }

  // TOD3 after (deterministic)
  const todNumbers = [...tod3.keys()].sort();
  for (const todNum of todNumbers) {
    const total = tod3.get(todNum) || 0;
    if (total <= 0) continue;

    const permList = perms3(todNum).sort();
    const splits = splitAmountExact(total, permList.length);

    let todKeptSum = 0;
    for (let i = 0; i < permList.length; i++) {
      const perm = permList[i];
      const part = splits[i];
      const rem = remainingCapByPerm.get(perm) ?? capTop3;
      const keptPart = Math.max(0, Math.min(part, rem));
      todKeptSum += keptPart;
      remainingCapByPerm.set(perm, rem - keptPart);
    }

    if (todKeptSum > 0) keepByKey.set(`TOD3|${todNum}`, todKeptSum);
  }

  return keepByKey;
}

async function inflowRange(from: Date, to: Date) {
  return prisma.$queryRaw<{ category: Category; number: string; amount: number }[]>`
    SELECT
      p.category AS "category",
      p.number   AS "number",
      COALESCE(SUM(oi."sumAmount"),0)::float AS "amount"
    FROM "OrderItem" oi
    JOIN "Order" o   ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
    GROUP BY p.category, p.number
  `;
}

export async function GET(req: NextRequest) {
  try {
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

    // ✅ load latest capRule (เหมือน keep/settle)
    const cap = await prisma.capRule.findFirst({
      orderBy: { id: 'desc' },
      select: {
        mode: true,
        top3: true, tod3: true, top2: true, bottom2: true, runTop: true, runBottom: true,
        autoThresholdTop3: true, autoThresholdTod3: true, autoThresholdTop2: true,
        autoThresholdBottom2: true, autoThresholdRunTop: true, autoThresholdRunBottom: true,
        convertTod3ToTop3: true,
      },
    });

    const capRow: CapRow = (cap ?? {
      mode: 'MANUAL',
      top3: 0, tod3: 0, top2: 0, bottom2: 0, runTop: 0, runBottom: 0,
      autoThresholdTop3: 0, autoThresholdTod3: 0, autoThresholdTop2: 0,
      autoThresholdBottom2: 0, autoThresholdRunTop: 0, autoThresholdRunBottom: 0,
      convertTod3ToTop3: false,
    }) as any;

    // keepDelta = keepUpTo(to) - keepUpTo(from)
    const keepTo = await computeKeepUpTo(tw.startAt, to, capRow);
    const keepFrom = await computeKeepUpTo(tw.startAt, from, capRow);

    const keepDeltaByKey = new Map<string, number>();
    for (const [k, vTo] of keepTo) {
      const vFrom = keepFrom.get(k) || 0;
      const delta = (Number(vTo) || 0) - (Number(vFrom) || 0);
      if (delta > 0) keepDeltaByKey.set(k, delta);
    }

    // inflow ของช่วง (เพื่อแสดงคู่กัน)
    const inflow = await inflowRange(from, to);
    const inflowByKey = new Map<string, number>();
    for (const r of inflow) {
      const k = `${r.category}|${r.number}`;
      inflowByKey.set(k, (inflowByKey.get(k) || 0) + (Number(r.amount) || 0));
    }

    // สร้าง rows: เอา key ที่มี inflow หรือ keepDelta
    const allKeys = new Set<string>([...inflowByKey.keys(), ...keepDeltaByKey.keys()]);
    const allRows: { category: Category; number: string; inflow: number; keep: number }[] = [];

    for (const k of allKeys) {
      const [cat, number] = k.split('|') as [Category, string];

      // ✅ ถ้าแปลงโต๊ด → 3 ตัวบน ให้ซ่อน TOD3 ใน keep-view
      if (capRow.convertTod3ToTop3 && cat === 'TOD3') continue;

      const infl = inflowByKey.get(k) || 0;
      const keep = keepDeltaByKey.get(k) || 0;
      if (!infl && !keep) continue;

      allRows.push({ category: cat, number, inflow: infl, keep });
    }

    // total rows (distinct)
    const total = allRows.length;

    // rank (เหมือนเดิม): แยกหมวดแล้วเรียง keep desc
    allRows.sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      if (b.keep !== a.keep) return b.keep - a.keep;
      return a.number.localeCompare(b.number);
    });

    const items = allRows.slice(offset, offset + pageSize);

    return NextResponse.json({
      from,
      to,
      total,
      items,
      page,
      pageSize,
    });
  } catch (e: any) {
    console.error('KEEP-VIEW ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'keep-view failed' }, { status: 500 });
  }
}
