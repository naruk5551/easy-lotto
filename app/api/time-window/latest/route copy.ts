import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/time-window/latest
 *
 * ส่งกลับเฉพาะ "รอบที่กำลังเปิดอยู่ตอนนี้"
 * - ถ้าไม่มีรอบที่เวลาครอบคลุมปัจจุบัน ⇒ คืน null
 * - ใช้ compare ด้วยเวลาปัจจุบันฝั่งเซิร์ฟเวอร์ (UTC) ซึ่งสอดคล้องกับ DateTime ของ Prisma
 */
export async function GET() {
  try {
    const now = new Date(); // เวลา ณ ปัจจุบัน (UTC)

    // หา time-window ที่เวลาปัจจุบันอยู่ภายในช่วง
    const active = await prisma.timeWindow.findFirst({
      where: {
        startAt: { lte: now },
        endAt: { gte: now },
      },
      // ถ้ามีทับซ้อนกันหลายช่วง ให้เลือกช่วงที่ "ใกล้สิ้นสุดที่สุด" เพื่อกันกรณีพิเศษ
      orderBy: { endAt: 'asc' },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        note: true,
      },
    });

    // เคลียร์แคชตอบกลับ เพื่อให้หน้า order เห็นสถานะล่าสุดเสมอ
    return NextResponse.json(active, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    console.error('GET /api/time-window/latest error:', e);
    return new NextResponse(e?.message || 'Internal Error', { status: 500 });
  }
}
