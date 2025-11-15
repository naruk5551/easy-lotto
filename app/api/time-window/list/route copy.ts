import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  const rows = await prisma.timeWindow.findMany({
    orderBy: { id: 'desc' },
    select: { id: true, startAt: true, endAt: true, note: true },
  });
  return NextResponse.json(rows);
}
