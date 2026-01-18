// app/api/cap/preview/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Cat = 'TOP3' | 'TOD3' | 'TOP2' | 'BOTTOM2' | 'RUN_TOP' | 'RUN_BOTTOM';
const CATS: Cat[] = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'];

function parseISO(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

type Body = {
  action: 'preview' | 'preview_and_save';
  mode: 'MANUAL' | 'AUTO';
  convertTod3ToTop3?: boolean;
  from: string;
  to: string;

  // ✅ AUTO: เปลี่ยนจาก "จำนวนเลข" เป็น "%ส่วนลด"
  // เก็บเป็น "เปอร์เซ็นต์" เช่น 30 = 30%
  autoDiscountPct?: Partial<Record<Cat, number>>;

  // MANUAL: threshold ต่อหมวด
  manualThreshold?: Partial<Record<Cat, number>>;
};

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

// ===== จำนวน Top-N ที่แสดงเพื่อดู (ไม่เกี่ยวกับสูตร) =====
const TOPN_DISPLAY: Record<Cat, number> = {
  TOP3: 30,
  TOD3: 30,
  TOP2: 10,
  BOTTOM2: 10,
  RUN_TOP: 5,
  RUN_BOTTOM: 5,
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
 *
 * แนวคิด:
 * - keep ต่อเลข = min(total_i, cap)
 * - รายรับสุทธิ (netKept) = sum(min(total_i, cap)) * (1 - discount)
 * - จำกัดขาดทุน: payout*cap - netKept <= lossMax
 *   => payout*cap <= netKept + lossMax
 * - เพราะ netKept ขึ้นกับ cap จึง iterate หา fixed-point
 *
 * ปัดเศษ:
 * - cap เป็น "บาทเต็ม" (integer)
 * - ใช้ floor เมื่อคำนวณ cap จากสมการ เพื่อไม่ให้เกินเพดานความเสี่ยง
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

  // gross (ดิบ) เพื่อใช้เดา cap เริ่มต้น
  let gross = 0;
  totalsByNumber.forEach((v) => { gross += Number(v) || 0; });

  // เดาเริ่มต้น: ใช้ netGross + lossMax แล้วหาร payout
  const netGross = gross * (1 - disc);
  let cap = Math.floor((netGross + lossMax) / payout);
  if (!Number.isFinite(cap) || cap < 0) cap = 0;

  // iterate หา cap ที่นิ่ง
  // หมายเหตุ: cap อาจ "ลด" ลงเมื่อ cap ลดแล้ว netKept ลดลง -> วนจนคงที่
  for (let iter = 0; iter < 30; iter++) {
    // netKept จาก cap ปัจจุบัน
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

// ---------- GET: ดึง CapRule แถวล่าสุด ----------
export async function GET() {
  try {
    const last = await prisma.capRule.findFirst({
      orderBy: { id: 'desc' },
      select: {
        mode: true,
        convertTod3ToTop3: true,

        // manual
        top3: true,
        tod3: true,
        top2: true,
        bottom2: true,
        runTop: true,
        runBottom: true,

        // ✅ ใช้คอลัมน์ auto*Count เดิม เพื่อ "เก็บส่วนลดเปอร์เซ็นต์" (ไม่แก้ schema)
        autoTop3Count: true,
        autoTod3Count: true,
        autoTop2Count: true,
        autoBottom2Count: true,
        autoRunTopCount: true,
        autoRunBottomCount: true,
      },
    });

    if (!last) {
      return NextResponse.json({ hasCap: false });
    }

    // ✅ ส่งกลับเป็น autoDiscountPct
    const autoDiscountPct: Partial<Record<Cat, number>> = {
      TOP3: last.autoTop3Count ?? undefined,
      TOD3: last.autoTod3Count ?? undefined,
      TOP2: last.autoTop2Count ?? undefined,
      BOTTOM2: last.autoBottom2Count ?? undefined,
      RUN_TOP: last.autoRunTopCount ?? undefined,
      RUN_BOTTOM: last.autoRunBottomCount ?? undefined,
    };

    const manualThreshold: Partial<Record<Cat, number>> = {
      TOP3: last.top3 ?? undefined,
      TOD3: last.tod3 ?? undefined,
      TOP2: last.top2 ?? undefined,
      BOTTOM2: last.bottom2 ?? undefined,
      RUN_TOP: last.runTop ?? undefined,
      RUN_BOTTOM: last.runBottom ?? undefined,
    };

    return NextResponse.json({
      hasCap: true,
      mode: last.mode,
      convertTod3ToTop3: !!last.convertTod3ToTop3,
      autoDiscountPct,
      manualThreshold,
    });
  } catch (e: any) {
    console.error('CAP GET ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'Cap get error',
      { status: 500 },
    );
  }
}

// ---------- POST: preview / preview_and_save ----------
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const from = parseISO(body.from);
    const to = parseISO(body.to);
    if (!from || !to) {
      return NextResponse.json({ error: 'invalid time range' }, { status: 400 });
    }

    const mode: 'MANUAL' | 'AUTO' = body.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const convert = !!body.convertTod3ToTop3;

    // --- เตรียมยอดรวมต่อเลขต่อหมวดจาก OrderItem (คิวรีเดียว JOIN Product)
    const rows = await prisma.$queryRaw<
      { category: Cat; number: string; amount: number }[]
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

    // cat -> Map<numberString, totalGross>
    const totals: Record<Cat, Map<string, number>> = {
      TOP3: new Map(), TOD3: new Map(), TOP2: new Map(),
      BOTTOM2: new Map(), RUN_TOP: new Map(), RUN_BOTTOM: new Map(),
    };

    for (const row of rows) {
      const cat = row.category;
      if (!CATS.includes(cat)) continue;
      const num = row.number;
      const amt = Number(row.amount ?? 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      totals[cat].set(num, (totals[cat].get(num) || 0) + amt);
    }

    // --- แปลง 3 โต๊ด → 3 ตัวบน (ทั้ง MANUAL/AUTO เมื่อ convert=true)
    if (convert) {
      const tod = totals.TOD3;
      const top = totals.TOP3;

      tod.forEach((v, num) => {
        const list = perms3(num);
        const perEach = Math.round(v / list.length); // ปัดเศษตอนแปลงโต๊ด → บน
        for (const nn of list) {
          top.set(nn, (top.get(nn) || 0) + perEach);
        }
      });

      totals.TOD3 = new Map(); // แปลงทิ้ง
    }

    // --- นับจำนวนเลขทั้งหมดต่อหมวด (หลัง convert แล้ว)
    const countNumbers: Partial<Record<Cat, number>> = {};
    for (const cat of CATS) {
      countNumbers[cat] = totals[cat].size;
    }
    if (convert) countNumbers.TOD3 = 0;

    // --- สร้าง TopRanks เพื่อ "แสดงผล" เท่านั้น (ไม่เกี่ยวกับการคำนวณ threshold)
    const topRanks: Partial<Record<Cat, Array<{ number: string; total: number }>>> = {};
    for (const cat of CATS) {
      const arr = Array.from(totals[cat]).map(([number, total]) => ({ number, total }));
      arr.sort((a, b) => b.total - a.total);
      topRanks[cat] = arr.slice(0, TOPN_DISPLAY[cat]);
    }
    if (convert) topRanks.TOD3 = [];

    // --- คำนวณ threshold
    const thresholds: Partial<Record<Cat, number>> = {};

    if (mode === 'AUTO') {
      const disc = body.autoDiscountPct || {};
      for (const cat of CATS) {
        if (convert && cat === 'TOD3') {
          thresholds.TOD3 = 0;
          continue;
        }

        const pct = clampPct(disc[cat], DEFAULT_DISCOUNT_PCT[cat] ?? 0);

        // ✅ solve แบบ iterate ให้สมการเป็นจริง + ปัดเศษบาทเต็ม
        const cap = solveCapIterative({
          totalsByNumber: totals[cat],
          discountPct: pct,
          payout: PAYOUT[cat] || 0,
          lossMax: LOSS_MAX[cat] || 0,
        });

        thresholds[cat] = cap > 0 ? cap : 0;
      }
    } else {
      const manual = body.manualThreshold || {};
      for (const cat of CATS) {
        const v = Number(manual[cat] ?? 0);
        thresholds[cat] = Number.isFinite(v) && v > 0 ? v : 0;
      }
      if (convert) thresholds.TOD3 = 0;
    }

    // --- ถ้าบันทึก ให้ create capRule ใหม่
    if (body.action === 'preview_and_save') {
      await prisma.capRule.create({
        data: {
          mode: mode as any,
          convertTod3ToTop3: convert,

          // ✅ เก็บส่วนลดเปอร์เซ็นต์ลงช่อง auto*Count เดิม (ไม่แก้ schema)
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

          effectiveAtTop3: from,
          effectiveAtTod3: from,
          effectiveAtTop2: from,
          effectiveAtBottom2: from,
          effectiveAtRunTop: from,
          effectiveAtRunBottom: from,
        },
      });
    }

    return NextResponse.json({
      mode,
      convertTod3ToTop3: convert,
      from: from.toISOString(),
      to: to.toISOString(),
      thresholds,
      topRanks,        // ✅ แสดงเพื่อดูเท่านั้น
      countNumbers,    // ✅ จำนวนเลขทั้งหมดตามจริง
      payout: PAYOUT,
      lossMax: LOSS_MAX,
      autoDiscountPct: body.autoDiscountPct ?? null,
    });
  } catch (e: any) {
    console.error('CAP ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'Cap error',
      { status: 500 },
    );
  }
}
