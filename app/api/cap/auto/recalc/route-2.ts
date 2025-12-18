import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const CATEGORY_VALUES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const
type Category = (typeof CATEGORY_VALUES)[number]

const PAYOUT_BY_CAT: Record<Category, number> = {
  TOP3: 600,
  TOD3: 100,
  TOP2: 70,
  BOTTOM2: 70,
  RUN_TOP: 3,
  RUN_BOTTOM: 4,
};

const DEFAULT_DISCOUNT_PCT: Record<Category, number> = {
  TOP3: 30,
  TOD3: 20,
  TOP2: 20,
  BOTTOM2: 20,
  RUN_TOP: 15,
  RUN_BOTTOM: 15,
};

// ระบุฟิลด์ของแต่ละหมวดสำหรับ AUTO (Top-K, threshold, effectiveAt)
const fieldMap: Record<Category, { count: string; threshold: string; effectiveAt: string }> = {
  TOP3:       { count: 'autoTop3Count',      threshold: 'autoThresholdTop3',      effectiveAt: 'effectiveAtTop3' },
  TOD3:       { count: 'autoTod3Count',      threshold: 'autoThresholdTod3',      effectiveAt: 'effectiveAtTod3' },
  TOP2:       { count: 'autoTop2Count',      threshold: 'autoThresholdTop2',      effectiveAt: 'effectiveAtTop2' },
  BOTTOM2:    { count: 'autoBottom2Count',   threshold: 'autoThresholdBottom2',   effectiveAt: 'effectiveAtBottom2' },
  RUN_TOP:    { count: 'autoRunTopCount',    threshold: 'autoThresholdRunTop',    effectiveAt: 'effectiveAtRunTop' },
  RUN_BOTTOM: { count: 'autoRunBottomCount', threshold: 'autoThresholdRunBottom', effectiveAt: 'effectiveAtRunBottom' },
} as const

function parseDate(v?: unknown): Date | undefined {
  if (!v) return undefined
  const d = new Date(v as string)
  return isNaN(d.getTime()) ? undefined : d
}

// ---- Singleton helpers ----
async function getOrCreateCapRule() {
  // บังคับให้มีแถวเดียว id = 1 เสมอ
  return prisma.capRule.upsert({
    where: { id: 1 },
    create: { id: 1, mode: 'MANUAL', convertTod3ToTop3: false },
    update: {},
  })
}

function getDiscountPct(cap: any, cat: Category, provided?: number): number {
  const fm = fieldMap[cat]
  const fromCap = Number(cap?.[fm.count] ?? 0)
  const v = Number(provided ?? 0)

  // ลำดับความสำคัญ: body.discountPct (ถ้าส่งมา) -> ค่าที่เก็บใน capRule -> ค่า default ตามหมวด
  const picked = Number.isFinite(v) && v > 0 ? v : fromCap

  // รองรับทั้งกรอกแบบ 30 (เปอร์เซ็นต์) หรือ 0.3 (สัดส่วน)
  const pct = Number.isFinite(picked) ? (picked <= 1 ? picked * 100 : picked) : DEFAULT_DISCOUNT_PCT[cat]
  return Math.min(100, Math.max(0, pct))
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const from = parseDate(body.from)
    const to   = parseDate(body.to)
    const catKey = (body.category as string | undefined) ?? 'TOP3'
    const KInput = Number(body.K ?? 0)

    if (!CATEGORY_VALUES.includes(catKey as Category)) {
      return NextResponse.json({ error: `invalid category: ${catKey}` }, { status: 400 })
    }
    const cat = catKey as Category
    const fm = fieldMap[cat]

    // ✅ ใช้ singleton upsert แทน findFirst
    const cap = await getOrCreateCapRule()
    const topK = getDiscountPct(cap as any, cat, KInput)

    // ใช้ type ง่าย ๆ แทน Prisma.OrderItemWhereInput['createdAt']
    const createdAtFilter: { gte?: Date; lt?: Date } = {}
    if (from) createdAtFilter.gte = from
    if (to)   createdAtFilter.lt  = to

    // รวมยอดสั่งซื้อของหมวดที่เลือกในช่วงเวลา
    const rows = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: { createdAt: createdAtFilter, product: { category: cat } },
      _sum: { sumAmount: true },
    })

    // ไม่มีข้อมูลในช่วง → อัปเดต threshold = 0 แล้วคืนค่า
    if (!rows.length) {
      const data: any = {
        mode: 'AUTO' as any,
        [fm.count]: topK,
        [fm.threshold]: 0 as any,
        [fm.effectiveAt]: new Date(),
      }
      const updated = await prisma.capRule.update({ where: { id: 1 }, data })
      const effectiveAt = (updated as any)[fm.effectiveAt] as Date | null
      return NextResponse.json({ category: cat, topK, threshold: 0, effectiveAt })
    }

    // map productId -> number
    const productIds = rows.map((r: any) => r.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, number: true },
    })
    const toNumber = new Map(products.map((p: any) => [p.id, p.number]))

    // สูตร auto ใหม่: ยอดอั้น = ยอดรับ*(1-ส่วนลด)/ราคาถูกรางวัล  (ปัดขึ้นเป็นบาทเต็ม)
    const discountPct = topK; // topK ใน API/DB เดิม เปลี่ยนความหมายเป็น %ส่วนลด
    const payout = PAYOUT_BY_CAT[cat] ?? 0
    const acceptTotal = rows.reduce((sum: number, r: any) => sum + Number(r._sum.sumAmount ?? 0), 0)
    const net = acceptTotal * (1 - discountPct / 100)
    const threshold = payout > 0 ? Math.ceil(net / payout) : 0

    // อัปเดต snapshot สำหรับหมวดนั้น ๆ
    const data: any = {
      mode: 'AUTO' as any,
      [fm.count]: discountPct,
      [fm.threshold]: threshold as any,
      [fm.effectiveAt]: new Date(),
    }
    const updated = 
await prisma.capRule.update({ where: { id: 1 }, data })
    const effectiveAt = (updated as any)[fm.effectiveAt] as Date | null

    return NextResponse.json({
      category: cat,
      topK,
      threshold,
      effectiveAt,
      sample: [],
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e?.message ?? 'recalc failed' }, { status: 500 })
  }
}
