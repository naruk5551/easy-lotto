// app/api/summary/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Category, Prisma } from '@prisma/client'

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const from = parseDate(searchParams.get('from') || undefined)
    const to   = parseDate(searchParams.get('to')   || undefined)
    const category = searchParams.get('category') as Category | null
    const number   = searchParams.get('number')   || undefined

    // แยกชนิด filter ต่อโมเดล
    const createdAtOI: Prisma.OrderItemWhereInput['createdAt'] = {}
    const createdAtAS: Prisma.AcceptSelfWhereInput['createdAt'] = {}
    const createdAtEB: Prisma.ExcessBuyWhereInput['createdAt'] = {}
    if (from) { createdAtOI.gte = from; createdAtAS.gte = from; createdAtEB.gte = from }
    if (to)   { createdAtOI.lt  = to;   createdAtAS.lt  = to;   createdAtEB.lt  = to   }

    // 1) inflow จาก OrderItem
    const inflows = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        createdAt: createdAtOI,
        product: { category: category ?? undefined, number: number ?? undefined },
      },
      _sum: { sumAmount: true },
    })
    const inflowProductIds = inflows.map(i => i.productId)
    const productsA = await prisma.product.findMany({
      where: { id: { in: inflowProductIds } },
      select: { id: true, category: true, number: true },
    })
    const prodById = new Map(productsA.map(p => [p.id, p]))
    const inflowByKey = new Map<string, number>()
    for (const i of inflows) {
      const p = prodById.get(i.productId)
      if (!p) continue
      const key = `${p.category}|${p.number}`
      inflowByKey.set(key, Number(i._sum?.sumAmount ?? 0))
    }

    // 2) AcceptSelf (อาจมีคีย์ที่ไม่อยู่ใน inflow)
    const selfRows = await prisma.acceptSelf.groupBy({
      by: ['category', 'number'],
      where: {
        createdAt: createdAtAS,
        category: category ?? undefined,
        number: number ?? undefined,
      },
      _sum: { amount: true },
    })
    const selfByKey = new Map<string, number>(
      selfRows.map(r => [`${r.category}|${r.number}`, Number(r._sum?.amount ?? 0)])
    )

    // 3) Hedged (ExcessBuy)
    const hedgeRows = await prisma.excessBuy.groupBy({
      by: ['productId'],
      where: { createdAt: createdAtEB },
      _sum: { amount: true },
    })
    // ดึง product ของ hedged ทั้งหมด
    const hedgedPids = hedgeRows.map(r => r.productId).filter((x): x is number => x != null)
    const productsH = await prisma.product.findMany({
      where: { id: { in: hedgedPids } },
      select: { id: true, category: true, number: true },
    })
    const hedgedProductById = new Map(productsH.map(p => [p.id, p]))
    const hedgedByProduct = new Map<number, number>()
    for (const r of hedgeRows) {
      const pid = r.productId as number | null
      if (pid == null) continue
      hedgedByProduct.set(pid, Number(r._sum?.amount ?? 0))
    }

    // 4) รวมคีย์: inflow ∪ self ∪ hedged-only
    const unionKeys = new Set<string>()
    for (const k of inflowByKey.keys()) unionKeys.add(k)
    for (const k of selfByKey.keys())   unionKeys.add(k)
    for (const [pid] of hedgedByProduct) {
      const p = hedgedProductById.get(pid)
      if (!p) continue
      const key = `${p.category}|${p.number}`
      // เคารพ filter category/number ถ้ามี
      if (category && p.category !== category) continue
      if (number && p.number !== number) continue
      unionKeys.add(key)
    }

    // 5) เตรียม map หา productId ของทุกคีย์ที่รวม (เพื่อดึง hedged ตาม pid)
    const needProducts = Array.from(unionKeys).map(k => {
      const [cat, num] = k.split('|') as [Category, string]
      return { category: cat, number: num }
    })
    const productsAll = await prisma.product.findMany({
      where: { OR: needProducts },
      select: { id: true, category: true, number: true },
    })
    const idByKey = new Map(productsAll.map(p => [`${p.category}|${p.number}`, p.id]))

    // 6) ประกอบผลลัพธ์
    const rows = Array.from(unionKeys).map(k => {
      const [cat, num] = k.split('|') as [Category, string]
      const inflow = inflowByKey.get(k) ?? 0
      const self   = selfByKey.get(k)   ?? 0
      const pid    = idByKey.get(k)
      const hedged = pid ? (hedgedByProduct.get(pid) ?? 0) : 0
      const shouldSend = Math.max(inflow - self, 0)
      return { category: cat, number: num, inflow, acceptSelf: self, shouldSend, hedged, net: inflow - hedged }
    }).sort((a,b) => {
      if (a.category < b.category) return -1
      if (a.category > b.category) return 1
      return a.number.localeCompare(b.number)
    })

    return NextResponse.json({ from, to, rows })
  } catch (e:any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
