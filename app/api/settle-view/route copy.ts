// app/api/settle-view/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Category, CapMode, Prisma } from '@prisma/client';

// ---------- utils ----------
function parseDateUTC(v?: string | null) {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}
function perms3(s: string) {
  if (!s || s.length !== 3) return [s];
  const a = s[0], b = s[1], c = s[2];
  return Array.from(new Set([
    `${a}${b}${c}`, `${a}${c}${b}`,
    `${b}${a}${c}`, `${b}${c}${a}`,
    `${c}${a}${b}`, `${c}${b}${a}`,
  ]));
}
type CapRow = {
  mode: CapMode;
  // manual
  top3: number | null; tod3: number | null; top2: number | null;
  bottom2: number | null; runTop: number | null; runBottom: number | null;
  // auto thresholds
  autoThresholdTop3: Prisma.Decimal | null;
  autoThresholdTod3: Prisma.Decimal | null;
  autoThresholdTop2: Prisma.Decimal | null;
  autoThresholdBottom2: Prisma.Decimal | null;
  autoThresholdRunTop: Prisma.Decimal | null;
  autoThresholdRunBottom: Prisma.Decimal | null;
  convertTod3ToTop3: boolean;
};
function capFor(cat: Category, cap: CapRow): number {
  if (cap.mode === 'AUTO') {
    const t = (v: Prisma.Decimal | number | null) => Number(v ?? 0);
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

// ---------- handler ----------
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const pageSize = Math.max(1, Math.min(200, Number(searchParams.get('pageSize') ?? 10)));

  let from = parseDateUTC(searchParams.get('from'));
  let to = parseDateUTC(searchParams.get('to'));

  // ถ้าไม่ได้ส่งช่วงมา ให้ใช้ time-window id ล่าสุด
  if (!from || !to) {
    const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
    if (tw) {
      from ??= tw.startAt;
      to ??= tw.endAt;
    }
  }
  if (!from || !to) {
    return NextResponse.json({ from: null, to: null, total: 0, items: [], page, pageSize });
  }

  // โหลด CapRule ปัจจุบัน
  const cap = await prisma.capRule.upsert({
    where: { id: 1 },
    create: { id: 1, mode: 'MANUAL' },
    update: {},
    select: {
      mode: true,
      top3: true, tod3: true, top2: true, bottom2: true, runTop: true, runBottom: true,
      autoThresholdTop3: true, autoThresholdTod3: true, autoThresholdTop2: true,
      autoThresholdBottom2: true, autoThresholdRunTop: true, autoThresholdRunBottom: true,
      convertTod3ToTop3: true,
    },
  }) as unknown as CapRow;

  // 1) inflow (ยอดซื้อ) เฉพาะช่วงเวลา
  const inflowRows = await prisma.$queryRaw<
    { productId: number; category: Category; number: string; inflow: number }[]
  >(Prisma.sql`
    SELECT p.id AS "productId",
           p."category" AS "category",
           p."number"   AS "number",
           COALESCE(SUM(oi."sumAmount"),0)::float AS "inflow"
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId" = o.id
    JOIN "Product" p ON oi."productId" = p.id
    WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
    GROUP BY p.id, p."category", p."number"
  `);

  // 2) sentAlready (ยอดที่เคยส่งแล้ว) ในช่วงเวลาเดียวกัน
  const sentRows = await prisma.$queryRaw<
    { productId: number; amount: number }[]
  >(Prisma.sql`
    SELECT e."productId" AS "productId",
           COALESCE(SUM(e."amount"),0)::float AS "amount"
    FROM "ExcessBuy" e
    JOIN "SettleBatch" b ON b.id = e."batchId"
    WHERE b."from" = ${from} AND b."to" = ${to}
    GROUP BY e."productId"
  `);
  const sentMap = new Map<number, number>(sentRows.map(r => [r.productId, Number(r.amount || 0)]));

  // 3) รวม inflow ต่อ "หมวด/เลข" (รองรับแปลง TOD3 → TOP3 ก่อนคิดอั้น)
  type Key = string; // `${category}|${number}`
  const inflowMap = new Map<Key, number>();
  const pidByKey = new Map<Key, number>(); // product id สำหรับคีย์นั้น (สร้างเพิ่มตอนแปลง)

  for (const r of inflowRows) {
    if (cap.convertTod3ToTop3 && r.category === 'TOD3') {
      const perList = perms3(r.number);
      // กระจายเท่า ๆ กันและปัดขึ้นตามกติกาที่ตกลง
      const perEach = Math.ceil(Number(r.inflow || 0) / perList.length);
      for (const num of perList) {
        const key: Key = `TOP3|${num}`;
        inflowMap.set(key, (inflowMap.get(key) ?? 0) + perEach);
      }
      // ไม่เก็บ TOD3 ถ้าแปลง
      continue;
    }
    const key: Key = `${r.category}|${r.number}`;
    inflowMap.set(key, (inflowMap.get(key) ?? 0) + Number(r.inflow || 0));
    pidByKey.set(key, r.productId);
  }

  // 4) คำนวณ toSend = max(inflowAccum - cap - sentAlready, 0)
  const results: { category: Category; number: string; toSend: number }[] = [];

  for (const [key, inflowAccum] of inflowMap) {
    const [catStr, number] = key.split('|');
    const category = catStr as Category;

    // หา productId เพื่อดู sentAlready (กรณี TOP3 ที่มาจากการแปลง อาจยังไม่มี pid ใน map เดิม → sentAlready = 0)
    const product = await prisma.product.findFirst({
      where: { category, number },
      select: { id: true },
    });
    const productId = product?.id ?? pidByKey.get(key);
    const already = productId ? (sentMap.get(productId) ?? 0) : 0;

    const capAmt = capFor(category, cap);
    const toSend = Math.max(inflowAccum - capAmt - already, 0);
    if (toSend > 0) results.push({ category, number, toSend });
  }

  // เรียงยอดมาก → น้อย และแบ่งหน้า
  results.sort((a, b) => b.toSend - a.toSend);
  const total = results.length;
  const start = (page - 1) * pageSize;
  const items = results.slice(start, start + pageSize);

  // shape ให้ตรงกับหน้าปัจจุบัน (คอลัมน์ “ยอดรวม” คือยอดที่ต้องส่ง)
  const response = {
    from: from.toISOString(),
    to: to.toISOString(),
    total,
    items: items.map(r => ({
      category: r.category,
      number: r.number,
      totalBuy: r.toSend, // หน้าตารางใช้ชื่อเดิม totalBuy → แสดงยอดที่จะส่ง
    })),
    page, pageSize,
  };

  return NextResponse.json(response);
}
