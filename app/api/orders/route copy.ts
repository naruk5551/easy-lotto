// app/api/orders/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLatestTimeWindow, isNowInWindow } from '@/lib/timeWindow';
import { Category as PrismaCategory } from '@prisma/client';

function toPrismaCategory(input: string): PrismaCategory {
  const values = Object.values(PrismaCategory) as string[];
  if (!values.includes(input)) throw new Error(`หมวดไม่ถูกต้อง: ${input}`);
  return input as PrismaCategory;
}

function onlyDigits(s: string) {
  return (s ?? '').replace(/\D+/g, '');
}

function requiredLength(cat: PrismaCategory) {
  if (cat === 'TOP3' || cat === 'TOD3') return 3;
  if (cat === 'TOP2' || cat === 'BOTTOM2') return 2;
  return 1; // RUN_TOP | RUN_BOTTOM
}

function catTH(cat: PrismaCategory) {
  switch (cat) {
    case 'TOP3': return '3 ตัวบน';
    case 'TOD3': return '3 โต๊ด';
    case 'TOP2': return '2 ตัวบน';
    case 'BOTTOM2': return '2 ตัวล่าง';
    case 'RUN_TOP': return 'วิ่งบน';
    case 'RUN_BOTTOM': return 'วิ่งล่าง';
  }
}

/** retry เฉพาะ P2024: pool timeout */
async function withPrismaRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 250
): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.code === 'P2024' && retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return withPrismaRetry(fn, retries - 1, Math.min(delayMs * 2, 1500));
    }
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    // 1) ต้องอยู่ใน time window ล่าสุด
    const latest = await withPrismaRetry(() => getLatestTimeWindow());
    if (!latest) {
      return new NextResponse('ยังไม่ได้ตั้งช่วงเวลา (time-window)', { status: 400 });
    }
    if (!isNowInWindow(latest.startAt, latest.endAt)) {
      return new NextResponse('หมดเวลาลงสินค้า', { status: 400 });
    }

    // 2) รับค่าจาก client
    const body = await req.json();
    const { category, items, userId } = body as {
      category: string;
      items: Array<{ number: string; priceMain?: number; priceTod?: number }>;
      userId?: number;
    };

    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      return new NextResponse('ต้องระบุ userId (จำนวนเต็ม > 0)', { status: 400 });
    }
    if (!category) return new NextResponse('กรุณาระบุหมวด', { status: 400 });
    if (!Array.isArray(items) || items.length === 0) {
      return new NextResponse('ไม่มีรายการ', { status: 400 });
    }

    const prismaCategory = toPrismaCategory(category);
    const expectLen = requiredLength(prismaCategory);

    // 3) ตรวจความถูกต้อง “บังคับหมวดตามจำนวนหลัก”
    const normalized = items.map((it, idx) => {
      const number = onlyDigits(String(it.number));
      const priceMain = Number(it.priceMain ?? 0);
      const priceTod = Number(it.priceTod ?? 0);
      const price = priceMain > 0 ? priceMain : priceTod; // ใช้ main ก่อน ถ้าไม่มีก็ใช้ tod
      const sumAmount = (priceMain || 0) + (priceTod || 0);

      if (!number) {
        throw new Error(`แถวที่ ${idx + 1}: ไม่ได้กรอกเลข`);
      }
      if (number.length !== expectLen) {
        // ชี้แนะหมวดที่ถูกต้องด้วย
        const hint =
          number.length === 3 ? 'ควรเลือก “3 ตัวบน” หรือ “3 โต๊ด”' :
          number.length === 2 ? 'ควรเลือก “2 ตัวบน” หรือ “2 ตัวล่าง”' :
          'ควรเลือก “วิ่งบน” หรือ “วิ่งล่าง”';
        throw new Error(
          `แถวที่ ${idx + 1}: หมวด ${catTH(prismaCategory)} ต้องเป็นเลข ${expectLen} หลัก (คุณกรอก ${number.length}) — ${hint}`
        );
      }
      if (!(Number.isFinite(price) && price > 0) || !(Number.isFinite(sumAmount) && sumAmount > 0)) {
        throw new Error(`แถวที่ ${idx + 1}: ราคาไม่ถูกต้อง`);
      }

      return { number, price, sumAmount };
    });

    // 4) เตรียม/สร้าง Product ตามหมวดหมู่ที่ถูกต้อง
    const numbers = Array.from(new Set(normalized.map((x) => x.number)));

    const existing = await withPrismaRetry(() =>
      prisma.product.findMany({
        where: { category: prismaCategory, number: { in: numbers } },
        select: { id: true, number: true },
      })
    );
    const existMap = new Map(existing.map((p) => [p.number, p.id]));

    const missing = numbers.filter((n) => !existMap.has(n));
    if (missing.length) {
      await withPrismaRetry(() =>
        prisma.product.createMany({
          data: missing.map((n) => ({ category: prismaCategory, number: n })),
          skipDuplicates: true,
        })
      );
    }

    // ดึง id อีกรอบให้ครบ
    const all = await withPrismaRetry(() =>
      prisma.product.findMany({
        where: { category: prismaCategory, number: { in: numbers } },
        select: { id: true, number: true },
      })
    );
    const idMap = new Map(all.map((p) => [p.number, p.id]));

    // 5) บันทึก Order + Items
    const order = await withPrismaRetry(() =>
      prisma.order.create({
        data: {
          createdAt: new Date(), // UTC
          user: { connect: { id: userId } },
          items: {
            create: normalized.map((it) => {
              const productId = idMap.get(it.number);
              if (!productId) throw new Error(`ไม่พบสินค้าเลข ${it.number}`);
              return {
                price: it.price,
                sumAmount: it.sumAmount,
                product: { connect: { id: productId } },
              };
            }),
          },
        },
        include: { items: true },
      })
    );

    return NextResponse.json({ ok: true, orderId: order.id });
  } catch (e: any) {
    console.error('❌ /api/orders error:', e);
    const msg = typeof e?.message === 'string' && e.message ? e.message : 'เกิดข้อผิดพลาดระหว่างบันทึก';
    return new NextResponse(msg, { status: 400 });
  }
}
