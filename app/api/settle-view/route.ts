import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
//import { Category } from '@prisma/client';

const CATEGORIES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Category = (typeof CATEGORIES)[number];

function parseLocalishToUTC(s?: string | null): Date | undefined {
  if (!s) return;
  // ถ้ามี Z/offset อยู่แล้ว ให้ new Date ตรง ๆ
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }
  // ไม่มีโซน => ถือเป็นเวลาท้องถิ่น แล้วแปลงเป็น UTC
  const d = new Date(s);
  if (isNaN(d.getTime())) return;
  return new Date(d.toISOString());
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get('page') || '1'));
    const pageSize = Math.max(
      1,
      Math.min(100, Number(searchParams.get('pageSize') || '10')),
    );
    const offset = (page - 1) * pageSize;

    const from = parseLocalishToUTC(searchParams.get('from'));
    const to = parseLocalishToUTC(searchParams.get('to'));

    // ถ้าไม่ส่งช่วงมา ใช้ TW ล่าสุดทั้งงวด
    const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (!tw) {
      return NextResponse.json({
        from: null,
        to: null,
        total: 0,
        items: [],
        page,
        pageSize,
      });
    }

    const startAt = tw.startAt;
    const endAt = tw.endAt;

    const usedFrom = from
      ? new Date(Math.max(startAt.getTime(), from.getTime()))
      : startAt;
    const usedTo = to
      ? new Date(Math.min(endAt.getTime(), to.getTime()))
      : endAt;

    // --- 1) นับจำนวน group ทั้งหมด (เหมือนเดิมคือจำนวน row ทั้งชุด) ---
    const totalRows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS "count"
      FROM (
        SELECT p.category, p.number
        FROM "ExcessBuy" ex
        JOIN "SettleBatch" b ON b.id = ex."batchId"
        JOIN "Product" p ON p.id = ex."productId"
        WHERE b."from" >= ${usedFrom} AND b."to" <= ${usedTo}
        GROUP BY p.category, p.number
      ) AS sub
    `;
    const total = Number(totalRows[0]?.count || 0);

    // --- 2) ดึงเฉพาะ page ที่ต้องการ + เรียงแบบ "ทุกหมวดเริ่มที่แถวแรก" ---
    const rows = await prisma.$queryRaw<
      { category: Category; number: string; totalSend: number }[]
    >`
      WITH grouped AS (
        SELECT
          p.category AS "category",
          p.number   AS "number",
          COALESCE(SUM(ex.amount),0)::float AS "totalSend"
        FROM "ExcessBuy" ex
        JOIN "SettleBatch" b ON b.id = ex."batchId"
        JOIN "Product" p ON p.id = ex."productId"
        WHERE b."from" >= ${usedFrom} AND b."to" <= ${usedTo}
        GROUP BY p.category, p.number
      ),
      ranked AS (
        SELECT
          g."category",
          g."number",
          g."totalSend",
          ROW_NUMBER() OVER (
            PARTITION BY g."category"
            ORDER BY g."totalSend" DESC, g."number"
          ) AS rn
        FROM grouped g
      )
      SELECT
        "category",
        "number",
        "totalSend"
      FROM ranked
      ORDER BY rn, "category"
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    return NextResponse.json({
      from: usedFrom.toISOString(),
      to: usedTo.toISOString(),
      total,
      items: rows,
      page,
      pageSize,
    });
  } catch (e: any) {
    console.error('settle-view error', e);
    return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
  }
}
