// app/api/admin/cut/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma, Category as PrismaCategory } from '@prisma/client';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CutBody = {
  timeWindowId: number;
  // cap manual ต่อหมวด เช่น { TOP3: 100, TOP2: 50, ... }
  caps?: Partial<Record<PrismaCategory, number>>;
};

type TotalsByProduct = Map<number, number>;
type ExcessRow = { orderItemId: number; amount: number };

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as CutBody;
  const { timeWindowId, caps = {} } = body;

  if (!timeWindowId) {
    return NextResponse.json({ error: 'timeWindowId required' }, { status: 400 });
  }

  // สรุปรวมยอดซื้อของแต่ละ product ภายใน window
  const itemsInWindow = await prisma.orderItem.findMany({
    where: {
      order: {
        createdAt: {
          gte: (await prisma.timeWindow.findUniqueOrThrow({
            where: { id: timeWindowId },
            select: { startAt: true, endAt: true },
          })).startAt,
          lte: (await prisma.timeWindow.findUniqueOrThrow({
            where: { id: timeWindowId },
            select: { endAt: true },
          })).endAt,
        },
      },
    },
    select: {
      id: true,
      productId: true,
      sumAmount: true,
      product: { select: { category: true } },
    },
  });

  // รวมยอดสะสมต่อ product
  const totals: TotalsByProduct = new Map();
  for (const it of itemsInWindow) {
    const pid = it.productId;
    const prev = totals.get(pid) ?? 0;
    totals.set(pid, prev + Number(it.sumAmount));
  }

  // หา excess ที่ “ควรเป็น” ตาม caps (ถ้ากำหนด)
  // NOTE: ตัวอย่าง: รองรับเฉพาะ TOP3/TOP2/BOTTOM2 ฯลฯ ตาม caps ที่ส่งมา
  const toExcess: ExcessRow[] = [];

  // เราจะสร้าง excess ให้เฉพาะส่วนที่ยัง “ไม่ได้สร้าง” ใน window นี้
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const it of itemsInWindow) {
      const cat = it.product.category as PrismaCategory;
      const cap = caps[cat];
      if (cap == null) continue;

      const totalForProduct = totals.get(it.productId) ?? 0;
      if (totalForProduct <= cap) continue;

      const shouldExcess = totalForProduct - cap;

      // เช็กว่าใน window นี้ สร้าง excess ไปแล้วเท่าไร
      const existing = await tx.excessBuy.aggregate({
        _sum: { amount: true },
        where: {
          orderItemId: it.id,
          createdAt: {
            gte: (await tx.timeWindow.findUniqueOrThrow({
              where: { id: timeWindowId },
              select: { startAt: true },
            })).startAt,
            lte: (await tx.timeWindow.findUniqueOrThrow({
              where: { id: timeWindowId },
              select: { endAt: true },
            })).endAt,
          },
        },
      });

      const already = Number(existing._sum.amount ?? 0);
      const need = shouldExcess - already;
      if (need > 0) {
        toExcess.push({ orderItemId: it.id, amount: need });
      }
    }

    // สร้างเฉพาะส่วนที่ยังไม่ถูกสร้าง
    if (toExcess.length) {
      await tx.excessBuy.createMany({
        data: toExcess.map((r) => ({ orderItemId: r.orderItemId, amount: r.amount })),
      });
    }
  });

  return NextResponse.json({ ok: true, created: toExcess.length });
}
