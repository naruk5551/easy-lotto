// app/api/reports/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') ?? 10)));
  const userId = Number(searchParams.get('userId') ?? 0);

  if (!Number.isInteger(userId) || userId <= 0) {
    return new NextResponse('ต้องระบุ userId', { status: 400 });
  }

  // กำหนดช่วงเวลา default = time-window id ล่าสุด
  let from = searchParams.get('from');
  let to   = searchParams.get('to');
  if (!from || !to) {
    const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (tw) { from = tw.startAt.toISOString(); to = tw.endAt.toISOString(); }
  }

  const where = {
    order: {
      userId,
      ...(from && to ? { createdAt: { gte: new Date(from), lte: new Date(to) } } : {}),
    },
  };

  const total = await prisma.orderItem.count({ where });
  const items = await prisma.orderItem.findMany({
    where,
    orderBy: { createdAt: 'desc' },               // ล่าสุด → เก่าสุด
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      price: true,
      sumAmount: true,
      createdAt: true,
      product: { select: { category: true, number: true } },
    },
  });

  return NextResponse.json({
    page, pageSize, total,
    from: from ?? null, to: to ?? null,
    items: items.map(x => ({
      id: x.id,
      category: x.product.category,
      number: x.product.number,
      price: Number(x.price),
      sumAmount: Number(x.sumAmount),
      createdAt: x.createdAt.toISOString(),
    })),
  });
}

// อนุญาตแก้ไข/ลบ
export async function PUT(req: Request) {
  const body = await req.json();
  const { id, price } = body ?? {};
  if (!id || typeof price !== 'number') return new NextResponse('ข้อมูลไม่ครบ', { status: 400 });
  await prisma.orderItem.update({ where: { id }, data: { price, sumAmount: price } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id') ?? 0);
  if (!id) return new NextResponse('id?', { status: 400 });
  await prisma.orderItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
