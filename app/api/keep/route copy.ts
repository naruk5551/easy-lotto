// app/api/keep/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma, Category } from '@prisma/client';

// ---- helpers ----
function parseDateUTC(v?: unknown): Date | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const m = s.replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) return new Date(`${m[1]}T${m[2]}Z`);
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}
function fmtTH(d: Date) {
  return new Intl.DateTimeFormat('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  }).format(d);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let from = parseDateUTC(searchParams.get('from') ?? undefined);
  let to   = parseDateUTC(searchParams.get('to')   ?? undefined);

  // ใช้ time-window ล่าสุดเป็นค่าเริ่มต้น + clamp
  const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
  if (!tw) {
    return NextResponse.json({ error: 'ยังไม่มี Time Window', items: [] }, { status: 400 });
  }
  if (!from) from = tw.startAt;
  if (!to)   to   = tw.endAt;

  // clamp ให้อยู่ในงวดล่าสุดเสมอ
  if (from < tw.startAt) from = tw.startAt;
  if (to > tw.endAt) to = tw.endAt;
  if (!(from < to)) {
    const banner = `⛔ อยู่นอกช่วงงวดล่าสุด: ${fmtTH(tw.startAt)} – ${fmtTH(tw.endAt)} (เวลาไทย)`;
    return NextResponse.json({ error: 'ช่วงเวลาไม่อยู่ในงวดล่าสุด', banner, from: tw.startAt, to: tw.endAt }, { status: 400 });
  }

  // inflow: OrderItem.sumAmount ภายในช่วงที่กรอง
  const inflowRows = await prisma.$queryRaw<{ category: Category; number: string; inflow: number }[]>(Prisma.sql`
    SELECT p."category" AS category,
           p."number"   AS number,
           COALESCE(SUM(oi."sumAmount"),0)::float AS inflow
    FROM "OrderItem" oi
    JOIN "Order" o   ON oi."orderId" = o."id"
    JOIN "Product" p ON oi."productId" = p."id"
    WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
    GROUP BY p."category", p."number"
  `);

  // sent: ExcessBuy.amount ของ batch ที่อยู่ "ภายในช่วงกรอง"
  // อิง SettleBatch.from/to (เพราะ schema ปัจจุบันยังไม่มี timeWindowId)
  const sentRows = await prisma.$queryRaw<{ category: Category; number: string; sent: number }[]>(Prisma.sql`
    SELECT p."category" AS category,
           p."number"   AS number,
           COALESCE(SUM(eb."amount"),0)::float AS sent
    FROM "ExcessBuy" eb
    JOIN "Product" p ON eb."productId" = p."id"
    JOIN "SettleBatch" b ON eb."batchId" = b."id"
    WHERE b."from" >= ${from} AND b."to" <= ${to}
    GROUP BY p."category", p."number"
  `);

  const sentMap = new Map<string, number>();
  for (const r of sentRows) sentMap.set(`${r.category}|${r.number}`, r.sent);

  const items = inflowRows
    .map(r => {
      const key = `${r.category}|${r.number}`;
      const inflow = Number(r.inflow || 0);
      const sent   = Number(sentMap.get(key) || 0);
      const keep   = Math.max(inflow - sent, 0);
      return { category: r.category, number: r.number, inflow, sent, keep };
    })
    .filter(r => r.keep > 0 || r.inflow > 0 || r.sent > 0);

  const banner = `✅ กรองข้อมูลสำเร็จ: ${fmtTH(from)} – ${fmtTH(to)} (เวลาไทย)`;
  return NextResponse.json({ from, to, banner, items });
}
