// app/api/summary/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

const thLabel: Record<string,string> = {
  TOP3: '3 ตัวบน',
  TOD3: '3 โต๊ด',
  TOP2: '2 ตัวบน',
  BOTTOM2: '2 ตัวล่าง',
  RUN_TOP: 'วิ่งบน',
  RUN_BOTTOM: 'วิ่งล่าง',
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let from = searchParams.get('from') ? new Date(String(searchParams.get('from'))) : undefined;
  let to   = searchParams.get('to')   ? new Date(String(searchParams.get('to')))   : undefined;

  let tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
  if (!tw) return NextResponse.json({ from: null, to: null, rows: [], totals: { inflow:0, keep:0, send:0, prizeSelf:0, prizeDealer:0 } });

  const startAt = tw.startAt, endAt = tw.endAt;
  const _from = from ? new Date(Math.max(startAt.getTime(), from.getTime())) : startAt;
  const _to   = to   ? new Date(Math.min(endAt.getTime(),   to.getTime()))   : endAt;

  const inflow = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT p."category"::text AS category,
           COALESCE(SUM(oi."sumAmount"),0)::float AS inflow
    FROM "OrderItem" oi
    JOIN "Order" o   ON oi."orderId"=o."id"
    JOIN "Product" p ON oi."productId"=p."id"
    WHERE o."createdAt" >= ${_from} AND o."createdAt" < ${_to}
    GROUP BY p."category"
  `);

  const send = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT p."category"::text AS category,
           COALESCE(SUM(ex."amount"),0)::float AS totalSend
    FROM "ExcessBuy" ex
    JOIN "SettleBatch" b ON ex."batchId"=b."id"
    LEFT JOIN "Product" p ON ex."productId"=p."id"
    WHERE b."from" >= ${_from} AND b."to" <= ${_to}
    GROUP BY p."category"
  `);

  const inflowMap = new Map<string, number>();
  for (const r of inflow) inflowMap.set(r.category, Number(r.inflow ?? 0));
  const sendMap = new Map<string, number>();
  for (const r of send) sendMap.set(r.category, Number(r.totalsend ?? r.totalSend ?? 0));

  const cats = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'];
  const rows = cats.map(cat => {
    const inflow = inflowMap.get(cat) ?? 0;
    const totalSend = sendMap.get(cat) ?? 0;
    const keep = Math.max(inflow - totalSend, 0);
    return {
      category: thLabel[cat] ?? cat,
      inflow,
      keep,
      prizeSelf: 0,     // (คำนวณจาก PrizeSetting ได้ในรอบถัดไป)
      send: totalSend,
      prizeDealer: 0,   // (คำนวณจาก PrizeSetting ได้ในรอบถัดไป)
    };
  });

  const totals = rows.reduce((a,r)=>({
    inflow: a.inflow + r.inflow,
    keep: a.keep + r.keep,
    send: a.send + r.send,
    prizeSelf: a.prizeSelf + r.prizeSelf,
    prizeDealer: a.prizeDealer + r.prizeDealer
  }), { inflow:0, keep:0, send:0, prizeSelf:0, prizeDealer:0 });

  return NextResponse.json({
    from: _from.toISOString(),
    to: _to.toISOString(),
    rows,
    totals,
  });
}
