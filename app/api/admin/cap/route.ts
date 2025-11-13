import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { CapRuleSchema } from '@/lib/validators';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rule = await prisma.capRule.findFirst({ orderBy: { id: 'desc' } });
  return NextResponse.json({ rule });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = CapRuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const rule = await prisma.capRule.create({ data: parsed.data as any });
  return NextResponse.json({ ok: true, rule });
}
