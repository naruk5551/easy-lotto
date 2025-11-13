// app/api/data/delete/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * ลบข้อมูล “ทั้งงวด” ตาม timeWindowId ที่รับมา
 * เก็บโครงสร้าง TimeWindow ไว้ แต่ลบ:
 * - Order / OrderItem (ช่วงเวลาในงวด)
 * - ExcessBuy (ของ batch งวดนี้ และ/หรือที่สร้างภายในช่วงเวลา)
 * - SettleBatch (งวดนี้)   ✅ เพิ่มให้ตามคำขอ
 * - AcceptSelf (ช่วงเวลาในงวด)
 * - PrizeSetting (ของงวดนี้)
 * - SettleRun (ของงวดนี้)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const timeWindowId = Number(body?.timeWindowId || 0);
    if (!timeWindowId) {
      return new NextResponse('ต้องระบุ timeWindowId', { status: 400 });
    }

    // โหลดช่วงเวลา
    const tw = await prisma.timeWindow.findUnique({
      where: { id: timeWindowId },
      select: { id: true, startAt: true, endAt: true },
    });
    if (!tw) {
      return new NextResponse('ไม่พบ TimeWindow', { status: 404 });
    }

    // เก็บสถิติจำนวนที่ลบ
    const result = {
      orders: 0,
      orderItems: 0, // อ้างอิงไว้เพื่อความชัด แม้จะลบแบบ cascade
      excessBuy: 0,
      settleBatch: 0,
      acceptSelf: 0,
      prizeSetting: 0,
      settleRun: 0,
    };

    await prisma.$transaction(async (tx) => {
      // ----- 1) ลบ Order (+Item cascade) ภายในช่วงเวลา -----
      // หา id order เพื่อนับให้ถูกต้อง (ลบจริงใช้ deleteMany)
      const orders = await tx.order.findMany({
        where: { createdAt: { gte: tw.startAt, lt: tw.endAt } },
        select: { id: true },
      });
      result.orders = orders.length;

      // ลบ (OrderItem จะ cascade ตามสคีมา)
      await tx.order.deleteMany({
        where: { createdAt: { gte: tw.startAt, lt: tw.endAt } },
      });

      // ----- 2) ลบ ExcessBuy + SettleBatch ของงวดนี้ -----
      // หา batch id ของงวดนี้ (จาก from/to = ขอบเขตงวด)
      const batches = await tx.settleBatch.findMany({
        where: { from: tw.startAt, to: tw.endAt },
        select: { id: true },
      });
      const batchIds = batches.map((b) => b.id);

      if (batchIds.length > 0) {
        // ลบ ExcessBuy ที่อ้างอิง batch เหล่านี้
        const delEx = await tx.excessBuy.deleteMany({
          where: { batchId: { in: batchIds } },
        });
        result.excessBuy += delEx.count;
      }

      // เผื่อมี ExcessBuy ที่ถูกสร้าง “แบบไม่ผูก batch” ภายในช่วงเวลา ให้ลบทิ้งด้วย
      const delExByTime = await tx.excessBuy.deleteMany({
        where: {
          batchId: null,
          createdAt: { gte: tw.startAt, lt: tw.endAt },
        },
      });
      result.excessBuy += delExByTime.count;

      // ✅ ลบ SettleBatch ของงวดนี้
      const delBatch = await tx.settleBatch.deleteMany({
        where: { from: tw.startAt, to: tw.endAt },
      });
      result.settleBatch += delBatch.count;

      // ----- 3) ลบ AcceptSelf ภายในช่วงเวลา -----
      const delKeep = await tx.acceptSelf.deleteMany({
        where: { createdAt: { gte: tw.startAt, lt: tw.endAt } },
      });
      result.acceptSelf += delKeep.count;

      // ----- 4) ลบ PrizeSetting / SettleRun ของงวดนี้ -----
      const delPrize = await tx.prizeSetting.deleteMany({
        where: { timeWindowId: tw.id },
      });
      result.prizeSetting += delPrize.count;

      const delRun = await tx.settleRun.deleteMany({
        where: { timeWindowId: tw.id },
      });
      result.settleRun += delRun.count;
    });

    return NextResponse.json({ ok: true, timeWindowId: tw.id, deleted: result });
  } catch (e: any) {
    console.error('DELETE DATA BY TIMEWINDOW ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'ลบข้อมูลไม่สำเร็จ',
      { status: 500 },
    );
  }
}
