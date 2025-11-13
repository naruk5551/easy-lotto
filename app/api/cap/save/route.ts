export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST as calcPreview } from '../preview/route';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = body.mode==='MANUAL'?'MANUAL':'AUTO';
    const convert = !!body.convertTod3ToTop3;

    // เรียกคำนวณ preview ก่อนบันทึก (reuse logic เดิม)
    const previewReq = new Request(req.url, {
      method:'POST', headers:req.headers, body: JSON.stringify(body)
    });
    const previewRes = await calcPreview(previewReq);
    const data = await previewRes.json();

    // บันทึก CapRule ใหม่
    const record = await prisma.capRule.create({
      data: {
        mode: mode as any,
        convertTod3ToTop3: convert,
        autoTop3Count: body.autoCount?.TOP3 ?? null,
        autoTod3Count: body.autoCount?.TOD3 ?? null,
        autoTop2Count: body.autoCount?.TOP2 ?? null,
        autoBottom2Count: body.autoCount?.BOTTOM2 ?? null,
        autoRunTopCount: body.autoCount?.RUN_TOP ?? null,
        autoRunBottomCount: body.autoCount?.RUN_BOTTOM ?? null,
        autoThresholdTop3: data.thresholds.TOP3 ?? null,
        autoThresholdTod3: data.thresholds.TOD3 ?? null,
        autoThresholdTop2: data.thresholds.TOP2 ?? null,
        autoThresholdBottom2: data.thresholds.BOTTOM2 ?? null,
        autoThresholdRunTop: data.thresholds.RUN_TOP ?? null,
        autoThresholdRunBottom: data.thresholds.RUN_BOTTOM ?? null,
        top3: mode==='MANUAL' ? (body.manualThreshold?.TOP3 ?? null) : null,
        tod3: mode==='MANUAL' ? (body.manualThreshold?.TOD3 ?? null) : null,
        top2: mode==='MANUAL' ? (body.manualThreshold?.TOP2 ?? null) : null,
        bottom2: mode==='MANUAL' ? (body.manualThreshold?.BOTTOM2 ?? null) : null,
        runTop: mode==='MANUAL' ? (body.manualThreshold?.RUN_TOP ?? null) : null,
        runBottom: mode==='MANUAL' ? (body.manualThreshold?.RUN_BOTTOM ?? null) : null,
        effectiveAtTop3: new Date(body.from),
        effectiveAtTod3: new Date(body.from),
        effectiveAtTop2: new Date(body.from),
        effectiveAtBottom2: new Date(body.from),
        effectiveAtRunTop: new Date(body.from),
        effectiveAtRunBottom: new Date(body.from),
      }
    });

    return NextResponse.json({
      ...data,
      saved: true,
      ruleId: record.id,
    });
  } catch (e:any) {
    console.error('CAP SAVE ERROR', e);
    return new NextResponse(e?.message||'Cap save error',{status:500});
  }
}
