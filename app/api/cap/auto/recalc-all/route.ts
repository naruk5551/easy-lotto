import { NextRequest, NextResponse } from 'next/server'
import { Category } from '@prisma/client'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any))
    const from = body.from
    const to   = body.to
    const K    = body.K

    const baseUrl = new URL('/api/cap/auto/recalc', req.nextUrl.origin).toString()

    const cats = [
      Category.TOP3,
      Category.TOD3,
      Category.TOP2,
      Category.BOTTOM2,
      Category.RUN_TOP,
      Category.RUN_BOTTOM,
    ]

    const results = []
    for (const c of cats) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, K, category: c }),
        cache: 'no-store',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || `recalc failed for ${c}`)
      results.push(j)
    }

    return NextResponse.json({ ok: true, results })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json({ error: e?.message ?? 'recalc-all failed' }, { status: 500 })
  }
}
