// /app/api/products/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return new NextResponse('id ไม่ถูกต้อง', { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const number = String(body?.number ?? '').trim();
    if (!number) {
      return new NextResponse('กรุณาระบุเลขใหม่', { status: 400 });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: { number },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e: any) {
    // จัดการกรณีชน unique ([category, number])
    const msg = typeof e?.message === 'string' ? e.message : 'แก้ไขไม่สำเร็จ';
    return new NextResponse(msg, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return new NextResponse('id ไม่ถูกต้อง', { status: 400 });
    }

    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'ลบไม่สำเร็จ';
    return new NextResponse(msg, { status: 400 });
  }
}
