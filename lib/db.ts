// lib/db.ts

// ใช้ prisma ตัวกลางจาก lib/prisma
import { prisma as prismaClient } from './prisma';

declare global {
  // eslint-disable-next-line no-var
  var prisma: typeof prismaClient | undefined;
}

// export prisma ให้ไฟล์อื่นใช้งาน
export const prisma = prismaClient;

export default prismaClient;
