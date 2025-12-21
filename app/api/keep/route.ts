// app/api/keep/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CATEGORY_VALUES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Category = (typeof CATEGORY_VALUES)[number];

type CapMode = 'MANUAL' | 'AUTO';

function parseDateUTC(v?: unknown): Date | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  // ISO with timezone
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }

  // "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm" => treat as UTC string
  const m = s.replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) return new Date(`${m[1]}T${m[2]}Z`);

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

/**
 * ✅ แจกยอดแบบ "floor + remainder" ให้ผลรวมเท่าต้นฉบับ 100%
 * - ป้องกันปัญหา 100 กลายเป็น 102 (จาก Math.round)
 */
function splitAmountExact(total: number, parts: number) {
  const base = Math.floor(total / parts);
  const rem = total - base * parts; // 0..parts-1
  const out = new Array(parts).fill(base);
  for (let i = 0; i < rem; i++) out[i] += 1;
  return out;
}

/**
 * คำนวณ keep สะสมถึงเวลา upto แบบ time-priority:
 * keepDelta(from->to) = keepUpTo(to) - keepUpTo(from)
 *
 * ✅ เฉพาะกรณี convertTod3ToTop3:
 * - ใช้ cap ของ TOP3 คุมความเสี่ยง
 * - แต่ “คงแสดง TOD3” โดยเก็บผล keep ของ TOD3 แยกเป็นหมวด TOD3
 * - หลักการจัดสรร cap: ให้ TOP3 ตรง “กิน cap ก่อน” แล้วค่อยให้ TOD3 กินที่เหลือ (ตรงตามที่คุณคาดหวังว่ารอบ 1 เต็มแล้ว รอบ 2 TOD3 ต้อง 0)
 */
async function computeKeepUpTo(params: {
  startAt: Date;
  upto: Date;
  cap: CapRow;
}) {
  const { startAt, upto, cap } = params;

  // inflow สะสมตั้งแต่ต้นงวด..upto (ยึดแบบ A: o.createdAt)
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

  // แยกเป็น map
  const top3Direct = new Map<string, number>(); // number -> amount
  const tod3 = new Map<string, number>();       // original TOD3 number -> amount
  const others = new Map<string, number>();     // "CAT|num" -> amount

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

  // ผลลัพธ์ keep สะสม
  const keepByKey = new Map<string, number>(); // "CAT|num" -> keepAmount

  // ====== หมวดอื่นๆ คิดแบบ min(inflow, cap) ปกติ ======
  for (const [k, amt] of others) {
    const [cat] = k.split('|') as [Category];
    const c = capFor(cat, cap);
    keepByKey.set(k, Math.max(0, Math.min(amt, c)));
  }

  // ====== TOP3/TOD3 ======
  const capTop3 = capFor('TOP3', cap);

  if (!cap.convertTod3ToTop3) {
    // ไม่แปลง: TOP3 กับ TOD3 คิดแยกหมวดตาม cap ของตัวเอง
    for (const [n, amt] of top3Direct) {
      keepByKey.set(`TOP3|${n}`, Math.max(0, Math.min(amt, capTop3)));
    }
    const capTod3 = capFor('TOD3', cap);
    for (const [n, amt] of tod3) {
      keepByKey.set(`TOD3|${n}`, Math.max(0, Math.min(amt, capTod3)));
    }
    return keepByKey;
  }

  // ✅ แปลง TOD3 -> TOP3 เพื่อคุม capTop3 แต่ยัง “แสดง TOD3”
  // 1) TOP3 ตรงกิน cap ก่อน
  const remainingCapByPerm = new Map<string, number>();
  // init remaining cap for all perms we might touch
  const allPerms = new Set<string>();
  for (const n of top3Direct.keys()) allPerms.add(n);
  for (const n of tod3.keys()) perms3(n).forEach(p => allPerms.add(p));

  for (const p of allPerms) remainingCapByPerm.set(p, capTop3);

  // apply direct TOP3
  for (const [n, amt] of top3Direct) {
    const rem = remainingCapByPerm.get(n) ?? capTop3;
    const kept = Math.max(0, Math.min(amt, rem));
    keepByKey.set(`TOP3|${n}`, kept);
    remainingCapByPerm.set(n, rem - kept);
  }

  // 2) TOD3 กิน cap ที่เหลือ (จัดเรียงเลขเพื่อให้ deterministic)
  const todNumbers = [...tod3.keys()].sort();
  for (const todNum of todNumbers) {
    const total = tod3.get(todNum) || 0;
    if (total <= 0) continue;

    const permList = perms3(todNum).sort(); // deterministic
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

    if (todKeptSum > 0) {
      keepByKey.set(`TOD3|${todNum}`, todKeptSum);
    } else {
      // ถ้า cap เต็มอยู่แล้ว จะไม่เกิด record TOD3 ใน keep (ตรงตามที่คุณต้องการ)
      keepByKey.delete(`TOD3|${todNum}`);
    }
  }

  return keepByKey;
}

export async function POST(req: NextRequest) {
  try {
    // ---------------- read body ----------------
    let from: Date | undefined;
    let to: Date | undefined;
    try {
      if (req.headers.get('content-type')?.includes('application/json')) {
        const body = await req.json().catch(() => ({}));
        from = parseDateUTC((body as any)?.from);
        to = parseDateUTC((body as any)?.to);
      }
    } catch {}

    // ---------------- pick timeWindow ----------------
    let tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (!tw) return NextResponse.json({ error: 'ยังไม่มี time-window' }, { status: 400 });

    if (from && to) {
      const host = await prisma.timeWindow.findFirst({
        where: { startAt: { lte: from }, endAt: { gte: to } },
        orderBy: { id: 'desc' },
      });
      if (host) tw = host;
    }

    const startAt = tw.startAt;
    const endAt = tw.endAt;
    const _from = from ? new Date(Math.max(startAt.getTime(), from.getTime())) : startAt;
    const _to = to ? new Date(Math.min(endAt.getTime(), to.getTime())) : endAt;

    if (!(_from < _to)) {
      return NextResponse.json({ created: 0, window: { startAt, endAt, appliedFrom: _from, appliedTo: _to } });
    }

    // ---------------- load latest capRule (✅ FIX: ไม่ใช้ id=1) ----------------
    // IMPORTANT: ให้ตรงกับหน้า Cap ที่เป็น "ล่าสุด"
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

    // ---------------- compute keep delta (time-priority) ----------------
    // keepDelta = keepUpTo(_to) - keepUpTo(_from)
    const keepTo = await computeKeepUpTo({ startAt, upto: _to, cap: capRow });
    const keepFrom = await computeKeepUpTo({ startAt, upto: _from, cap: capRow });

    const toInsert: { category: Category; number: string; amount: number }[] = [];

    for (const [k, vTo] of keepTo) {
      const vFrom = keepFrom.get(k) || 0;
      const delta = (Number(vTo) || 0) - (Number(vFrom) || 0);
      if (delta > 0) {
        const [cat, number] = k.split('|') as [Category, string];
        toInsert.push({ category: cat, number, amount: delta });
      }
    }

    let created = 0;

    if (toInsert.length > 0) {
      await prisma.acceptSelf.createMany({
        data: toInsert.map(row => ({
          category: row.category,
          number: row.number,
          amount: row.amount,
        })),
      });
      created = toInsert.length;
    }

    return NextResponse.json({
      created,
      window: { startAt, endAt, appliedFrom: _from, appliedTo: _to },
    });
  } catch (e: any) {
    console.error('KEEP ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'keep failed' }, { status: 500 });
  }
}
