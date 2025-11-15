import { prisma } from '@/lib/db';
import { Category } from '@prisma/client';

export type CatTotals = Record<Category, { number: string; total: number }[]>;

export async function getTotalsByCategory(timeWindowId: number): Promise<{
  range: { startAt: Date; endAt: Date };
  data: CatTotals;
}> {
  // 1) หา time window ตาม id (เหมือนเดิม)
  const tw = await prisma.timeWindow.findUnique({ where: { id: timeWindowId } });
  if (!tw) throw new Error('TIME_WINDOW_NOT_FOUND');

  // 2) ให้ DB รวมยอด sumAmount ต่อ (category, number) ให้เลย
  const rows = await prisma.$queryRaw<
    { category: Category; number: string; total: number }[]
  >`
    SELECT
      p."category" AS "category",
      p."number"   AS "number",
      COALESCE(SUM(oi."sumAmount"), 0)::float AS "total"
    FROM "OrderItem" oi
    JOIN "Order"   o ON oi."orderId"   = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" >= ${tw.startAt}
      AND o."createdAt" <= ${tw.endAt}
    GROUP BY p."category", p."number"
  `;

  // 3) เตรียม map ตาม type เดิม
  const map: CatTotals = {
    TOP3: [], TOD3: [], TOP2: [], BOTTOM2: [], RUN_TOP: [], RUN_BOTTOM: [],
  };

  // 4) ใส่ข้อมูลลงหมวดตามเดิม
  for (const r of rows) {
    // r.category เป็น enum Category อยู่แล้ว
    map[r.category].push({
      number: r.number,
      total: Number(r.total),
    });
  }

  // 5) เรียงมาก→น้อย ในแต่ละหมวด (behavior เดิม)
  (Object.keys(map) as Category[]).forEach(cat => {
    map[cat].sort((a, b) => b.total - a.total);
  });

  return {
    range: { startAt: tw.startAt, endAt: tw.endAt },
    data: map,
  };
}
