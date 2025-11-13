import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CapMode, Prisma } from '@prisma/client'

const CATEGORY_VALUES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const
type Category = (typeof CATEGORY_VALUES)[number]

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

function getTopK(cap: any, cat: Category, providedK?: number) {
  const fm = fieldMap[cat]
  const fromCap = Number(cap?.[fm.count] ?? 0)
  const k = Number(providedK ?? 0)
  // ลำดับความสำคัญ: body.K > cap[fm.count] > 300
  return k > 0 ? k : fromCap > 0 ? fromCap : 300
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
    const topK = getTopK(cap as any, cat, KInput)

    const createdAtFilter: Prisma.OrderItemWhereInput['createdAt'] = {}
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
        mode: CapMode.AUTO,
        [fm.count]: topK,
        [fm.threshold]: new Prisma.Decimal(0),
        [fm.effectiveAt]: new Date(),
      }
      const updated = await prisma.capRule.update({ where: { id: 1 }, data })
      const effectiveAt = (updated as any)[fm.effectiveAt] as Date | null
      return NextResponse.json({ category: cat, topK, threshold: 0, effectiveAt })
    }

    // map productId -> number
    const productIds = rows.map(r => r.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, number: true },
    })
    const toNumber = new Map(products.map(p => [p.id, p.number]))

    // จัดอันดับตามยอดรวม
    const list = rows
      .map(r => ({
        number: toNumber.get(r.productId)!,
        amount: Number(r._sum.sumAmount ?? 0),
      }))
      .sort((a, b) => b.amount - a.amount)

    const top = list.slice(0, topK)
    const threshold = top.length ? top[top.length - 1].amount : 0

    // อัปเดต snapshot สำหรับหมวดนั้น ๆ
    const data: any = {
      mode: CapMode.AUTO,
      [fm.count]: topK,
      [fm.threshold]: new Prisma.Decimal(threshold),
      [fm.effectiveAt]: new Date(),
    }
    const updated = await prisma.capRule.update({ where: { id: 1 }, data })
    const effectiveAt = (updated as any)[fm.effectiveAt] as Date | null

    return NextResponse.json({
      category: cat,
      topK,
      threshold,
      effectiveAt,
      sample: top.slice(0, 10),
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e?.message ?? 'recalc failed' }, { status: 500 })
  }
}
