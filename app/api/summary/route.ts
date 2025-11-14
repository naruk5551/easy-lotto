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
function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

// สร้างชุด “เลขที่ถูกรางวัล” จาก PrizeSetting
function buildWinningSets(ps: { top3: string; bottom2: string; }) {
  const t3 = (ps.top3 || '').trim();
  const b2 = (ps.bottom2 || '').trim();

  const top3Set = new Set<string>(t3 ? [t3] : []);

  const tod3Set = new Set<string>();
  if (t3.length === 3) {
    const digits = t3.split('');
    const used = [false, false, false];
    const cur: string[] = [];
    const perms = new Set<string>();
    function dfs() {
      if (cur.length === 3) { perms.add(cur.join('')); return; }
      for (let i = 0; i < 3; i++) {
        if (used[i]) continue;
        used[i] = true; cur.push(digits[i]); dfs(); cur.pop(); used[i] = false;
      }
    }
    dfs(); perms.forEach(x => tod3Set.add(x));
  }

  const top2Set = new Set<string>(t3.length === 3 ? [t3.slice(1)] : []);
  const bottom2Set = new Set<string>(b2 ? [b2] : []);
  const runTopSet = new Set<string>(t3.length === 3 ? t3.split('') : []);
  const runBottomSet = new Set<string>(b2.length === 2 ? b2.split('') : []);

  return {
    TOP3: top3Set,
    TOD3: tod3Set,
    TOP2: top2Set,
    BOTTOM2: bottom2Set,
    RUN_TOP: runTopSet,
    RUN_BOTTOM: runBottomSet,
  } as Record<Cat, Set<string>>;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    let fromISO = url.searchParams.get('from');
    let toISO = url.searchParams.get('to');

    // ถ้าไม่ส่ง from/to มา ให้ใช้งวดล่าสุด
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

    // ===== 1) INFLOW จาก OrderItem.sumAmount -> ต่อ productId และรวมต่อหมวด
    const inflowGroups = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: { createdAt: { gte: from, lt: to } },
      _sum: { sumAmount: true },
    });
    const inflowPerProd = new Map<number, number>();
    for (const g of inflowGroups) inflowPerProd.set(g.productId!, Number(g._sum.sumAmount || 0));

    const inflowProdIds = uniq(
      inflowGroups
        .map((g: any) => g.productId as number | null)
        .filter((x: number | null): x is number => typeof x === 'number')
    );


    // ===== 2) SEND จาก ExcessBuy.amount -> ต่อ productId และรวมต่อหมวด
    const sendGroups = await prisma.excessBuy.groupBy({
      by: ['productId'],
      where: { createdAt: { gte: from, lt: to } },
      _sum: { amount: true },
    });
    const sendPerProd = new Map<number, number>();
    for (const g of sendGroups) sendPerProd.set(g.productId!, Number(g._sum.amount || 0));

    const sendProdIds = uniq(
      sendGroups
      .map((g: any) => g.productId as number | null)
      .filter((x: number | null): x is number => typeof x === 'number'));

    // รวม product ที่ปรากฏทั้ง inflow หรือ send
    const allProdIds = uniq([...inflowProdIds, ...sendProdIds]);
    const prods = allProdIds.length
      ? await prisma.product.findMany({
        where: { id: { in: allProdIds } },
        select: { id: true, category: true, number: true }
      })
      : [];

    const prodInfo = new Map<number, { cat: Cat; number: string }>();
    prods.forEach((p:any) => prodInfo.set(p.id, { cat: p.category as Cat, number: p.number }));

    // รวมยอดอินพุตแบบหมวดเพื่อทำ summary
    const inflowByCat = new Map<Cat, number>();
    const sendByCat = new Map<Cat, number>();
    for (const id of allProdIds) {
      const info = prodInfo.get(id as number);
      if (!info) continue;
      const inflow = inflowPerProd.get(id as number) || 0;
      const send = sendPerProd.get(id as number) || 0;
      inflowByCat.set(info.cat, (inflowByCat.get(info.cat) || 0) + inflow);
      sendByCat.set(info.cat, (sendByCat.get(info.cat) || 0) + send);
    }

    // ===== 2.5) KEEP = inflow - send (ไม่ติดลบ) (ให้ตรงหน้า keep)
    const keepByCat = new Map<Cat, number>();
    for (const cat of CATS) {
      const inflow = inflowByCat.get(cat) || 0;
      const send = sendByCat.get(cat) || 0;
      keepByCat.set(cat, Math.max(0, inflow - send));
    }

    // ===== 3) PrizeSetting — คำนวณ “ยอดถูกรางวัลรับเอง/เจ้ามือ”
    const ps = await prisma.prizeSetting.findFirst({
      where: { timeWindow: { startAt: from, endAt: to } },
      select: {
        payoutTop3: true, payoutTod3: true, payoutTop2: true, payoutBottom2: true,
        payoutRunTop: true, payoutRunBottom: true, top3: true, bottom2: true
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

      // --- รางวัล "รับเอง" : ใช้ยอด keep ต่อเลข = max( inflowPerProd - sendPerProd, 0 )
      for (const id of allProdIds) {
        const info = prodInfo.get(id as number);
        if (!info) continue;
        const kept = Math.max(0, (inflowPerProd.get(id) || 0) - (sendPerProd.get(id) || 0));
        if (kept <= 0) continue;
        if (win[info.cat].has(info.number)) {
          const value = kept * (payout[info.cat] || 0);
          prizeSelfByCat.set(info.cat, (prizeSelfByCat.get(info.cat) || 0) + value);
          prizeSelfTotal += value;
        }
      }

      // --- รางวัล "เจ้ามือ" : ใช้ยอดส่งเจ้ามือต่อเลข
      for (const id of sendProdIds) {
        const info = prodInfo.get(id);
        if (!info) continue;
        const amt = sendPerProd.get(id) || 0;
        if (amt <= 0) continue;
        if (win[info.cat].has(info.number)) {
          const value = amt * (payout[info.cat] || 0);
          prizeDealerByCat.set(info.cat, (prizeDealerByCat.get(info.cat) || 0) + value);
          prizeDealerTotal += value;
        }
      }
    }

    // ===== รวมตอบกลับ
    const rows: Array<{
      category: Cat;
      inflow: number;
      acceptSelf: number;   // = keep
      prizeSelf: number;    // คิดจาก keep ต่อเลข
      shouldSend: number;   // ส่งเจ้ามือ
      prizeDealer: number;  // รางวัลฝั่งเจ้ามือ
    }> = [];

    for (const cat of CATS) {
      const inflow = inflowByCat.get(cat) || 0;
      const keepAmt = keepByCat.get(cat) || 0;
      const sendAmt = sendByCat.get(cat) || 0;
      const pSelf = prizeSelfByCat.get(cat) || 0;
      const pDeal = prizeDealerByCat.get(cat) || 0;

      if (inflow === 0 && keepAmt === 0 && sendAmt === 0 && pSelf === 0 && pDeal === 0) continue;

      rows.push({ category: cat, inflow, acceptSelf: keepAmt, prizeSelf: pSelf, shouldSend: sendAmt, prizeDealer: pDeal });
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
    return new NextResponse(typeof e?.message === 'string' ? e.message : 'Summary error', { status: 500 });
  }
}
