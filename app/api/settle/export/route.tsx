// app/api/settle/export/route.tsx
import React from 'react'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import JSZip from 'jszip'
import satori from 'satori'
import dayjs from 'dayjs'

export const runtime = 'nodejs' // ให้รันบน Node.js runtime

const PAGE_SIZE = 20 as const

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px',
        gap: '12px',
        padding: '6px 12px',
      }}
    >
      <div>{left}</div>
      <div style={{ textAlign: 'right' }}>{right}</div>
    </div>
  )
}

async function renderPagePNG({
  title,
  page,
  totalPages,
  rows,
}: {
  title: string
  page: number
  totalPages: number
  rows: { left: string; right: string }[]
}) {
  // 1) สร้าง SVG ด้วย satori
  const svg = await satori(
    <div
      style={{
        fontFamily: 'Arial',
        width: '800px',
        height: '1120px',
        padding: '16px',
        background: '#fff',
        color: '#111',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '8px',
          fontSize: '16px',
          fontWeight: 600,
        }}
      >
        <div>{title}</div>
        <div>
          หน้า {page}/{totalPages}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #ddd', borderBottom: '1px solid #ddd' }}>
        {rows.map((r:any, i:any) => (
          <Row key={i} left={r.left} right={r.right} />
        ))}
      </div>

      <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
        สร้างเมื่อ {dayjs().format('YYYY-MM-DD HH:mm:ss')}
      </div>
    </div>,
    {
      width: 800,
      height: 1120,
      fonts: [], // ถ้ามีไฟล์ .ttf สามารถระบุเพื่อให้ตัวหนังสือสวยขึ้น
    },
  )

  // 2) แปลง SVG → PNG ด้วย resvg (dynamic import เลี่ยงปัญหา bundle)
  const { Resvg } = await import('@resvg/resvg-js')
  const png = new Resvg(svg).render().asPng() // Uint8Array
  return png
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const { windowId } = z
    .object({ windowId: z.coerce.number() })
    .parse({ windowId: searchParams.get('windowId') })

  // รวมยอด "excess" ที่ต้องส่งเจ้ามือ ของ time window ที่เลือก เรียงจากมากไปน้อย
  const rows = await prisma.$queryRaw<
    { category: string; number: string; amount: string }[]
  >`
    select p."category", p."number", sum(ex."amount") as amount
    from "ExcessBuy" ex
    join "OrderItem" oi on oi."id" = ex."orderItemId"
    join "Order" o on o."id" = oi."orderId"
    join "Product" p on p."id" = oi."productId"
    join "TimeWindow" tw on o."createdAt" between tw."startAt" and tw."endAt"
    where tw."id" = ${windowId}
    group by p."category", p."number"
    having sum(ex."amount") > 0
    order by sum(ex."amount") desc
  `

  // จัดข้อความแถวซ้าย/ขวา
  const list = rows.map((r:any) => ({
    left: `${r.number} (${r.category})`,
    right: Number(r.amount).toLocaleString(),
  }))

  const pages = chunk(list, PAGE_SIZE)
  const zip = new JSZip()

  for (let i = 0; i < pages.length; i++) {
    const png = await renderPagePNG({
      title: `ยอดส่งเจ้ามือ — Window #${windowId}`,
      page: i + 1,
      totalPages: pages.length,
      rows: pages[i] as any,
    })
    zip.file(`settle-${(i + 1).toString().padStart(2, '0')}.png`, png)
  }

  // ส่งเป็น zip (arraybuffer) ให้ดาวน์โหลด
  const zipAb = await zip.generateAsync({ type: 'arraybuffer' })
  return new NextResponse(zipAb, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="settle_window_${windowId}.zip"`,
    },
  })
}
