// app/api/cap/save/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ✅ ค่าหมวด (เหมือนเดิม)
const CATS = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Cat = (typeof CATS)[number];

// ===== ค่าถูกรางวัล (ตามที่คุณให้มา) =====
const PAYOUT: Record<Cat, number> = {
  TOP3: 600,
  TOD3: 100,
  TOP2: 70,
  BOTTOM2: 70,
  RUN_TOP: 9,
  RUN_BOTTOM: 8,
};

// ===== default ส่วนลด (%) =====
const DEFAULT_DISCOUNT_PCT: Record<Cat, number> = {
  TOP3: 30,
  TOD3: 20,
  TOP2: 20,
  BOTTOM2: 20,
  RUN_TOP: 15,
  RUN_BOTTOM: 15,
};

// ===== LOSS_MAX ต่อหมวด (ตามที่คุณกำหนดล่าสุด) =====
const LOSS_MAX: Record<Cat, number> = {
  TOP3: 20000,
  TOD3: 0,
  TOP2: 3000,
  BOTTOM2: 10000,
  RUN_TOP: 2000,
  RUN_BOTTOM: 1500,
};

/** สร้าง permutations ของเลข 3 หลักแบบไม่ซ้ำ */
function perms3(num: string): string[] {
  if (!num || num.length !== 3) return [num];
  const [a, b, c] = num.split('');
  return Array.from(
    new Set([
      `${a}${b}${c}`, `${a}${c}${b}`,
      `${b}${a}${c}`, `${b}${c}${a}`,
      `${c}${a}${b}`, `${c}${b}${a}`,
    ]),
  );
}

function clampPct(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), 100);
}

/**
 * AUTO: คำนวณ cap (บาท/เลข) แบบ "ปรับจนสมการเป็นจริง"
 * - keep ต่อเลข = min(total_i, cap)
 * - netKept = sum(min(total_i, cap)) * (1 - discount)
 * - จำกัดขาดทุน: payout*cap - netKept <= lossMax
 *   => payout*cap <= netKept + lossMax
 * - iterate หา fixed-point
 */
function solveCapIterative(args: {
  totalsByNumber: Map<string, number>;
  discountPct: number;
  payout: number;
  lossMax: number;
}): number {
  const { totalsByNumber, discountPct, payout, lossMax } = args;

  if (!payout || payout <= 0) return 0;
  if (totalsByNumber.size === 0) return 0;

  const disc = Math.min(Math.max(discountPct, 0), 100) / 100;

  let gross = 0;
  totalsByNumber.forEach((v) => { gross += Number(v) || 0; });

  const netGross = gross * (1 - disc);
  let cap = Math.floor((netGross + lossMax) / payout);
  if (!Number.isFinite(cap) || cap < 0) cap = 0;

  for (let iter = 0; iter < 30; iter++) {
    let keptGross = 0;
    totalsByNumber.forEach((v) => {
      const amt = Number(v) || 0;
      if (amt <= 0) return;
      keptGross += Math.min(amt, cap);
    });
    const netKept = keptGross * (1 - disc);

    const capNew = Math.floor((netKept + lossMax) / payout);
    const next = Number.isFinite(capNew) && capNew > 0 ? capNew : 0;

    if (next === cap) break;
    cap = next;
  }

  return cap > 0 ? cap : 0;
}

// >> เราใช้ฟังก์ชันเร็วขึ้นแทนการเรียก calcPreview ซ้ำ <<
async function fastCalcThresholds(body: any) {
  const from = new Date(body.from);
  const to = new Date(body.to);
  const convert = !!body.convertTod3ToTop3;
  const mode: 'MANUAL' | 'AUTO' = body.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';

  // ----------------------------------------------
  // 1) โหลดยอดรวมจาก OrderItem ด้วยคิวรีเดียว
  // ----------------------------------------------
  const rows = await prisma.$queryRaw<
    { category: string; number: string; amount: number }[]
  >`
    SELECT
      p.category AS "category",
      p.number   AS "number",
      COALESCE(SUM(oi."sumAmount"), 0)::float AS "amount"
    FROM "OrderItem" oi
    JOIN "Product" p ON p.id = oi."productId"
    WHERE oi."createdAt" >= ${from} AND oi."createdAt" < ${to}
    GROUP BY p.category, p.number
  `;

  const totals: Record<Cat, Map<string, number>> = {
    TOP3: new Map(), TOD3: new Map(), TOP2: new Map(),
    BOTTOM2: new Map(), RUN_TOP: new Map(), RUN_BOTTOM: new Map(),
  };

  for (const r of rows) {
    const cat = r.category as Cat;
    if (!CATS.includes(cat)) continue;
    const num = r.number;
    const amt = Number(r.amount || 0);
    if (amt > 0) totals[cat].set(num, (totals[cat].get(num) || 0) + amt);
  }

  // ----------------------------------------------
  // 2) convert TOD3 → TOP3 ถ้าตั้งไว้
  // ----------------------------------------------
  if (convert) {
    totals.TOD3.forEach((v, num) => {
      const ps = perms3(num);
      const per = Math.round(v / ps.length);
      ps.forEach((n) => totals.TOP3.set(n, (totals.TOP3.get(n) || 0) + per));
    });
    totals.TOD3 = new Map();
  }

  // ----------------------------------------------
  // 3) คำนวณ thresholds (สูตรใหม่)
  // ----------------------------------------------
  const thresholds: Partial<Record<Cat, number>> = {};

  if (mode === 'AUTO') {
    const disc = body.autoDiscountPct || {};
    for (const cat of CATS) {
      if (convert && cat === 'TOD3') {
        thresholds.TOD3 = 0;
        continue;
      }
      const pct = clampPct(disc[cat], DEFAULT_DISCOUNT_PCT[cat] ?? 0);
      thresholds[cat] = solveCapIterative({
        totalsByNumber: totals[cat],
        discountPct: pct,
        payout: PAYOUT[cat] || 0,
        lossMax: LOSS_MAX[cat] || 0,
      });
    }
  } else {
    // manual
    const manual = body.manualThreshold || {};
    for (const cat of CATS) {
      const v = Number(manual[cat] ?? 0);
      thresholds[cat] = Number.isFinite(v) && v > 0 ? v : 0;
    }
    if (convert) thresholds.TOD3 = 0;
  }

  return thresholds;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = body.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const convert = !!body.convertTod3ToTop3;

    // -------------------------------------------------
    // คำนวณ threshold แบบเร็วแทน calcPreview เดิม
    // -------------------------------------------------
    const thresholds = await fastCalcThresholds(body);

    // -------------------------------------------------
    // save เหมือนเดิม (แต่ AUTO เปลี่ยนเป็น %ส่วนลด)
    // -------------------------------------------------
    const rec = await prisma.capRule.create({
      data: {
        mode: mode as any,
        convertTod3ToTop3: convert,

        // ✅ เก็บ %ส่วนลดลง auto*Count เดิม (ไม่แก้ schema)
        autoTop3Count: mode === 'AUTO' ? (body.autoDiscountPct?.TOP3 ?? DEFAULT_DISCOUNT_PCT.TOP3) : null,
        autoTod3Count: mode === 'AUTO' ? (body.autoDiscountPct?.TOD3 ?? DEFAULT_DISCOUNT_PCT.TOD3) : null,
        autoTop2Count: mode === 'AUTO' ? (body.autoDiscountPct?.TOP2 ?? DEFAULT_DISCOUNT_PCT.TOP2) : null,
        autoBottom2Count: mode === 'AUTO' ? (body.autoDiscountPct?.BOTTOM2 ?? DEFAULT_DISCOUNT_PCT.BOTTOM2) : null,
        autoRunTopCount: mode === 'AUTO' ? (body.autoDiscountPct?.RUN_TOP ?? DEFAULT_DISCOUNT_PCT.RUN_TOP) : null,
        autoRunBottomCount: mode === 'AUTO' ? (body.autoDiscountPct?.RUN_BOTTOM ?? DEFAULT_DISCOUNT_PCT.RUN_BOTTOM) : null,

        autoThresholdTop3: mode === 'AUTO' ? (thresholds.TOP3 ?? null) : null,
        autoThresholdTod3: mode === 'AUTO' ? (thresholds.TOD3 ?? null) : null,
        autoThresholdTop2: mode === 'AUTO' ? (thresholds.TOP2 ?? null) : null,
        autoThresholdBottom2: mode === 'AUTO' ? (thresholds.BOTTOM2 ?? null) : null,
        autoThresholdRunTop: mode === 'AUTO' ? (thresholds.RUN_TOP ?? null) : null,
        autoThresholdRunBottom: mode === 'AUTO' ? (thresholds.RUN_BOTTOM ?? null) : null,

        top3: mode === 'MANUAL' ? (body.manualThreshold?.TOP3 ?? null) : null,
        tod3: mode === 'MANUAL' ? (body.manualThreshold?.TOD3 ?? null) : null,
        top2: mode === 'MANUAL' ? (body.manualThreshold?.TOP2 ?? null) : null,
        bottom2: mode === 'MANUAL' ? (body.manualThreshold?.BOTTOM2 ?? null) : null,
        runTop: mode === 'MANUAL' ? (body.manualThreshold?.RUN_TOP ?? null) : null,
        runBottom: mode === 'MANUAL' ? (body.manualThreshold?.RUN_BOTTOM ?? null) : null,

        effectiveAtTop3: new Date(body.from),
        effectiveAtTod3: new Date(body.from),
        effectiveAtTop2: new Date(body.from),
        effectiveAtBottom2: new Date(body.from),
        effectiveAtRunTop: new Date(body.from),
        effectiveAtRunBottom: new Date(body.from),
      },
    });

    return NextResponse.json({
      saved: true,
      thresholds,
      ruleId: rec.id,
    });
  } catch (e: any) {
    console.error('CAP SAVE ERROR', e);
    return new NextResponse(e?.message || 'Cap save error', { status: 500 });
  }
}
