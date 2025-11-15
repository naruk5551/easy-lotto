import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
//import { Category } from '@prisma/client';

const CATEGORIES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const
type Category = (typeof CATEGORIES)[number]

// ลำดับหมวด (เรียงแบบกำหนดเอง)
const CATEGORY_ORDER: Category[] = [
  'TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'
];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') ?? 10)));
    const skip = (page - 1) * pageSize;

    // นับทั้งหมด
    const total = await prisma.product.count();

    // ดึงข้อมูลและจัดเรียง
    const itemsAll = await prisma.product.findMany({
      select: {
        id: true,
        category: true,
        number: true,
        createdAt: true,
      },
    });

    // ✅ เรียงตามหมวดก่อน แล้วตาม id จากน้อยไปมาก
    const sorted = itemsAll.sort((a: any, b: any) => {
      const catOrderA = CATEGORY_ORDER.indexOf(a.category);
      const catOrderB = CATEGORY_ORDER.indexOf(b.category);
      if (catOrderA !== catOrderB) return catOrderA - catOrderB;
      return a.id - b.id; // id น้อยก่อน
    });

    const paged = sorted.slice(skip, skip + pageSize);

    return NextResponse.json({
      items: paged.map((i: any) => ({
        ...i,
        createdAt: i.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (e: any) {
    console.error('GET /api/products error:', e);
    return new NextResponse(e?.message || 'Bad Request', { status: 400 });
  }
}
