import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
//import { Category } from '@prisma/client';

const CATEGORIES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Category = (typeof CATEGORIES)[number];

// ลำดับหมวด (เรียงแบบกำหนดเอง)
const CATEGORY_ORDER: Category[] = [
  'TOP3',
  'TOD3',
  'TOP2',
  'BOTTOM2',
  'RUN_TOP',
  'RUN_BOTTOM',
];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') ?? 10)));
    const skip = (page - 1) * pageSize;

    // นับทั้งหมด (เหมือนเดิม)
    const total = await prisma.product.count();

    // ให้ DB ช่วยจัดเรียง + paginate แทนดึงทั้งหมดมาจัดเรียงใน Node
    const items = await prisma.$queryRaw<
      { id: number; category: Category; number: string; createdAt: Date }[]
    >`
      SELECT
        id,
        category,
        number,
        "createdAt"
      FROM "Product"
      ORDER BY
        CASE category
          WHEN 'TOP3'       THEN 1
          WHEN 'TOD3'       THEN 2
          WHEN 'TOP2'       THEN 3
          WHEN 'BOTTOM2'    THEN 4
          WHEN 'RUN_TOP'    THEN 5
          WHEN 'RUN_BOTTOM' THEN 6
          ELSE 999
        END,
        id ASC
      LIMIT ${pageSize} OFFSET ${skip}
    `;

    return NextResponse.json({
      items: items.map(i => ({
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
