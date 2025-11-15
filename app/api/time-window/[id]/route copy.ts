import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// helper: แปลงสตริง datetime ให้เป็น Date ที่ valid
function parseMaybeDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'string') {
    // รองรับรูปแบบ "yyyy-mm-ddTHH:mm" ที่ไม่ใส่วินาที
    const s = v.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) ? `${v}:00` : v;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// PUT /api/time-window/:id
// body: { startAt?: string|Date, endAt?: string|Date, note?: string|null }
// - ถ้าไม่ส่งบางฟิลด์มา จะใช้ค่าเดิมจาก DB
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> } // ⬅️ params เป็น Promise ใน Next.js 16
) {
  try {
    const { id: idStr } = await ctx.params; // ⬅️ ต้อง await ก่อนใช้
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) {
      return new NextResponse('id ไม่ถูกต้อง', { status: 400 });
    }

    const body = await req.json().catch(() => ({} as any));
    const startRaw = body?.startAt ?? null;
    const endRaw = body?.endAt ?? null;
    const noteRaw = body?.note ?? undefined;

    // โหลดค่าปัจจุบันจาก DB ก่อน (สำหรับ fallback)
    const current = await prisma.timeWindow.findUnique({
      where: { id },
      select: { startAt: true, endAt: true, note: true },
    });
    if (!current) return new NextResponse('ไม่พบรายการ', { status: 404 });

    const startAt = parseMaybeDate(startRaw) ?? current.startAt;
    const endAt = parseMaybeDate(endRaw) ?? current.endAt;
    const note: string | null =
      noteRaw === undefined ? current.note : (noteRaw ?? null);

    if (
      !(startAt instanceof Date) ||
      isNaN(startAt.getTime()) ||
      !(endAt instanceof Date) ||
      isNaN(endAt.getTime())
    ) {
      return new NextResponse('startAt/endAt ไม่ถูกต้อง', { status: 400 });
    }
    if (endAt <= startAt) {
      return new NextResponse('endAt ต้องมากกว่า startAt', { status: 400 });
    }

    await prisma.timeWindow.update({
      where: { id },
      data: { startAt, endAt, note },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('PUT /api/time-window/[id] error:', e);
    if (e?.code === 'P2025') return new NextResponse('ไม่พบรายการ', { status: 404 });
    return new NextResponse(e?.message || 'Internal Error', { status: 500 });
  }
}

// DELETE /api/time-window/:id
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // ⬅️ เช่นกัน ต้อง await
) {
  try {
    const { id: idStr } = await ctx.params; // ⬅️ await ก่อนใช้
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) {
      return new NextResponse('id ไม่ถูกต้อง', { status: 400 });
    }

    await prisma.timeWindow.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('DELETE /api/time-window/[id] error:', e);
    if (e?.code === 'P2025') return new NextResponse('ไม่พบรายการ', { status: 404 });
    return new NextResponse(e?.message || 'Internal Error', { status: 500 });
  }
}
