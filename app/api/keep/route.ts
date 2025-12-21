// app/api/keep/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CATEGORY_VALUES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
type Category = (typeof CATEGORY_VALUES)[number];

type CapMode = 'MANUAL' | 'AUTO';

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

type CapRow = {
  mode: CapMode;
  top3: number | null; tod3: number | null; top2: number | null;
  bottom2: number | null; runTop: number | null; runBottom: number | null;
  autoThresholdTop3: any | null; autoThresholdTod3: any | null; autoThresholdTop2: any | null;
  autoThresholdBottom2: any | null; autoThresholdRunTop: any | null; autoThresholdRunBottom: any | null;
  convertTod3ToTop3: boolean;
};

function capFor(cat: Category, cap: CapRow): number {
  if (cap.mode === 'AUTO') {
    const t = (v: any) => Number(v ?? 0);
    switch (cat) {
      case 'TOP3':       return t(cap.autoThresholdTop3);
      case 'TOD3':       return t(cap.autoThresholdTod3);
      case 'TOP2':       return t(cap.autoThresholdTop2);
      case 'BOTTOM2':    return t(cap.autoThresholdBottom2);
      case 'RUN_TOP':    return t(cap.autoThresholdRunTop);
      case 'RUN_BOTTOM': return t(cap.autoThresholdRunBottom);
    }
  } else {
    const n = (v: number | null) => Number(v ?? 0);
    switch (cat) {
      case 'TOP3':       return n(cap.top3);
      case 'TOD3':       return n(cap.tod3);
      case 'TOP2':       return n(cap.top2);
      case 'BOTTOM2':    return n(cap.bottom2);
      case 'RUN_TOP':    return n(cap.runTop);
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

export async function POST(req: NextRequest) {
  try {
    let from: Date | undefined;
    let to: Date | undefined;
    try {
      if (req.headers.get('content-type')?.includes('application/json')) {
        const body = await req.json().catch(() => ({}));
        from = parseDateUTC((body as any)?.from);
        to = parseDateUTC((body as any)?.to);
      }
    } catch {}

    let tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (!tw) return NextResponse.json({ error: 'ยังไม่มี time-window' }, { status: 400 });

    if (from && to) {
      const host = await prisma.timeWindow.findFirst({
        where: { startAt: { lte: from }, endAt: { gte: to } },
        orderBy: { id: 'desc' },
      });
      if (host) tw = host;
    }

    const startAt = tw.startAt;
    const endAt = tw.endAt;

    const _from = from ? new Date(Math.max(startAt.getTime(), from.getTime())) : startAt;
    const _to = to ? new Date(Math.min(endAt.getTime(), to.getTime())) : endAt;

    if (!(_from < _to)) {
      return NextResponse.json({ created: 0, window: { startAt, endAt, appliedFrom: _from, appliedTo: _to } });
    }

    // ✅ FIX: ใช้ CapRule "แถวล่าสุด" เหมือน settle (ไม่ใช้ upsert id=1)
    const latestCap = await prisma.capRule.findFirst({
      orderBy: { id: 'desc' },
      select: {
        mode: true,
        top3: true, tod3: true, top2: true, bottom2: true, runTop: true, runBottom: true,
        autoThresholdTop3: true, autoThresholdTod3: true, autoThresholdTop2: true,
        autoThresholdBottom2: true, autoThresholdRunTop: true, autoThresholdRunBottom: true,
        convertTod3ToTop3: true,
      },
    });

    const cap: CapRow = latestCap ? {
      mode: latestCap.mode,
      top3: latestCap.top3, tod3: latestCap.tod3, top2: latestCap.top2,
      bottom2: latestCap.bottom2, runTop: latestCap.runTop, runBottom: latestCap.runBottom,
      autoThresholdTop3: latestCap.autoThresholdTop3, autoThresholdTod3: latestCap.autoThresholdTod3, autoThresholdTop2: latestCap.autoThresholdTop2,
      autoThresholdBottom2: latestCap.autoThresholdBottom2, autoThresholdRunTop: latestCap.autoThresholdRunTop, autoThresholdRunBottom: latestCap.autoThresholdRunBottom,
      convertTod3ToTop3: latestCap.convertTod3ToTop3,
    } : {
      mode: 'MANUAL',
      top3: null, tod3: null, top2: null,
      bottom2: null, runTop: null, runBottom: null,
      autoThresholdTop3: null, autoThresholdTod3: null, autoThresholdTop2: null,
      autoThresholdBottom2: null, autoThresholdRunTop: null, autoThresholdRunBottom: null,
      convertTod3ToTop3: false,
    };

    // inflow (สะสมตั้งแต่ต้นงวด.._to)  ✅ ยึดแบบ A: ใช้ o.createdAt
    const inflowsRaw = await prisma.$queryRaw<
      { category: Category; number: string; inflow: number }[]
    >`
      SELECT p.category AS "category",
             p.number   AS "number",
             COALESCE(SUM(oi."sumAmount"),0)::float AS "inflow"
      FROM "OrderItem" oi
      JOIN "Order" o   ON oi."orderId" = o.id
      JOIN "Product" p ON oi."productId" = p.id
      WHERE o."createdAt" >= ${startAt} AND o."createdAt" < ${_to}
      GROUP BY p.category, p.number
    `;

    // already kept (สะสมตั้งแต่ต้นงวด.._to)
    const keptRaw = await prisma.$queryRaw<
      { category: Category; number: string; kept: number }[]
    >`
      SELECT a.category AS "category",
             a.number   AS "number",
             COALESCE(SUM(a.amount),0)::float AS "kept"
      FROM "AcceptSelf" a
      WHERE a."createdAt" >= ${startAt} AND a."createdAt" < ${_to}
      GROUP BY a.category, a.number
    `;

    const key = (c: Category, n: string) => `${c}|${n}`;

    const inflowBy = new Map<string, number>();
    for (const r of inflowsRaw) {
      const amt = Number(r.inflow ?? 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      inflowBy.set(key(r.category, r.number), (inflowBy.get(key(r.category, r.number)) ?? 0) + amt);
    }

    const keptBy = new Map<string, number>();
    for (const r of keptRaw) {
      const amt = Number(r.kept ?? 0);
      if (!Number.isFinite(amt) || amt <= 0) continue;
      keptBy.set(key(r.category, r.number), (keptBy.get(key(r.category, r.number)) ?? 0) + amt);
    }

    const toInsert: { category: Category; number: string; amount: number }[] = [];

    // =========================================================
    // ✅ FIX: เมื่อ convertTod3ToTop3 = true
    // - “คุมอั้น TOD3 ด้วย cap ของ TOP3”
    // - “แต่บันทึก/แสดง AcceptSelf เป็น TOD3” (เพื่อให้หาเลขตรวจรางวัลง่าย)
    // - รองรับกรณี cap ถูกเต็มแล้วในรอบก่อน → รอบใหม่ไม่ควรมี keep เพิ่ม
    // =========================================================

    const convert = !!cap.convertTod3ToTop3;
    const capTop3 = capFor('TOP3', cap) ?? 0;

    // keptPerm: เก็บยอดรับเองสะสมในเชิง “TOP3 per permutation”
    const keptPermTop3 = new Map<string, number>();

    // 1) อัปเดต keptPermTop3 จาก AcceptSelf ที่มีอยู่แล้ว (TOP3 + TOD3 กระจายเป็น perms)
    for (const [k, keptAmt] of keptBy.entries()) {
      const [cat, num] = k.split('|') as [Category, string];

      if (cat === 'TOP3') {
        keptPermTop3.set(num, (keptPermTop3.get(num) ?? 0) + keptAmt);
        continue;
      }

      if (convert && cat === 'TOD3') {
        const list = perms3(num);
        const perEach = Math.round(keptAmt / list.length); // ✅ ต้องเหมือน settle
        for (const nn of list) {
          keptPermTop3.set(nn, (keptPermTop3.get(nn) ?? 0) + perEach);
        }
      }
    }

    // 2) หมวดอื่น ๆ (ยกเว้น TOD3 ตอน convert) ใช้สูตรเดิม: need = min(inflow, cap) - already
    for (const cat of CATEGORY_VALUES) {
      if (convert && cat === 'TOD3') continue;

      const capAmt = capFor(cat, cap) ?? 0;

      for (const [k, inflowAmt] of inflowBy.entries()) {
        const [c, num] = k.split('|') as [Category, string];
        if (c !== cat) continue;

        const already = keptBy.get(k) ?? 0;
        const target = Math.min(inflowAmt, capAmt);
        const need = target - already;

        if (need > 0) {
          toInsert.push({ category: c, number: num, amount: need });
        }
      }
    }

    // 3) TOD3 ตอน convert: คุมด้วย capTop3 ในระดับ permutation แล้วบันทึกกลับเป็น TOD3
    if (convert) {
      for (const [k, inflowAmt] of inflowBy.entries()) {
        const [c, num] = k.split('|') as [Category, string];
        if (c !== 'TOD3') continue;

        const alreadyTod3 = keptBy.get(k) ?? 0;

        const list = perms3(num);
        const perIn = Math.round(inflowAmt / list.length);       // ✅ ต้องเหมือน settle
        const perKept = Math.round(alreadyTod3 / list.length);   // ✅ ใช้ rounding เดียวกันเพื่อให้รอบย่อยไม่เพี้ยน
        const perNeed = Math.max(perIn - perKept, 0);

        if (perNeed <= 0) continue;

        let addTotal = 0;

        for (const nn of list) {
          const alreadyPerm = keptPermTop3.get(nn) ?? 0;
          const remaining = Math.max(capTop3 - alreadyPerm, 0);

          const add = Math.min(perNeed, remaining);
          if (add > 0) {
            addTotal += add;
            keptPermTop3.set(nn, alreadyPerm + add); // ✅ กัน “รอบถัดไป” เกิน cap
          }
        }

        if (addTotal > 0) {
          toInsert.push({ category: 'TOD3', number: num, amount: addTotal }); // ✅ แสดงเป็น TOD3 ตามที่ต้องการ
        }
      }
    } else {
      // ไม่ convert: TOD3 ใช้ cap ของตัวเองตามเดิม
      const capTod3 = capFor('TOD3', cap) ?? 0;
      for (const [k, inflowAmt] of inflowBy.entries()) {
        const [c, num] = k.split('|') as [Category, string];
        if (c !== 'TOD3') continue;

        const already = keptBy.get(k) ?? 0;
        const target = Math.min(inflowAmt, capTod3);
        const need = target - already;
        if (need > 0) toInsert.push({ category: 'TOD3', number: num, amount: need });
      }
    }

    let created = 0;

    if (toInsert.length > 0) {
      await prisma.acceptSelf.createMany({
        data: toInsert.map((row) => ({
          category: row.category,
          number: row.number,
          amount: row.amount,
        })),
      });

      created = toInsert.length;
    }

    return NextResponse.json({
      created,
      window: { startAt, endAt, appliedFrom: _from, appliedTo: _to },
      convertTod3ToTop3: convert, // (debug)
    });
  } catch (e: any) {
    console.error('KEEP ERROR', e);
    return NextResponse.json({ error: e?.message ?? 'keep failed' }, { status: 500 });
  }
}
