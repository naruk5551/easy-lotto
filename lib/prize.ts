// /lib/prize.ts
import { Category } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type PrizeSetting = {
  top3: string;
  bottom2: string;
  payoutTop3: number;
  payoutTod3: number;
  payoutTop2: number;
  payoutBottom2: number;
  payoutRunTop: number;
  payoutRunBottom: number;
};

// ===== Helpers =====
export function hitCountRunTop(digit: string, top3: string) {
  return top3.split('').filter((d) => d === digit).length; // 0..3
}
export function hitCountRunBottom(digit: string, bottom2: string) {
  return bottom2.split('').filter((d) => d === digit).length; // 0..2
}
export function isTop3Win(num: string, top3: string) {
  return num === top3;
}
export function isTod3Win(num: string, top3: string) {
  const sort = (s: string) => s.split('').sort().join('');
  return num.length === 3 && sort(num) === sort(top3);
}
export function isTop2Win(num: string, top3: string) {
  return num === top3.slice(1, 3); // 2 ตัวท้ายของ 3 ตัวบน
}
export function isBottom2Win(num: string, bottom2: string) {
  return num === bottom2;
}

const keyOf = (cat: string, num: string) => `${cat}|${num}`;

/**
 * รวม inflow (OrderItem.sumAmount) และ shouldSend (ExcessBuy.amount) ต่อเลข/หมวด ในช่วงเวลา
 * คืน Map key=`${category}|${number}` -> { inflow, shouldSend }
 */
export async function collectFlows(from: Date, to: Date) {
  // ---- inflow จาก OrderItem ----
  const items = (await prisma.orderItem.groupBy({
    // Prisma บางเวอร์ชันเข้มงวด type ของ `by` → ใส่ cast ให้ชัด
    by: ['productId'] as any,
    where: { createdAt: { gte: from, lt: to } },
    _sum: { sumAmount: true },
  } as any)) as Array<{ productId: number | null; _sum: { sumAmount: any } }>;

  if (items.length === 0)
    return new Map<string, { inflow: number; shouldSend: number }>();

  // productId ของ inflow (กรอง null ออก ให้เป็น number[])
  const productIds: number[] = items
    .map((i) => i.productId)
    .filter((v): v is number => typeof v === 'number');

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, category: true, number: true },
  });
  const pById = new Map(products.map((p) => [p.id, p]));

  const map = new Map<string, { inflow: number; shouldSend: number }>();
  for (const it of items) {
    if (typeof it.productId !== 'number') continue;
    const p = pById.get(it.productId);
    if (!p) continue;
    const key = keyOf(p.category, p.number);
    const inflow = Number(it._sum?.sumAmount ?? 0);
    const prev = map.get(key) || { inflow: 0, shouldSend: 0 };
    map.set(key, { inflow: prev.inflow + inflow, shouldSend: prev.shouldSend });
  }

  // ---- shouldSend จาก ExcessBuy ของ batch (งวด) ----
  const batch = await prisma.settleBatch.findFirst({
    where: { from, to },
    select: { id: true },
  });

  if (batch) {
    const sent = (await prisma.excessBuy.groupBy({
      by: ['productId'] as any,
      where: { batchId: batch.id },
      _sum: { amount: true },
    } as any)) as Array<{ productId: number | null; _sum: { amount: any } }>;

    const sentIds: number[] = sent
      .map((s) => s.productId)
      .filter((v): v is number => typeof v === 'number');

    if (sentIds.length) {
      const sentProducts = await prisma.product.findMany({
        where: { id: { in: sentIds } },
        select: { id: true, category: true, number: true },
      });
      const sById = new Map(sentProducts.map((p) => [p.id, p]));

      for (const s of sent) {
        if (typeof s.productId !== 'number') continue;
        const p = sById.get(s.productId);
        if (!p) continue;
        const key = keyOf(p.category, p.number);
        const amt = Number(s._sum?.amount ?? 0);
        const prev = map.get(key) || { inflow: 0, shouldSend: 0 };
        map.set(key, { inflow: prev.inflow, shouldSend: prev.shouldSend + amt });
      }
    }
  }

  return map;
}

/**
 * คำนวณยอด "รางวัลที่ถูก"
 *  - prizeDealer: ยอดที่เจ้ามือต้องจ่าย (ส่วนที่ส่งไป)
 *  - prizeSelf:   ยอดที่ร้านต้องจ่ายเอง (ส่วนที่รับเอง)
 *  - prizeTotal:  รวมสองส่วน
 */
export async function computePrizeTotal(
  prize: PrizeSetting,
  from: Date,
  to: Date
) {
  const flows = await collectFlows(from, to);

  let totalDealer = 0;
  let totalSelf = 0;

  for (const [key, v] of flows) {
    const [category, number] = key.split('|');
    const inflow = Math.max(0, Number(v.inflow || 0));
    const sent = Math.min(Math.max(0, Number(v.shouldSend || 0)), inflow);
    const keep = Math.max(0, inflow - sent);

    let unitDealer = 0;
    let unitSelf = 0;

    switch (category as Category) {
      case 'TOP3':
        if (isTop3Win(number, prize.top3)) {
          unitDealer = prize.payoutTop3;
          unitSelf = prize.payoutTop3;
        }
        break;
      case 'TOD3':
        if (isTod3Win(number, prize.top3)) {
          unitDealer = prize.payoutTod3;
          unitSelf = prize.payoutTod3;
        }
        break;
      case 'TOP2':
        if (isTop2Win(number, prize.top3)) {
          unitDealer = prize.payoutTop2;
          unitSelf = prize.payoutTop2;
        }
        break;
      case 'BOTTOM2':
        if (isBottom2Win(number, prize.bottom2)) {
          unitDealer = prize.payoutBottom2;
          unitSelf = prize.payoutBottom2;
        }
        break;
      case 'RUN_TOP': {
        const cnt = hitCountRunTop(number, prize.top3); // number = '0'..'9'
        if (cnt > 0) {
          unitDealer = prize.payoutRunTop * cnt;
          unitSelf = prize.payoutRunTop * cnt;
        }
        break;
      }
      case 'RUN_BOTTOM': {
        const cnt = hitCountRunBottom(number, prize.bottom2);
        if (cnt > 0) {
          unitDealer = prize.payoutRunBottom * cnt;
          unitSelf = prize.payoutRunBottom * cnt;
        }
        break;
      }
    }

    totalDealer += sent * unitDealer;
    totalSelf += keep * unitSelf;
  }

  return {
    prizeDealer: Math.round(totalDealer),
    prizeSelf: Math.round(totalSelf),
    prizeTotal: Math.round(totalDealer + totalSelf),
  };
}
