import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CapMode } from '@prisma/client';

type Category = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';
const CAT_KEYS = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'] as const;

const mapManualKey = (cat: Category) => {
  switch (cat) {
    case 'TOP3': return 'top3';
    case 'TOD3': return 'tod3';
    case 'TOP2': return 'top2';
    case 'BOTTOM2': return 'bottom2';
    case 'RUN_TOP': return 'runTop';
    case 'RUN_BOTTOM': return 'runBottom';
  }
};
const mapAutoKey = (cat: Category) => {
  switch (cat) {
    case 'TOP3': return 'autoTop3';
    case 'TOD3': return 'autoTod3';
    case 'TOP2': return 'autoTop2';
    case 'BOTTOM2': return 'autoBottom2';
    case 'RUN_TOP': return 'autoRunTop';
    case 'RUN_BOTTOM': return 'autoRunBottom';
  }
};

function parseCategory(v: unknown): Category {
  const s = String(v || '');
  if (!(CAT_KEYS as readonly string[]).includes(s)) throw new Error('category ไม่ถูกต้อง');
  return s as Category;
}
function numOrNull(v: any): number|null {
  if (v === '' || v === null || typeof v === 'undefined') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error('พบค่าที่ไม่ถูกต้อง (ต้องเป็นตัวเลข ≥ 0 หรือเว้นว่าง)');
  return n;
}

// GET /api/cap  (หรือ /api/cap?category=TOP3)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    const cap = await prisma.capRule.findFirst({ orderBy: { id: 'desc' } });
    const mode = (cap?.mode ?? CapMode.MANUAL) as CapMode;
    const convertTod3ToTop3 = Boolean((cap as any)?.convertTod3ToTop3 ?? false);

    if (category) {
      const cat = parseCategory(category);
      const manualKey = mapManualKey(cat);
      const autoKey   = mapAutoKey(cat);
      return NextResponse.json({
        mode,
        convertTod3ToTop3,
        manual: (cap as any)?.[manualKey] ?? null,
        auto:   (cap as any)?.[autoKey]   ?? null,
      });
    }

    const manual: Record<string, number|null> = {};
    const auto:   Record<string, number|null> = {};
    for (const c of CAT_KEYS) {
      manual[mapManualKey(c)] = (cap as any)?.[mapManualKey(c)] ?? null;
      auto[mapManualKey(c)]   = (cap as any)?.[mapAutoKey(c)]   ?? null;
    }
    return NextResponse.json({ mode, convertTod3ToTop3, manual, auto });
  } catch (e: any) {
    return new NextResponse(e?.message || 'Bad Request', { status: 400 });
  }
}

// PUT /api/cap
// body: { mode: 'MANUAL'|'AUTO', manual?: {...}, auto?: {...}, convertTod3ToTop3?: boolean }
export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const mode: CapMode | undefined =
      body?.mode === 'AUTO' ? CapMode.AUTO :
      body?.mode === 'MANUAL' ? CapMode.MANUAL : undefined;
    if (!mode) return new NextResponse('mode ต้องเป็น MANUAL หรือ AUTO', { status: 400 });

    const manualIn = (body?.manual ?? {}) as Record<string, any>;
    const autoIn   = (body?.auto ?? {})   as Record<string, any>;
    const convertTod3ToTop3: boolean | undefined =
      typeof body?.convertTod3ToTop3 === 'boolean' ? body.convertTod3ToTop3 : undefined;

    const updateData: any = { mode };
    if (typeof convertTod3ToTop3 === 'boolean') updateData.convertTod3ToTop3 = convertTod3ToTop3;

    for (const c of CAT_KEYS) {
      const key = mapManualKey(c);
      if (key in manualIn) updateData[key] = numOrNull(manualIn[key]);
    }
    for (const c of CAT_KEYS) {
      const key = mapManualKey(c);
      if (key in autoIn) updateData[mapAutoKey(c)] = numOrNull(autoIn[key]);
    }

    const current = await prisma.capRule.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    if (!current) {
      const created = await prisma.capRule.create({ data: updateData, select: { id: true } });
      return NextResponse.json({ ok: true, id: created.id });
    }
    const updated = await prisma.capRule.update({
      where: { id: current.id },
      data: updateData,
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (e: any) {
    console.error('PUT /api/cap error', e);
    return new NextResponse(e?.message || 'Internal Error', { status: 500 });
  }
}
