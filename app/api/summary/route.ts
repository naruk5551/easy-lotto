export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CATS = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Cat = (typeof CATS)[number];

function parseISO(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/** สร้างชุดเลขที่ถูกรางวัล */
function buildWinningSets(ps: { top3: string; bottom2: string }) {
  const t3 = (ps.top3 || '').trim();
  const b2 = (ps.bottom2 || '').trim();

  const perm = (s: string) => {
    if (s.length !== 3) return [s];
    const out = new Set<string>();
    const a = s[0], b = s[1], c = s[2];
    out.add(`${a}${b}${c}`); out.add(`${a}${c}${b}`);
    out.add(`${b}${a}${c}`); out.add(`${b}${c}${a}`);
    out.add(`${c}${a}${b}`); out.add(`${c}${b}${a}`);
    return [...out];
  };

  const TOP3 = new Set<string>(t3 ? [t3] : []);
  const TOD3 = new Set<string>(t3 ? perm(t3) : []);
  const TOP2 = new Set<string>(t3.length === 3 ? [t3.slice(1)] : []);
  const BOTTOM2 = new Set<string>(b2 ? [b2] : []);
  const RUN_TOP = new Set<string>(t3 ? t3.split('') : []);
  const RUN_BOTTOM = new Set<string>(b2 ? b2.split('') : []);

  return { TOP3, TOD3, TOP2, BOTTOM2, RUN_TOP, RUN_BOTTOM } as Record<Cat, Set<string>>;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    let fromISO = url.searchParams.get('from');
    let toISO = url.searchParams.get('to');

    // ถ้าไม่ส่งช่วง ให้ใช้งวดล่าสุด
    if (!fromISO || !toISO) {
      const latest = await prisma.timeWindow.findFirst({
        orderBy: { id: 'desc' },
        select: { startAt: true, endAt: true },
      });
      if (!latest) {
        return NextResponse.json({
          from: null, to: null, prize: 0, prizeDealer: 0, prizeSelf: 0, rows: []
        });
      }
      fromISO = latest.startAt.toISOString();
      toISO = latest.endAt.toISOString();
    }

    const from = parseISO(fromISO)!;
    const to = parseISO(toISO)!;

    /**
     * 🔥 Optimization สำคัญที่สุด:
     * รวม inflow + send + product/category เข้าคิวรีเดียว
     */
    const baseRows = await prisma.$queryRaw<{
      productId: number;
      category: Cat;
      number: string;
      inflow: number;
      send: number;
    }[]>`
      WITH 
      inflow AS (
        SELECT p.id AS "productId",
               p.category AS "category",
               p.number AS "number",
               COALESCE(SUM(oi."sumAmount"),0)::float AS inflow
        FROM "OrderItem" oi
        JOIN "Order" o ON oi."orderId" = o.id
        JOIN "Product" p ON p.id = oi."productId"
        WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
        GROUP BY p.id, p.category, p.number
      ),
      sent AS (
        SELECT p.id AS "productId",
               COALESCE(SUM(ex.amount),0)::float AS send
        FROM "ExcessBuy" ex
        JOIN "SettleBatch" b ON b.id = ex."batchId"
        JOIN "Product" p ON p.id = ex."productId"
        WHERE b."from" >= ${from} AND b."to" <= ${to}
        GROUP BY p.id
      )
      SELECT 
        i."productId",
        i."category",
        i."number",
        i."inflow",
        COALESCE(s.send,0)::float AS send
      FROM inflow i
      LEFT JOIN sent s ON s."productId" = i."productId"
      ORDER BY i."category", i."number"
    `;

    /** รวมยอดตามหมวด */
    const inflowByCat = new Map<Cat, number>();
    const sendByCat = new Map<Cat, number>();

    for (const r of baseRows) {
      inflowByCat.set(r.category, (inflowByCat.get(r.category) || 0) + r.inflow);
      sendByCat.set(r.category, (sendByCat.get(r.category) || 0) + r.send);
    }

    /** keep = inflow - send */
    const keepByCat = new Map<Cat, number>();
    for (const cat of CATS) {
      keepByCat.set(cat, Math.max(0, (inflowByCat.get(cat) || 0) - (sendByCat.get(cat) || 0)));
    }

    /** PrizeSetting */
    const ps = await prisma.prizeSetting.findFirst({
      where: { timeWindow: { startAt: from, endAt: to } },
      select: {
        payoutTop3: true, payoutTod3: true, payoutTop2: true, payoutBottom2: true,
        payoutRunTop: true, payoutRunBottom: true,
        top3: true, bottom2: true,
      }
    });

    const payout = {
      TOP3: ps?.payoutTop3 ?? 600,
      TOD3: ps?.payoutTod3 ?? 100,
      TOP2: ps?.payoutTop2 ?? 70,
      BOTTOM2: ps?.payoutBottom2 ?? 70,
      RUN_TOP: ps?.payoutRunTop ?? 3,
      RUN_BOTTOM: ps?.payoutRunBottom ?? 4,
    } as Record<Cat, number>;

    let prizeSelfTotal = 0;
    let prizeDealerTotal = 0;

    const prizeSelfByCat = new Map<Cat, number>();
    const prizeDealerByCat = new Map<Cat, number>();

    if (ps) {
      const win = buildWinningSets({ top3: ps.top3, bottom2: ps.bottom2 });

      for (const r of baseRows) {
        const kept = Math.max(0, r.inflow - r.send);
        if (kept > 0 && win[r.category].has(r.number)) {
          const value = kept * payout[r.category];
          prizeSelfTotal += value;
          prizeSelfByCat.set(r.category, (prizeSelfByCat.get(r.category) || 0) + value);
        }

        if (r.send > 0 && win[r.category].has(r.number)) {
          const value = r.send * payout[r.category];
          prizeDealerTotal += value;
          prizeDealerByCat.set(r.category, (prizeDealerByCat.get(r.category) || 0) + value);
        }
      }
    }

    /** สร้าง rows สำหรับ frontend */
    const rows = [];
    for (const cat of CATS) {
      const inflow = inflowByCat.get(cat) || 0;
      const keep = keepByCat.get(cat) || 0;
      const send = sendByCat.get(cat) || 0;
      const pSelf = prizeSelfByCat.get(cat) || 0;
      const pDeal = prizeDealerByCat.get(cat) || 0;

      if (inflow === 0 && keep === 0 && send === 0 && pSelf === 0 && pDeal === 0) continue;

      rows.push({
        category: cat,
        inflow,
        acceptSelf: keep,
        prizeSelf: pSelf,
        shouldSend: send,
        prizeDealer: pDeal,
      });
    }

    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      prize: prizeSelfTotal + prizeDealerTotal,
      prizeDealer: prizeDealerTotal,
      prizeSelf: prizeSelfTotal,
      rows,
      prizeSetting: ps ?? null,
    });

  } catch (e: any) {
    console.error('SUMMARY ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'Summary error',
      { status: 500 }
    );
  }
}
