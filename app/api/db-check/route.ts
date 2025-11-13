export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      current_database()    AS db,
      current_user          AS usr,
      inet_server_addr()    AS host,
      inet_server_port()    AS port
  `);
  return NextResponse.json(rows[0]);
}
