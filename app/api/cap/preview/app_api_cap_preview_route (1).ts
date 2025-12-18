// app/api/cap/preview/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Cat = 'TOP3' | 'TOD3' | 'TOP2' | 'BOTTOM2' | 'RUN_TOP' | 'RUN_BOTTOM';
const CATS: Cat[] = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'];

// payout (ราคาถูกรางวัล)
const PAYOUT: Record<Cat, number> = {
  TOP3: 600,
  TOD3: 100,
  TOP2: 70,
  BOTTOM2: 70,
  RUN_TOP: 3,
  RUN_BOTTOM: 4,
};

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

  // AUTO: เปลี่ยนจาก "จำนวนเลข" เป็น "%ส่วนลด" (0..100)
  // รองรับชื่อเดิม autoCount เพื่อไม่ให้ของเก่าพัง (แต่ถือว่าเป็น %ส่วนลดแล้ว)
  autoDiscount?: Partial<Record<Cat, number>>;
  autoCount?: Partial<Record<Cat, number>>;

  // MANUAL: ค่าอั้น (บาท/เลข)
  manualThreshold?: Partial<Record<Cat, number>>;
};

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
        // auto (เก็บเป็น %ส่วนลด)
        autoTop3Count: true,
        autoTod3Count: true,
        autoTop2Count: true,
        autoBottom2Count: true,
        autoRunTopCount: true,
        autoRunBottomCount: true,
      },
    });

    if (!last) return NextResponse.json({ hasCap: false });

    const autoDiscount: Partial<Record<Cat, number>> = {
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
      autoDiscount,
      manualThreshold,
    });
  } catch (e: any) {
    console.error('CAP GET ERROR:', e);
    return new NextResponse(typeof e?.message === 'string' ? e.message : 'Cap get error', { status: 500 });
  }
}

/** permutations ของเลข 3 หลักแบบไม่ซ้ำ */
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

// ---------- POST: preview / preview_and_save ----------
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const from = parseISO(body.from);
    const to = parseISO(body.to);
    if (!from || !to) return NextResponse.json({ error: 'invalid time range' }, { status: 400 });

    const mode: 'MANUAL' | 'AUTO' = body.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const convert = !!body.convertTod3ToTop3;

    // ===== 1) ดึงยอดซื้อแบบสะสมในช่วง from..to (ยอดขายรวมต่อเลขต่อหมวด)
    const rows = await prisma.$queryRaw<{ category: Cat; number: string; amount: number }[]>`
      SELECT
        p.category AS "category",
        p.number   AS "number",
        COALESCE(SUM(oi."sumAmount"), SUM(oi.price), 0)::float AS "amount"
      FROM "OrderItem" oi
      JOIN "Product" p ON p.id = oi."productId"
      WHERE oi."createdAt" >= ${from} AND oi."createdAt" < ${to}
      GROUP BY p.category, p.number
    `;

    const totals: Record<Cat, Map<string, number>> = {
      TOP3: new Map(),
      TOD3: new Map(),
      TOP2: new Map(),
      BOTTOM2: new Map(),
      RUN_TOP: new Map(),
      RUN_BOTTOM: new Map(),
    };

    for (const row of rows) {
      const cat = row.category;
      if (!CATS.includes(cat)) continue;
      const num = row.number;
      const amt = Number(row.amount ?? 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      totals[cat].set(num, (totals[cat].get(num) || 0) + amt);
    }

    // ===== 2) Convert TOD3 -> TOP3 (เพื่อคุมความเสี่ยงแบบเดียวกับ settle/keep)
    if (convert) {
      const tod = totals.TOD3;
      const top = totals.TOP3;

      tod.forEach((v, num) => {
        const list = perms3(num);
        const perEach = Math.round(v / list.length); // ปัดเศษตอนแปลงโต๊ด → บน
        for (const nn of list) top.set(nn, (top.get(nn) || 0) + perEach);
      });

      totals.TOD3 = new Map(); // ถือว่า TOD3 ถูกแปลงทิ้งแล้ว
    }

    // ===== 3) จำนวนเลขทั้งหมดตามจริง (หลัง convert)
    const countNumbers: Partial<Record<Cat, number>> = {};
    for (const cat of CATS) countNumbers[cat] = totals[cat].size;

    // ===== 4) คำนวณ threshold
    const thresholds: Partial<Record<Cat, number>> = {};
    const grossByCat: Partial<Record<Cat, number>> = {};

    if (mode === 'AUTO') {
      const discounts = body.autoDiscount ?? body.autoCount ?? {};
      for (const cat of CATS) {
        // ยอดรับ (สะสม) ของหมวด = รวมยอดทั้งหมดของหมวดนั้น
        const gross = Array.from(totals[cat].values()).reduce((s, v) => s + Number(v || 0), 0);
        grossByCat[cat] = gross;

        const discPct = Number(discounts[cat] ?? 0);
        const disc = Number.isFinite(discPct) ? Math.min(Math.max(discPct, 0), 100) : 0;

        // สูตร: ยอดอั้น(บาท/เลข) = round( ยอดรับรวม * (1-ส่วนลด) / ราคาถูกรางวัล )
        const payout = PAYOUT[cat] || 1;
        const cap = payout > 0 ? Math.round((gross * (1 - disc / 100)) / payout) : 0;

        thresholds[cat] = Number.isFinite(cap) && cap > 0 ? cap : 0;
      }
      if (convert) thresholds.TOD3 = 0;
    } else {
      const manual = body.manualThreshold || {};
      for (const cat of CATS) {
        const v = Number(manual[cat] ?? 0);
        thresholds[cat] = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
      }
      if (convert) thresholds.TOD3 = 0;
    }

    // ===== 5) preview_and_save: บันทึก CapRule (เก็บ %ส่วนลดลงฟิลด์ auto*Count เดิม)
    if (body.action === 'preview_and_save') {
      const discounts = body.autoDiscount ?? body.autoCount ?? {};
      await prisma.capRule.create({
        data: {
          mode: mode as any,
          convertTod3ToTop3: convert,

          autoTop3Count: mode === 'AUTO' ? (discounts.TOP3 ?? null) : null,
          autoTod3Count: mode === 'AUTO' ? (discounts.TOD3 ?? null) : null,
          autoTop2Count: mode === 'AUTO' ? (discounts.TOP2 ?? null) : null,
          autoBottom2Count: mode === 'AUTO' ? (discounts.BOTTOM2 ?? null) : null,
          autoRunTopCount: mode === 'AUTO' ? (discounts.RUN_TOP ?? null) : null,
          autoRunBottomCount: mode === 'AUTO' ? (discounts.RUN_BOTTOM ?? null) : null,

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
      countNumbers,
      grossByCat,
    });
  } catch (e: any) {
    console.error('CAP ERROR:', e);
    return new NextResponse(typeof e?.message === 'string' ? e.message : 'Cap error', { status: 500 });
  }
}
