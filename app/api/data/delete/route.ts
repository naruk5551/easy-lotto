// app/api/data/delete/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

/**
 * ลบข้อมูล “ทั้งงวด” ตาม timeWindowId ที่รับมา
 * เก็บ TimeWindow ไว้ แต่ลบ:
 * - Order / OrderItem (ภายในช่วงเวลา)
 * - ExcessBuy (ทุกใบที่อ้างอิง SettleBatch ที่ซ้อนทับช่วงงวด + ที่สร้างภายในงวดแม้ไม่ผูก batch)
 * - SettleBatch (ทุก batch ที่ "ซ้อนทับ" ช่วงงวด ไม่ต้องเท่ากับขอบงวดเป๊ะ)
 * - AcceptSelf (ภายในช่วงเวลา)
 * - PrizeSetting (ของงวด)
 * - SettleRun (ของงวด)
 *
 * หมายเหตุ: ใช้ช่วงเวลาแบบ [startAt .. endAt) คือ gte startAt และ lt endAt
 * Overlap ของ SettleBatch คือ:  from < endAt  &&  to > startAt
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const timeWindowId = Number(body?.timeWindowId || 0);
    if (!timeWindowId) {
      return new NextResponse('ต้องระบุ timeWindowId', { status: 400 });
    }

    // ดึงช่วงงวด
    const tw = await prisma.timeWindow.findUnique({
      where: { id: timeWindowId },
      select: { id: true, startAt: true, endAt: true },
    });
    if (!tw) {
      return new NextResponse('ไม่พบ TimeWindow', { status: 404 });
    }

    // keep ช่วงให้ชัด (ใช้ [start..end) เสมอ)
    const startAt: Date = tw.startAt;
    const endAt: Date = tw.endAt;

    const result = {
      orders: 0,
      excessBuy: 0,
      settleBatch: 0,
      acceptSelf: 0,
      prizeSetting: 0,
      settleRun: 0,
      affectedBatchIds: [] as number[],
    };

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // ----- 1) ลบ Order (+Items via Cascade) ภายในช่วงงวด -----
      const ordersInRange = await tx.order.findMany({
        where: { createdAt: { gte: startAt, lt: endAt } },
        select: { id: true },
      });
      result.orders = ordersInRange.length;

      await tx.order.deleteMany({
        where: { createdAt: { gte: startAt, lt: endAt } },
      });

      // ----- 2) หา SettleBatch ที่ "ซ้อนทับ" ช่วงงวด แล้วลบ ExcessBuy ของ batch เหล่านี้ -----
      // overlap: from < endAt && to > startAt
      const batches = await tx.settleBatch.findMany({
        where: {
          from: { lt: endAt },
          to: { gt: startAt },
        },
        select: { id: true },
      });

      const batchIds = batches.map((b) => b.id);
      result.affectedBatchIds = batchIds;

      if (batchIds.length > 0) {
        const delExByBatch = await tx.excessBuy.deleteMany({
          where: { batchId: { in: batchIds } },
        });
        result.excessBuy += delExByBatch.count;

        const delBatch = await tx.settleBatch.deleteMany({
          where: { id: { in: batchIds } },
        });
        result.settleBatch += delBatch.count;
      }

      // ลบ ExcessBuy ที่สร้างภายในช่วงงวด แต่ไม่ผูก batch
      const delExByTime = await tx.excessBuy.deleteMany({
        where: {
          batchId: null,
          createdAt: { gte: startAt, lt: endAt },
        },
      });
      result.excessBuy += delExByTime.count;

      // ----- 3) ลบ AcceptSelf ภายในช่วงงวด -----
      const delKeep = await tx.acceptSelf.deleteMany({
        where: { createdAt: { gte: startAt, lt: endAt } },
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

    return NextResponse.json({
      ok: true,
      timeWindowId: tw.id,
      deleted: result,
    });
  } catch (e: any) {
    console.error('DELETE DATA BY TIMEWINDOW ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'ลบข้อมูลไม่สำเร็จ',
      { status: 500 },
    );
  }
}
