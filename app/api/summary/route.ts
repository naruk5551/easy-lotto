// app/api/summary/route.ts
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
          from: null, to: null, prize: 0, prizeDealer: 0, prizeSelf: 0, rows: [],
        });
      }
      fromISO = latest.startAt.toISOString();
      toISO = latest.endAt.toISOString();
    }

    const from = parseISO(fromISO)!;
    const to = parseISO(toISO)!;

    // =====================================================
    // 1) inflow: ยอดสั่งซื้อ (ซื้อจริง) จาก OrderItem (ยึดแบบ A: o.createdAt)
    // =====================================================
    const inflowRows = await prisma.$queryRaw<{
      category: Cat;
      inflow: number;
    }[]>`
      SELECT
        p.category AS "category",
        COALESCE(SUM(oi."sumAmount"),0)::float AS "inflow"
      FROM "OrderItem" oi
      JOIN "Order" o   ON oi."orderId" = o.id
      JOIN "Product" p ON p.id = oi."productId"
      WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
      GROUP BY p.category
    `;

    const inflowByCat = new Map<Cat, number>();
    for (const r of inflowRows) {
      inflowByCat.set(r.category, (inflowByCat.get(r.category) || 0) + (Number(r.inflow) || 0));
    }

    // =====================================================
    // 2) ✅ acceptSelf: ต้องอ่านจาก AcceptSelf เท่านั้น (นี่คือจุดแก้หลัก)
    //    ห้ามใช้ inflow - send เพราะจะเพี้ยนเมื่อมีการแปลงโต๊ด→บน
    // =====================================================
    const acceptRows = await prisma.$queryRaw<{
      category: Cat;
      accept: number;
    }[]>`
      SELECT
        a.category AS "category",
        COALESCE(SUM(a.amount),0)::float AS "accept"
      FROM "AcceptSelf" a
      WHERE a."createdAt" >= ${from} AND a."createdAt" < ${to} -- ✅ ใช้ช่วงเวลาจริงของการ "รับเองเพิ่ม" ในรอบนั้น
      GROUP BY a.category
    `;

    const acceptByCat = new Map<Cat, number>();
    for (const r of acceptRows) {
      acceptByCat.set(r.category, (acceptByCat.get(r.category) || 0) + (Number(r.accept) || 0));
    }

    // =====================================================
    // 3) shouldSend: ยอดส่งเจ้ามือ จาก ExcessBuy (อิง SettleBatch)
    // =====================================================
    const sendRows = await prisma.$queryRaw<{
      category: Cat;
      send: number;
    }[]>`
      SELECT
        p.category AS "category",
        COALESCE(SUM(ex.amount),0)::float AS "send"
      FROM "ExcessBuy" ex
      JOIN "SettleBatch" b ON b.id = ex."batchId"
      JOIN "Product" p     ON p.id = ex."productId"
      WHERE b."from" >= ${from} AND b."to" <= ${to}
      GROUP BY p.category
    `;

    const sendByCat = new Map<Cat, number>();
    for (const r of sendRows) {
      sendByCat.set(r.category, (sendByCat.get(r.category) || 0) + (Number(r.send) || 0));
    }

    // =====================================================
    // 4) PrizeSetting + payout
    // =====================================================
    const ps = await prisma.prizeSetting.findFirst({
      where: { timeWindow: { startAt: from, endAt: to } },
      select: {
        payoutTop3: true, payoutTod3: true, payoutTop2: true, payoutBottom2: true,
        payoutRunTop: true, payoutRunBottom: true,
        top3: true, bottom2: true,
      },
    });

    const payout = {
      TOP3: ps?.payoutTop3 ?? 600,
      TOD3: ps?.payoutTod3 ?? 100,
      TOP2: ps?.payoutTop2 ?? 70,
      BOTTOM2: ps?.payoutBottom2 ?? 70,
      RUN_TOP: ps?.payoutRunTop ?? 3,
      RUN_BOTTOM: ps?.payoutRunBottom ?? 4,
    } as Record<Cat, number>;

    // =====================================================
    // 5) Prize คิดจาก "รายการจริง" ของ AcceptSelf/ExcessBuy (ไม่ใช้ inflow-send)
    // =====================================================
    let prizeSelfTotal = 0;
    let prizeDealerTotal = 0;

    const prizeSelfByCat = new Map<Cat, number>();
    const prizeDealerByCat = new Map<Cat, number>();

    if (ps) {
      const win = buildWinningSets({ top3: ps.top3, bottom2: ps.bottom2 });

      // ---- self: อ่านจาก AcceptSelf ----
      const acceptDetail = await prisma.$queryRaw<{
        category: Cat;
        number: string;
        amount: number;
      }[]>`
        SELECT
          a.category AS "category",
          a.number   AS "number",
          COALESCE(SUM(a.amount),0)::float AS "amount"
        FROM "AcceptSelf" a
        WHERE a."createdAt" >= ${from} AND a."createdAt" < ${to}
        GROUP BY a.category, a.number
      `;

      for (const r of acceptDetail) {
        const amt = Number(r.amount) || 0;
        if (amt > 0 && win[r.category].has(r.number)) {
          const val = amt * payout[r.category];
          prizeSelfTotal += val;
          prizeSelfByCat.set(r.category, (prizeSelfByCat.get(r.category) || 0) + val);
        }
      }

      // ---- dealer: อ่านจาก ExcessBuy ----
      const sendDetail = await prisma.$queryRaw<{
        category: Cat;
        number: string;
        amount: number;
      }[]>`
        SELECT
          p.category AS "category",
          p.number   AS "number",
          COALESCE(SUM(ex.amount),0)::float AS "amount"
        FROM "ExcessBuy" ex
        JOIN "SettleBatch" b ON b.id = ex."batchId"
        JOIN "Product" p     ON p.id = ex."productId"
        WHERE b."from" >= ${from} AND b."to" <= ${to}
        GROUP BY p.category, p.number
      `;

      for (const r of sendDetail) {
        const amt = Number(r.amount) || 0;
        if (amt > 0 && win[r.category].has(r.number)) {
          const val = amt * payout[r.category];
          prizeDealerTotal += val;
          prizeDealerByCat.set(r.category, (prizeDealerByCat.get(r.category) || 0) + val);
        }
      }
    }

    // =====================================================
    // 6) rows สำหรับ frontend (เหมือนเดิม)
    // =====================================================
    const rows: any[] = [];
    for (const cat of CATS) {
      const inflow = inflowByCat.get(cat) || 0;
      const keep = acceptByCat.get(cat) || 0;   // ✅ CHANGED: acceptSelf จาก AcceptSelf
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
