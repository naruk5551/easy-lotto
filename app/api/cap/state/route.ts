// app/api/cap/state/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Cat = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';

const CATS: Cat[] = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'];

export async function GET() {
  try {
    // >>> โจทย์คือหาแถวล่าสุดเพียง 1 แถว เท่านั้น
    const last = await prisma.capRule.findFirst({
      orderBy: { id: 'desc' },
      select: {
        mode: true,
        convertTod3ToTop3: true,
        autoTop3Count: true,   autoTod3Count: true,
        autoTop2Count: true,   autoBottom2Count: true,
        autoRunTopCount: true, autoRunBottomCount: true,
        top3: true, tod3: true, top2: true,
        bottom2: true, runTop: true, runBottom: true,
      },
    });

    if (!last) {
      return NextResponse.json({ exists: false });
    }

    // ---------------------------------------------
    // FAST building: autoCount / manualThreshold
    // เทียบเท่าของเดิมทุกค่า แต่ใช้ loop แทน assign ทีละตัว
    // ---------------------------------------------
    const autoRaw = [
      last.autoTop3Count,
      last.autoTod3Count,
      last.autoTop2Count,
      last.autoBottom2Count,
      last.autoRunTopCount,
      last.autoRunBottomCount,
    ];

    const manualRaw = [
      last.top3,
      last.tod3,
      last.top2,
      last.bottom2,
      last.runTop,
      last.runBottom,
    ];

    const autoCount: Partial<Record<Cat, number>> = {};
    const manualThreshold: Partial<Record<Cat, number>> = {};

    for (let i = 0; i < CATS.length; i++) {
      const cat = CATS[i];
      const a = autoRaw[i];
      const m = manualRaw[i];

      if (a != null) autoCount[cat] = a;
      if (m != null) manualThreshold[cat] = m;
    }

    // ---------------------------------------------
    // ตอบกลับ JSON (เบากว่า, เร็วกว่า, แต่ข้อมูลเดิม 100%)
    // ---------------------------------------------
    return NextResponse.json({
      exists: true,
      mode: last.mode,
      convertTod3ToTop3: last.convertTod3ToTop3,
      autoCount,
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
