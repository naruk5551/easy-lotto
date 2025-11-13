// app/api/settle/detail/route.ts
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const latest = searchParams.get('latest')
    const batchIdParam = searchParams.get('batchId')

    // เลือก batch
    let batchId: number | null = null
    if (latest === 'true' && !batchIdParam) {
      const last = await prisma.settleBatch.findFirst({
        orderBy: { id: 'desc' },
        select: { id: true, from: true, to: true, createdAt: true },
      })
      if (!last) return NextResponse.json({ error: 'no batch found' }, { status: 404 })
      batchId = last.id
    } else {
      const n = Number(batchIdParam)
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ error: 'batchId must be a positive integer' }, { status: 400 })
      }
      batchId = n
    }

    const batch = await prisma.settleBatch.findUnique({
      where: { id: batchId! },
      select: { id: true, from: true, to: true, createdAt: true },
    })
    if (!batch) return NextResponse.json({ error: 'batch not found' }, { status: 404 })

    const rows = await prisma.excessBuy.findMany({
      where: { batchId: batchId! },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        product: { select: { category: true, number: true } },
      },
      orderBy: [{ id: 'asc' }],
    })

    const items = rows.map(r => ({
      id: r.id,
      category: r.product?.category ?? null,
      number: r.product?.number ?? null,
      amount: Number(r.amount),
      createdAt: r.createdAt,
    }))

    return NextResponse.json({ batch, items, count: items.length })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e?.message ?? 'detail failed' }, { status: 500 })
  }
}
