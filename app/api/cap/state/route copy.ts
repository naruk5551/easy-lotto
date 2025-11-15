// app/api/cap/state/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Cat = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';

export async function GET() {
  try {
    const last = await prisma.capRule.findFirst({
      orderBy: { id: 'desc' },
      select: {
        mode: true,
        convertTod3ToTop3: true,
        // auto N
        autoTop3Count: true,
        autoTod3Count: true,
        autoTop2Count: true,
        autoBottom2Count: true,
        autoRunTopCount: true,
        autoRunBottomCount: true,
        // manual threshold
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

    const autoCount: Partial<Record<Cat, number>> = {
      TOP3:      last.autoTop3Count      ?? undefined,
      TOD3:      last.autoTod3Count      ?? undefined,
      TOP2:      last.autoTop2Count      ?? undefined,
      BOTTOM2:   last.autoBottom2Count   ?? undefined,
      RUN_TOP:   last.autoRunTopCount    ?? undefined,
      RUN_BOTTOM:last.autoRunBottomCount ?? undefined,
    };

    const manualThreshold: Partial<Record<Cat, number>> = {
      TOP3:      last.top3      ?? undefined,
      TOD3:      last.tod3      ?? undefined,
      TOP2:      last.top2      ?? undefined,
      BOTTOM2:   last.bottom2   ?? undefined,
      RUN_TOP:   last.runTop    ?? undefined,
      RUN_BOTTOM:last.runBottom ?? undefined,
    };

    return NextResponse.json({
      exists: true,
      mode: last.mode,                      // 'AUTO' | 'MANUAL'
      convertTod3ToTop3: last.convertTod3ToTop3,
      autoCount,
      manualThreshold,
    });
  } catch (e:any) {
    console.error('CAP STATE ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'Cap state error',
      { status: 500 },
    );
  }
}
