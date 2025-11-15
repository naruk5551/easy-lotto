// app/api/prizes/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function fmtTH(d: Date) {
  return new Intl.DateTimeFormat('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  }).format(d);
}

// GET: งวดล่าสุด หรือ ?list=1 เพื่อดึงทั้งหมด
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wantList = searchParams.get('list') === '1';

  if (wantList) {
    const rows = await prisma.prizeSetting.findMany({
      orderBy: { id: 'desc' },
      include: { timeWindow: true },
    });
    const items = rows.map((r: any) => ({
      id: r.id,
      timeWindowId: r.timeWindowId,
      windowStartTH: fmtTH(r.timeWindow.startAt),
      windowEndTH: fmtTH(r.timeWindow.endAt),
      top3: r.top3, bottom2: r.bottom2,
      payoutTop3: r.payoutTop3, payoutTod3: r.payoutTod3, payoutTop2: r.payoutTop2,
      payoutBottom2: r.payoutBottom2, payoutRunTop: r.payoutRunTop, payoutRunBottom: r.payoutRunBottom,
      createdAtTH: fmtTH(r.createdAt),
    }));
    return NextResponse.json({ items });
  }

  // single (ล่าสุด)
  const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
  if (!tw) return NextResponse.json({ error: 'ยังไม่มี Time Window' }, { status: 400 });

  const p = await prisma.prizeSetting.upsert({
    where: { timeWindowId: tw.id },
    update: {},
    create: {
      timeWindowId: tw.id,
      top3: '000',
      bottom2: '00',
      payoutTop3: 600,
      payoutTod3: 100,
      payoutTop2: 70,
      payoutBottom2: 70,
      payoutRunTop: 3,
      payoutRunBottom: 4,
    },
  });

  return NextResponse.json({
    id: p.id,
    timeWindowId: p.timeWindowId,
    timeWindowStart: tw.startAt,
    timeWindowEnd: tw.endAt,
    top3: p.top3, bottom2: p.bottom2,
    payoutTop3: p.payoutTop3, payoutTod3: p.payoutTod3, payoutTop2: p.payoutTop2,
    payoutBottom2: p.payoutBottom2, payoutRunTop: p.payoutRunTop, payoutRunBottom: p.payoutRunBottom,
  });
}

// PUT: อัปเดตของงวดล่าสุด
export async function PUT(req: Request) {
  const body = await req.json();
  const tw = await prisma.timeWindow.findFirst({ orderBy: { id: 'desc' } });
  if (!tw) return NextResponse.json({ error: 'ยังไม่มี Time Window' }, { status: 400 });

  await prisma.prizeSetting.upsert({
    where: { timeWindowId: tw.id },
    create: {
      timeWindowId: tw.id,
      top3: String(body.top3 ?? '000').slice(0,3),
      bottom2: String(body.bottom2 ?? '00').slice(0,2),
      payoutTop3: Number(body.payoutTop3 ?? 600),
      payoutTod3: Number(body.payoutTod3 ?? 100),
      payoutTop2: Number(body.payoutTop2 ?? 70),
      payoutBottom2: Number(body.payoutBottom2 ?? 70),
      payoutRunTop: Number(body.payoutRunTop ?? 3),
      payoutRunBottom: Number(body.payoutRunBottom ?? 4),
    },
    update: {
      top3: String(body.top3 ?? '000').slice(0,3),
      bottom2: String(body.bottom2 ?? '00').slice(0,2),
      payoutTop3: Number(body.payoutTop3 ?? 600),
      payoutTod3: Number(body.payoutTod3 ?? 100),
      payoutTop2: Number(body.payoutTop2 ?? 70),
      payoutBottom2: Number(body.payoutBottom2 ?? 70),
      payoutRunTop: Number(body.payoutRunTop ?? 3),
      payoutRunBottom: Number(body.payoutRunBottom ?? 4),
    }
  });

  return NextResponse.json({ ok: true });
}

// DELETE?id=...
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id') ?? 0);
  if (!id) return NextResponse.json({ error: 'ต้องระบุ id' }, { status: 400 });

  await prisma.prizeSetting.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
