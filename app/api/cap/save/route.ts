// app/api/cap/save/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST as calcPreview } from '../preview/route';

// >> เราใช้ฟังก์ชันเร็วขึ้นแทนการเรียก calcPreview ซ้ำ <<
async function fastCalcThresholds(body: any) {
  const from = new Date(body.from);
  const to = new Date(body.to);
  const convert = !!body.convertTod3ToTop3;
  const mode: 'MANUAL' | 'AUTO' = body.mode === 'MANUAL' ? 'MANUAL':'AUTO';

  // ----------------------------------------------
  // 1) โหลดยอดรวมจาก OrderItem ด้วยคิวรีเดียว
  // ----------------------------------------------
  const rows = await prisma.$queryRaw<
    { category: string; number: string; amount: number }[]
  >`
    SELECT
      p.category AS "category",
      p.number   AS "number",
      COALESCE(SUM(oi."sumAmount"), SUM(oi.price), 0)::float AS "amount"
    FROM "OrderItem" oi
    JOIN "Product" p ON p.id = oi."productId"
    WHERE oi."createdAt" >= ${from} AND oi."createdAt" < ${to}
    GROUP BY p.category, p.number
  `;

  const CATS = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'] as const;
  type Cat = typeof CATS[number];

  const totals: Record<Cat, Map<string,number>> = {
    TOP3: new Map(), TOD3: new Map(), TOP2: new Map(),
    BOTTOM2: new Map(), RUN_TOP: new Map(), RUN_BOTTOM: new Map()
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
  function perms3(num: string): string[] {
    if (!num || num.length !== 3) return [num];
    const [a,b,c] = num.split('');
    return Array.from(new Set([
      `${a}${b}${c}`, `${a}${c}${b}`,
      `${b}${a}${c}`, `${b}${c}${a}`,
      `${c}${a}${b}`, `${c}${b}${a}`,
    ]));
  }

  if (convert) {
    totals.TOD3.forEach((v, num) => {
      const ps = perms3(num);
      const per = Math.round(v / ps.length);
      ps.forEach(n => totals.TOP3.set(n, (totals.TOP3.get(n)||0)+per));
    });
    totals.TOD3 = new Map();
  }

  // ----------------------------------------------
  // 3) คำนวณ thresholds เท่านั้น (ไม่ต้องทำ topRanks)
  // ----------------------------------------------
  const thresholds: Partial<Record<Cat, number>> = {};

  if (mode === 'AUTO') {
    const count = body.autoCount || {};
    for (const cat of CATS) {
      const N = Number(count[cat] ?? 0);
      const arr = Array.from(totals[cat]);
      arr.sort((a,b)=>b[1]-a[1]);

      if (N > 0 && arr.length > 0) {
        const topN = arr.slice(0, N);
        thresholds[cat] = topN.reduce(
          (min, x)=> Math.min(min, x[1]),
          Infinity
        );
        if (!Number.isFinite(thresholds[cat]!)) thresholds[cat] = 0;
      } else {
        thresholds[cat] = 0;
      }
    }
    if (convert) thresholds.TOD3 = 0;
  } else {
    // manual
    const manual = body.manualThreshold || {};
    for (const cat of CATS) {
      const v = Number(manual[cat] ?? 0);
      thresholds[cat] = Number.isFinite(v) && v>0 ? v : 0;
    }
    if (convert) thresholds.TOD3 = 0;
  }

  return thresholds;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = body.mode==='MANUAL'?'MANUAL':'AUTO';
    const convert = !!body.convertTod3ToTop3;

    // -------------------------------------------------
    // คำนวณ threshold แบบเร็วแทน calcPreview เดิม
    // -------------------------------------------------
    const thresholds = await fastCalcThresholds(body);

    // -------------------------------------------------
    // save เหมือนเดิมทุกตัวอักษร
    // -------------------------------------------------
    const rec = await prisma.capRule.create({
      data: {
        mode: mode as any,
        convertTod3ToTop3: convert,

        autoTop3Count: body.autoCount?.TOP3 ?? null,
        autoTod3Count: body.autoCount?.TOD3 ?? null,
        autoTop2Count: body.autoCount?.TOP2 ?? null,
        autoBottom2Count: body.autoCount?.BOTTOM2 ?? null,
        autoRunTopCount: body.autoCount?.RUN_TOP ?? null,
        autoRunBottomCount: body.autoCount?.RUN_BOTTOM ?? null,

        autoThresholdTop3: thresholds.TOP3 ?? null,
        autoThresholdTod3: thresholds.TOD3 ?? null,
        autoThresholdTop2: thresholds.TOP2 ?? null,
        autoThresholdBottom2: thresholds.BOTTOM2 ?? null,
        autoThresholdRunTop: thresholds.RUN_TOP ?? null,
        autoThresholdRunBottom: thresholds.RUN_BOTTOM ?? null,

        top3: mode==='MANUAL'? (body.manualThreshold?.TOP3 ?? null):null,
        tod3: mode==='MANUAL'? (body.manualThreshold?.TOD3 ?? null):null,
        top2: mode==='MANUAL'? (body.manualThreshold?.TOP2 ?? null):null,
        bottom2: mode==='MANUAL'? (body.manualThreshold?.BOTTOM2 ?? null):null,
        runTop: mode==='MANUAL'? (body.manualThreshold?.RUN_TOP ?? null):null,
        runBottom: mode==='MANUAL'? (body.manualThreshold?.RUN_BOTTOM ?? null):null,

        effectiveAtTop3: new Date(body.from),
        effectiveAtTod3: new Date(body.from),
        effectiveAtTop2: new Date(body.from),
        effectiveAtBottom2: new Date(body.from),
        effectiveAtRunTop: new Date(body.from),
        effectiveAtRunBottom: new Date(body.from),
      }
    });

    return NextResponse.json({
      saved: true,
      thresholds,
      ruleId: rec.id,
    });

  } catch (e:any) {
    console.error('CAP SAVE ERROR', e);
    return new NextResponse(e?.message || 'Cap save error', { status:500 });
  }
}
