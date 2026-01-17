// app/api/summary/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CATS = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Cat = (typeof CATS)[number];

type CapMode = 'MANUAL' | 'AUTO';

function parseISO(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

type CapRow = {
  mode: CapMode;
  top3: number | null;
  tod3: number | null;
  top2: number | null;
  bottom2: number | null;
  runTop: number | null;
  runBottom: number | null;

  autoThresholdTop3: any | null;
  autoThresholdTod3: any | null;
  autoThresholdTop2: any | null;
  autoThresholdBottom2: any | null;
  autoThresholdRunTop: any | null;
  autoThresholdRunBottom: any | null;

  convertTod3ToTop3: boolean;
};

function capFor(cat: Cat, cap: CapRow): number {
  if (cap.mode === 'AUTO') {
    const t = (v: any) => Number(v ?? 0);
    switch (cat) {
      case 'TOP3': return t(cap.autoThresholdTop3);
      case 'TOD3': return t(cap.autoThresholdTod3);
      case 'TOP2': return t(cap.autoThresholdTop2);
      case 'BOTTOM2': return t(cap.autoThresholdBottom2);
      case 'RUN_TOP': return t(cap.autoThresholdRunTop);
      case 'RUN_BOTTOM': return t(cap.autoThresholdRunBottom);
    }
  } else {
    const n = (v: number | null) => Number(v ?? 0);
    switch (cat) {
      case 'TOP3': return n(cap.top3);
      case 'TOD3': return n(cap.tod3);
      case 'TOP2': return n(cap.top2);
      case 'BOTTOM2': return n(cap.bottom2);
      case 'RUN_TOP': return n(cap.runTop);
      case 'RUN_BOTTOM': return n(cap.runBottom);
    }
  }
}

function perms3(s: string) {
  if ((s ?? '').length !== 3) return [s];
  const a = s[0], b = s[1], c = s[2];
  return Array.from(new Set([
    `${a}${b}${c}`, `${a}${c}${b}`,
    `${b}${a}${c}`, `${b}${c}${a}`,
    `${c}${a}${b}`, `${c}${b}${a}`,
  ]));
}

function splitAmountExact(total: number, parts: number) {
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  const out = new Array(parts).fill(base);
  for (let i = 0; i < rem; i++) out[i] += 1;
  return out;
}

/** สร้างชุดเลขถูกรางวัล */
function buildWinningSets(ps: { top3: string; bottom2: string }) {
  const t3 = (ps.top3 || '').trim();
  const b2 = (ps.bottom2 || '').trim();

  const perm = (s: string) => perms3(s);

  return {
    TOP3: new Set<string>(t3 ? [t3] : []),
    TOD3: new Set<string>(t3 ? perm(t3) : []),
    TOP2: new Set<string>(t3.length === 3 ? [t3.slice(1)] : []),
    BOTTOM2: new Set<string>(b2 ? [b2] : []),
    RUN_TOP: new Set<string>(t3 ? t3.split('') : []),
    RUN_BOTTOM: new Set<string>(b2 ? b2.split('') : []),
  } as Record<Cat, Set<string>>;
}

// keepUpTo (เหมือน keep-view)
async function computeKeepUpTo(startAt: Date, upto: Date, cap: CapRow) {
  const inflow = await prisma.$queryRaw<
    { category: Cat; number: string; amount: number }[]
  >`
    SELECT
      p.category AS "category",
      p.number   AS "number",
      COALESCE(SUM(oi."sumAmount"),0)::float AS "amount"
    FROM "OrderItem" oi
    JOIN "Order" o   ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" >= ${startAt} AND o."createdAt" < ${upto}
    GROUP BY p.category, p.number
  `;

  const top3Direct = new Map<string, number>();
  const tod3 = new Map<string, number>();
  const others = new Map<string, number>();

  for (const r of inflow) {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    if (r.category === 'TOP3') {
      top3Direct.set(r.number, (top3Direct.get(r.number) || 0) + amt);
      continue;
    }
    if (r.category === 'TOD3') {
      tod3.set(r.number, (tod3.get(r.number) || 0) + amt);
      continue;
    }
    const k = `${r.category}|${r.number}`;
    others.set(k, (others.get(k) || 0) + amt);
  }

  const keepByKey = new Map<string, number>();

  // other cats
  for (const [k, amt] of others) {
    const [cat] = k.split('|') as [Cat];
    keepByKey.set(k, Math.max(0, Math.min(amt, capFor(cat, cap))));
  }

  const capTop3 = capFor('TOP3', cap);

  if (!cap.convertTod3ToTop3) {
    for (const [n, amt] of top3Direct) keepByKey.set(`TOP3|${n}`, Math.max(0, Math.min(amt, capTop3)));
    const capTod3 = capFor('TOD3', cap);
    for (const [n, amt] of tod3) keepByKey.set(`TOD3|${n}`, Math.max(0, Math.min(amt, capTod3)));
    return keepByKey;
  }

  // convert TOD3 -> TOP3 cap, but keep displayed under TOD3
  const remainingCapByPerm = new Map<string, number>();
  const allPerms = new Set<string>();
  for (const n of top3Direct.keys()) allPerms.add(n);
  for (const n of tod3.keys()) perms3(n).forEach(p => allPerms.add(p));
  for (const p of allPerms) remainingCapByPerm.set(p, capTop3);

  // TOP3 direct first
  for (const [n, amt] of top3Direct) {
    const rem = remainingCapByPerm.get(n) ?? capTop3;
    const kept = Math.max(0, Math.min(amt, rem));
    keepByKey.set(`TOP3|${n}`, kept);
    remainingCapByPerm.set(n, rem - kept);
  }

  // TOD3 after (deterministic)
  const todNumbers = [...tod3.keys()].sort();
  for (const todNum of todNumbers) {
    const total = tod3.get(todNum) || 0;
    if (total <= 0) continue;

    const permList = perms3(todNum).sort();
    const splits = splitAmountExact(total, permList.length);

    let todKeptSum = 0;
    for (let i = 0; i < permList.length; i++) {
      const perm = permList[i];
      const part = splits[i];
      const rem = remainingCapByPerm.get(perm) ?? capTop3;
      const keptPart = Math.max(0, Math.min(part, rem));
      todKeptSum += keptPart;
      remainingCapByPerm.set(perm, rem - keptPart);
    }

    if (todKeptSum > 0) keepByKey.set(`TOD3|${todNum}`, todKeptSum);
  }

  return keepByKey;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    let fromISO = url.searchParams.get('from');
    let toISO = url.searchParams.get('to');

    // default ใช้งวดล่าสุด
    if (!fromISO || !toISO) {
      const latest = await prisma.timeWindow.findFirst({
        orderBy: { id: 'desc' },
        select: { startAt: true, endAt: true },
      });
      if (!latest) {
        return NextResponse.json({ from: null, to: null, prize: 0, prizeDealer: 0, prizeSelf: 0, rows: [] });
      }
      fromISO = latest.startAt.toISOString();
      toISO = latest.endAt.toISOString();
    }

    const from = parseISO(fromISO)!;
    const to = parseISO(toISO)!;

    // timeWindow host
    const tw = await prisma.timeWindow.findFirst({
      where: { startAt: { lte: from }, endAt: { gte: to } },
      orderBy: { id: 'desc' },
    });
    const startAt = tw?.startAt ?? from;
    const endAt = tw?.endAt ?? to;

    // ✅ latest capRule
    const cap = await prisma.capRule.findFirst({
      orderBy: { id: 'desc' },
      select: {
        mode: true,
        top3: true, tod3: true, top2: true, bottom2: true, runTop: true, runBottom: true,
        autoThresholdTop3: true, autoThresholdTod3: true, autoThresholdTop2: true,
        autoThresholdBottom2: true, autoThresholdRunTop: true, autoThresholdRunBottom: true,
        convertTod3ToTop3: true,
      },
    });

    const capRow: CapRow = (cap ?? {
      mode: 'MANUAL',
      top3: 0, tod3: 0, top2: 0, bottom2: 0, runTop: 0, runBottom: 0,
      autoThresholdTop3: 0, autoThresholdTod3: 0, autoThresholdTop2: 0,
      autoThresholdBottom2: 0, autoThresholdRunTop: 0, autoThresholdRunBottom: 0,
      convertTod3ToTop3: false,
    }) as any;

    // inflow ของช่วง (from..to)
    const inflowRaw = await prisma.$queryRaw<{ category: Cat; number: string; amount: number }[]>`
      SELECT
        p.category AS "category",
        p.number   AS "number",
        COALESCE(SUM(oi."sumAmount"),0)::float AS "amount"
      FROM "OrderItem" oi
      JOIN "Order" o   ON oi."orderId" = o.id
      JOIN "Product" p ON p.id = oi."productId"
      WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
      GROUP BY p.category, p.number
    `;

    const inflowByCat = new Map<Cat, number>();
    for (const r of inflowRaw) {
      inflowByCat.set(r.category, (inflowByCat.get(r.category) || 0) + (Number(r.amount) || 0));
    }

    // ✅ acceptSelf ของช่วง = keepDelta (time-priority)
    const keepTo = await computeKeepUpTo(startAt, to, capRow);
    const keepFrom = await computeKeepUpTo(startAt, from, capRow);

    const acceptByCat = new Map<Cat, number>();
    const acceptByKey = new Map<string, number>();

    for (const [k, vTo] of keepTo) {
      const vFrom = keepFrom.get(k) || 0;
      const delta = (Number(vTo) || 0) - (Number(vFrom) || 0);
      if (delta > 0) {
        acceptByKey.set(k, delta);
        const cat = k.split('|')[0] as Cat;
        acceptByCat.set(cat, (acceptByCat.get(cat) || 0) + delta);
      }
    }

    // =====================================================
    // ✅ FIX: shouldSend (ยอดส่งเจ้ามือ) ให้ยึด ExcessBuy จริง (เหมือน settle-view)
    //        เพื่อให้ตัวเลข "ตรงกับหน้า settle" เช่น 34 ไม่เพี้ยนเป็น 33
    // =====================================================
    const sentRaw = await prisma.$queryRaw<{ category: Cat; amount: number }[]>`
      SELECT
        p.category AS "category",
        COALESCE(SUM(ex.amount),0)::float AS "amount"
      FROM "ExcessBuy" ex
      JOIN "SettleBatch" b ON b.id = ex."batchId"
      JOIN "Product" p     ON p.id = ex."productId"
      WHERE b."from" >= ${from} AND b."to" <= ${to}
      GROUP BY p.category
    `;

    const sendByCat = new Map<Cat, number>();
    // default 0 ทุกหมวด
    for (const c of CATS) sendByCat.set(c, 0);
    for (const r of sentRaw) {
      sendByCat.set(r.category, (sendByCat.get(r.category) || 0) + (Number(r.amount) || 0));
    }
    // =====================================================

    // PrizeSetting
    const ps = await prisma.prizeSetting.findFirst({
      where: { timeWindow: { startAt: from, endAt: to } },
      select: {
        payoutTop3: true, payoutTod3: true,
        payoutTop2: true, payoutBottom2: true,
        payoutRunTop: true, payoutRunBottom: true,
        top3: true, bottom2: true,
      }
    });

    const payout: Record<Cat, number> = {
      TOP3: ps?.payoutTop3 ?? 600,
      TOD3: ps?.payoutTod3 ?? 100,
      TOP2: ps?.payoutTop2 ?? 70,
      BOTTOM2: ps?.payoutBottom2 ?? 70,
      RUN_TOP: ps?.payoutRunTop ?? 3,
      RUN_BOTTOM: ps?.payoutRunBottom ?? 4,
    };

    let prizeSelfTotal = 0;
    let prizeDealerTotal = 0;
    const prizeSelfByCat = new Map<Cat, number>();
    const prizeDealerByCat = new Map<Cat, number>();

    if (ps) {
      const win = buildWinningSets({ top3: ps.top3, bottom2: ps.bottom2 });

      // self (ใช้ acceptByKey)
      for (const [k, kept] of acceptByKey) {
        const [cat, num] = k.split('|') as [Cat, string];
        if (win[cat].has(num)) {
          const val = kept * payout[cat];
          prizeSelfTotal += val;
          prizeSelfByCat.set(cat, (prizeSelfByCat.get(cat) || 0) + val);
        }
      }
      // ===============================
      // ✅ ADD: dealer prize calculation
      // ===============================
      const dealerRaw = await prisma.$queryRaw<
        { category: Cat; number: string; amount: number }[]
      >`
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

      for (const r of dealerRaw) {
        if (!r.amount || r.amount <= 0) continue;
        if (win[r.category].has(r.number)) {
          const val = r.amount * payout[r.category];
          prizeDealerTotal += val;
          prizeDealerByCat.set(
            r.category,
            (prizeDealerByCat.get(r.category) || 0) + val
          );
        }
      }

      // dealer: ตอนนี้ยังไม่ได้คำนวณรายเลข (เหมือนเดิมของคุณ)
      // (ถ้าจะทำให้แม่นรายเลข ต้องสร้าง sendByKey จาก ExcessBuy เพิ่มภายหลัง)
    }

    const rows = [];
    for (const cat of CATS) {
      const inflow = inflowByCat.get(cat) || 0;
      const keep = acceptByCat.get(cat) || 0;
      const send = sendByCat.get(cat) || 0;
      const pSelf = prizeSelfByCat.get(cat) || 0;
      const pDeal = prizeDealerByCat.get(cat) || 0;

      if (!inflow && !keep && !send && !pSelf && !pDeal) continue;

      rows.push({
        category: cat,
        inflow,
        acceptSelf: keep,
        prizeSelf: pSelf,
        shouldSend: send, // ✅ FIX: มาจาก ExcessBuy แล้ว
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
    return new NextResponse(typeof e?.message === 'string' ? e.message : 'Summary error', { status: 500 });
  }
}
