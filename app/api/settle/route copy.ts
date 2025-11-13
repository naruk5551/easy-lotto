// app/api/settle/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Category, Prisma } from '@prisma/client'


function parseDate(v?: unknown): Date | undefined {
  if (!v) return undefined
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? undefined : d
}

function uniquePermutations3(numStr: string): string[] {
  const s = (numStr || '').trim()
  if (s.length !== 3) return [s]
  const a = s[0], b = s[1], c = s[2]
  return Array.from(new Set([
    `${a}${b}${c}`, `${a}${c}${b}`,
    `${b}${a}${c}`, `${b}${c}${a}`,
    `${c}${a}${b}`, `${c}${b}${a}`,
  ]))
}

export async function POST(req: NextRequest) {
  // 1) รองรับทั้ง body JSON และ query string
  let from: Date | undefined
  let to: Date | undefined
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json().catch(() => ({} as any))
      from = parseDate(body?.from)
      to   = parseDate(body?.to)
    }
  } catch { /* noop */ }

  if (!from || !to) {
    const { searchParams } = new URL(req.url)
    from ??= parseDate(searchParams.get('from') || undefined)
    to   ??= parseDate(searchParams.get('to')   || undefined)
  }

  if (!from || !to) {
    return NextResponse.json({ error: 'from/to required (ISO datetime)' }, { status: 400 })
  }

  try {
    // 2) Idempotency ด้วย SettleBatch (from,to)
    const existingBatch = await prisma.settleBatch.findFirst({
      where: { from, to },
      select: { id: true }
    })
    if (existingBatch) {
      const count = await prisma.excessBuy.count({ where: { batchId: existingBatch.id } })
      return NextResponse.json({
        alreadyExists: true,
        batchId: existingBatch.id,
        createdCount: count,
      })
    }

    const batch = await prisma.settleBatch.create({ data: { from, to } })

    // 3) โหลด config
    const cap = await prisma.capRule.upsert({
      where: { id: 1 },
      create: { id: 1, mode: 'MANUAL', convertTod3ToTop3: false },
      update: {},
      select: { convertTod3ToTop3: true }
    })
    const shouldConvertTod3 = !!cap.convertTod3ToTop3

    // 4) รวม inflow
    const inflows = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: { createdAt: { gte: from, lt: to } },
      _sum: { sumAmount: true },
    })
    if (inflows.length === 0) {
      return NextResponse.json({ batchId: batch.id, createdCount: 0, created: [] })
    }

    // 5) ดึงสินค้า + รับเอง
    const productIds = inflows.map(i => i.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, category: true, number: true },
    })
    const pById = new Map(products.map(p => [p.id, p]))

    const selfRows = await prisma.acceptSelf.groupBy({
      by: ['category', 'number'],
      where: { createdAt: { gte: from, lt: to } },
      _sum: { amount: true },
    })
    const selfMap = new Map(selfRows.map(r => [`${r.category}|${r.number}`, Number(r._sum?.amount ?? 0)]))

    // 6) คำนวณและสร้าง ExcessBuy (ผูก batchId)
    const created: any[] = []
    for (const i of inflows) {
      const p = pById.get(i.productId)
      if (!p) continue

      const inflow = Number(i._sum?.sumAmount ?? 0)
      const selfAmt = selfMap.get(`${p.category}|${p.number}`) ?? 0
      const toSend = Math.max(inflow - selfAmt, 0)
      if (toSend <= 0) continue

      if (shouldConvertTod3 && p.category === Category.TOD3) {
        const perms = uniquePermutations3(p.number)
        const perEach = Math.ceil(toSend / perms.length)
        for (const num of perms) {
          let top3 = await prisma.product.findFirst({
            where: { category: Category.TOP3, number: num },
            select: { id: true }
          })
          if (!top3) {
            top3 = await prisma.product.create({
              data: { category: Category.TOP3, number: num },
              select: { id: true }
            })
          }
          const row = await prisma.excessBuy.create({
            data: { productId: top3.id, amount: perEach, batchId: batch.id }
          })
          created.push(row)
        }
      } else {
        const row = await prisma.excessBuy.create({
          data: { productId: p.id, amount: toSend, batchId: batch.id }
        })
        created.push(row)
      }
    }

    return NextResponse.json({ batchId: batch.id, createdCount: created.length, created })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message ?? 'settle failed' }, { status: 500 })
  }
}
