// app/api/accept-self/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const CATEGORIES = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const
type Category = (typeof CATEGORIES)[number]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { category, number, amount, reason } = body || {}
    if (!category || !number || !amount) {
      return NextResponse.json({ error: 'category, number, amount required' }, { status: 400 })
    }
    if (!CATEGORIES.includes(category as Category)) {
      return NextResponse.json({ error: 'invalid category' }, { status: 400 })
    }
    const row = await prisma.acceptSelf.create({
      data: {
        category,
        number,
        amount,
        reason: reason ?? null,
      }
    })
    return NextResponse.json(row)
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
