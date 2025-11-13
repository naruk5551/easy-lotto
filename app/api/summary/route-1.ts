// /app/api/summary/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLatestTimeWindow } from '@/lib/timeWindow';

export async function GET() {
  try {
    const tw = await getLatestTimeWindow();
    if (!tw) {
      return new NextResponse('ยังไม่ได้ตั้งช่วงเวลา (time-window)', { status: 404 });
    }

    const startAt = new Date(tw.startAt);
    const endAt   = new Date(tw.endAt);

    // รวมยอดในช่วงเวลา (ใช้ sumAmount ตามสคีมา)
    const agg = await prisma.orderItem.aggregate({
      _sum: { sumAmount: true },
      where: { order: { createdAt: { gte: startAt, lte: endAt } } },
    });

    const total = Number(agg._sum.sumAmount ?? 0);

    // ตัวอย่างตามภาพ: ส่งเจ้ามือ = 0 (สามารถปรับเชื่อม logic ตัดส่งจริงได้ภายหลัง)
    const sendToDealer = 0;
    const keepAmount   = total - sendToDealer;

    return NextResponse.json({
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      total,
      sendToDealer,
      keepAmount,
    });
  } catch (e: any) {
    console.error('GET /api/summary error', e);
    return new NextResponse(e?.message || 'Internal Error', { status: 500 });
  }
}
