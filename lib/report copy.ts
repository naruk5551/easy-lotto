import { prisma } from '@/lib/db';
import { Category } from '@prisma/client';

export type CatTotals = Record<Category, { number: string; total: number }[]>;

export async function getTotalsByCategory(timeWindowId: number): Promise<{
  range: { startAt: Date; endAt: Date };
  data: CatTotals;
}> {
  const tw = await prisma.timeWindow.findUnique({ where: { id: timeWindowId } });
  if (!tw) throw new Error('TIME_WINDOW_NOT_FOUND');

  const rows = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: tw.startAt, lte: tw.endAt } } },
    select: { sumAmount: true, product: { select: { category: true, number: true } } }
  });

  const map: CatTotals = {
    TOP3: [], TOD3: [], TOP2: [], BOTTOM2: [], RUN_TOP: [], RUN_BOTTOM: []
  };

  // รวมยอดต่อ (หมวด,หมายเลข)
  const agg = new Map<string, number>(); // key = cat#number
  for (const r of rows) {
    const cat = r.product.category;
    const num = r.product.number;
    const key = `${cat}#${num}`;
    agg.set(key, (agg.get(key) ?? 0) + Number(r.sumAmount));
  }

  for (const [key, total] of agg) {
    const [cat, num] = key.split('#') as [Category, string];
    map[cat].push({ number: num, total });
  }

  // เรียงมาก→น้อย
  for (const c of Object.keys(map) as Category[]) {
    map[c].sort((a,b)=>b.total-a.total);
  }

  return { range: { startAt: tw.startAt, endAt: tw.endAt }, data: map };
}
