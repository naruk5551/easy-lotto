import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLatestTimeWindow, isNowInWindow } from '@/lib/timeWindow';
import { Category as PrismaCategory } from '@prisma/client';

function toPrismaCategory(input: string): PrismaCategory {
  const values = Object.values(PrismaCategory) as string[];
  if (!values.includes(input)) throw new Error(`หมวดไม่ถูกต้อง: ${input}`);
  return input as PrismaCategory;
}

/**
 * รีทรายเฉพาะเคสคอขวดคอนเนกชัน (P2024: pool timeout) ให้รอแล้วลองใหม่แบบ backoff
 * ไม่แตะเคส error อื่น ๆ
 */
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
    // 1) บังคับใช้ time-window ที่ยังเปิดอยู่ (อิง "id ล่าสุด")
    const latest = await withPrismaRetry(() => getLatestTimeWindow());
    if (!latest) {
      return new NextResponse('ยังไม่ได้ตั้งช่วงเวลา (time-window)', { status: 400 });
    }
    if (!isNowInWindow(latest.startAt, latest.endAt)) {
      // ✅ ปรับข้อความให้หน้า order แสดงแบนเนอร์ "หมดเวลาลงสินค้า"
      return new NextResponse('หมดเวลาลงสินค้า', { status: 400 });
    }

    // 2) รับค่า input
    const body = await req.json();
    const { category, items, userId } = body as {
      category: string;
      items: Array<{ number: string; priceMain?: number; priceTod?: number }>;
      userId?: number;
    };

    // ⛔ ต้องมี userId เสมอ เพราะ Order.user เป็น required
    if (!userId || !Number.isInteger(userId) || userId <= 0) {
      return new NextResponse('ต้องระบุ userId (จำนวนเต็ม > 0)', { status: 400 });
    }

    if (!category) return new NextResponse('กรุณาระบุหมวด', { status: 400 });
    if (!Array.isArray(items) || items.length === 0) {
      return new NextResponse('ไม่มีรายการ', { status: 400 });
    }

    // 3) แปลงหมวดให้เป็น enum ของ Prisma
    const prismaCategory = toPrismaCategory(category);

    // 4) ทำข้อมูลรายการให้ตรงสคีมา OrderItem (ไม่มี convertTod3ToTop3)
    const normalized = items
      .map((it) => {
        const priceMain = Number(it.priceMain ?? 0);
        const priceTod = Number(it.priceTod ?? 0);
        const price = priceMain > 0 ? priceMain : priceTod; // ใช้ main ก่อน ถ้าไม่มีค่อยใช้ tod
        const sumAmount = priceMain + priceTod; // รวมสองช่อง (ถ้ามี)
        return {
          number: String(it.number),
          price,
          sumAmount,
        };
      })
      .filter(
        (x) =>
          x.number &&
          Number.isFinite(x.price) &&
          x.price > 0 &&
          Number.isFinite(x.sumAmount) &&
          x.sumAmount > 0
      );

    if (normalized.length === 0) {
      return new NextResponse('ไม่มีรายการที่ราคามากกว่า 0', { status: 400 });
    }

    // 5) เตรียม Product ให้ครบ (เลี่ยง connectOrCreate เพื่อให้ type ชัด)
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

    // ดึง id อีกรอบให้ครบ (เพราะ createMany ไม่คืน id)
    const all = await withPrismaRetry(() =>
      prisma.product.findMany({
        where: { category: prismaCategory, number: { in: numbers } },
        select: { id: true, number: true },
      })
    );
    const idMap = new Map(all.map((p) => [p.number, p.id]));

    // 6) สร้าง Order (+ Items) — ใส่ user เป็น required เสมอ
    const order = await withPrismaRetry(() =>
      prisma.order.create({
        data: {
          createdAt: new Date(),
          user: { connect: { id: userId } }, // ✅ required relation
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
    const msg =
      typeof e?.message === 'string' && e.message
        ? e.message
        : 'เกิดข้อผิดพลาดระหว่างบันทึก';
    return new NextResponse(msg, { status: 400 });
  }
}
