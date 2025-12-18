// app/api/cap/state/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Cat = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';
const CATS: Cat[] = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'];

export async function GET() {
  try {
    // >>> เอาแถวล่าสุดแถวเดียว
    const last = await prisma.capRule.findFirst({
      orderBy: { id: 'desc' },
      select: {
        mode: true,
        convertTod3ToTop3: true,

        // AUTO (เก็บในช่องเดิม แต่ตีความเป็น % ส่วนลด)
        autoTop3Count: true,
        autoTod3Count: true,
        autoTop2Count: true,
        autoBottom2Count: true,
        autoRunTopCount: true,
        autoRunBottomCount: true,

        // MANUAL
        top3: true,
        tod3: true,
        top2: true,
        bottom2: true,
        runTop: true,
        runBottom: true,
      },
    });

    if (!last) {
      return NextResponse.json({ exists: false });
    }

    // ---------------------------------------------
    // AUTO → autoDiscountPct  (สำคัญ)
    // ---------------------------------------------
    const autoDiscountPct: Partial<Record<Cat, number>> = {};
    const autoVals = [
      last.autoTop3Count,
      last.autoTod3Count,
      last.autoTop2Count,
      last.autoBottom2Count,
      last.autoRunTopCount,
      last.autoRunBottomCount,
    ];

    for (let i = 0; i < CATS.length; i++) {
      const v = autoVals[i];
      if (v != null) autoDiscountPct[CATS[i]] = v;
    }

    // ---------------------------------------------
    // MANUAL (เหมือนเดิม 100%)
    // ---------------------------------------------
    const manualThreshold: Partial<Record<Cat, number>> = {};
    const manualVals = [
      last.top3,
      last.tod3,
      last.top2,
      last.bottom2,
      last.runTop,
      last.runBottom,
    ];

    for (let i = 0; i < CATS.length; i++) {
      const v = manualVals[i];
      if (v != null) manualThreshold[CATS[i]] = v;
    }

    return NextResponse.json({
      exists: true,
      mode: last.mode,
      convertTod3ToTop3: !!last.convertTod3ToTop3,

      // ✅ ชื่อใหม่ให้ตรงกับ preview / save
      autoDiscountPct,

      // ✅ manual ไม่เปลี่ยน
      manualThreshold,
    });

  } catch (e: any) {
    console.error('CAP STATE ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'Cap state error',
      { status: 500 },
    );
  }
}
