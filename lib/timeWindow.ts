import { prisma } from '@/lib/prisma';

export async function getLatestTimeWindow() {
  // ดึงรายการ id ล่าสุด (ถือว่า "ล่าสุด" คือ id มากสุด)
  const w = await prisma.timeWindow.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true, startAt: true, endAt: true },
  });
  return w;
}

export function isNowInWindow(startAt: Date | string, endAt: Date | string): boolean {
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  const now = Date.now(); // epoch ms — ไม่ขึ้นกับโซนเวลา
  return now >= s && now <= e;
}
