export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
//import { Category } from '@prisma/client';

function parseDateUTC(v?: string | null): Date | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const d = new Date(`${s}+07:00`);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 10)));

  const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
  if (!tw) return NextResponse.json({ from: null, to: null, total: 0, items: [], page, pageSize });

  const fromQ = parseDateUTC(searchParams.get('from'));
  const toQ = parseDateUTC(searchParams.get('to'));
  const from = fromQ ?? tw.startAt;
  const to = toQ ?? tw.endAt;
  const CATEGORIES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const
  type Category = (typeof CATEGORIES)[number]

  const rows = await prisma.$queryRaw<
    { category: Category; number: string; inflow: number; keep: number }[]
  >`
    WITH inflow AS (
      SELECT p.category, p.number, COALESCE(SUM(oi."sumAmount"),0)::float AS inflow
      FROM "OrderItem" oi
      JOIN "Order" o   ON oi."orderId" = o.id
      JOIN "Product" p ON oi."productId" = p.id
      WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
      GROUP BY p.category, p.number
    ),
    sent AS (
      SELECT p.category, p.number, COALESCE(SUM(ex.amount),0)::float AS sent
      FROM "ExcessBuy" ex
      JOIN "SettleBatch" b ON ex."batchId" = b.id
      JOIN "Product" p     ON ex."productId" = p.id
      WHERE b."from" >= ${from} AND b."to" <= ${to}
      GROUP BY p.category, p.number
    )
    SELECT i.category, i.number,
           i.inflow,
           GREATEST(i.inflow - COALESCE(s.sent,0), 0)::float AS keep
    FROM inflow i
    LEFT JOIN sent s
      ON s.category = i.category AND s.number = i.number
    ORDER BY i.category, i.number
  `;

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const items = rows.slice(start, end);

  return NextResponse.json({ from, to, total, items, page, pageSize });
}
