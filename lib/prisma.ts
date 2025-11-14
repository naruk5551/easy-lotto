// lib/prisma.ts
import { PrismaClient as PrismaClientType } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientType | undefined;
}

export const prisma: PrismaClientType =
  global.prisma ??
  new PrismaClientType({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}
