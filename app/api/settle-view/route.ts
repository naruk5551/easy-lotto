import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Category } from '@prisma/client';

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
    const pageSize = Math.max(1, Math.min(100, Number(searchParams.get('pageSize') || '10')));

    const from = parseLocalishToUTC(searchParams.get('from'));
    const to = parseLocalishToUTC(searchParams.get('to'));

    // ถ้าไม่ส่งช่วงมา ใช้ TW ล่าสุดทั้งงวด
    let startAt: Date;
    let endAt: Date;
    const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (!tw) return NextResponse.json({ from: null, to: null, total: 0, items: [], page, pageSize });

    startAt = tw.startAt;
    endAt = tw.endAt;

    const usedFrom = from ? new Date(Math.max(startAt.getTime(), from.getTime())) : startAt;
    const usedTo = to ? new Date(Math.min(endAt.getTime(), to.getTime())) : endAt;

    // รวมยอดส่งจาก ExcessBuy สำหรับช่วงย่อย
    const rows = (await prisma.$queryRaw<
      { category: Category; number: string; totalSend: number }[]
    >`
      SELECT p.category AS "category",
             p.number   AS "number",
             COALESCE(SUM(ex.amount),0)::float AS "totalSend"
      FROM "ExcessBuy" ex
      JOIN "SettleBatch" b ON b.id = ex."batchId"
      JOIN "Product" p ON p.id = ex."productId"
      WHERE b."from" >= ${usedFrom} AND b."to" <= ${usedTo}
      GROUP BY p.category, p.number
      ORDER BY p.category, p.number
    `) as any[];

    // page
    const total = rows.length;
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({
      from: usedFrom.toISOString(),
      to: usedTo.toISOString(),
      total,
      items: slice,
      page,
      pageSize,
    });
  } catch (e: any) {
    console.error('settle-view error', e);
    return NextResponse.json({ error: e?.message || 'error' }, { status: 500 });
  }
}
