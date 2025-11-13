// app/api/cap/preview/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Cat = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';
const CATS: Cat[] = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'];

function parseISO(s?: string|null): Date|null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

type Body = {
  action: 'preview'|'preview_and_save';
  mode: 'MANUAL'|'AUTO';
  convertTod3ToTop3?: boolean;
  from: string;
  to: string;
  autoCount?: Partial<Record<Cat, number>>;
  manualThreshold?: Partial<Record<Cat, number>>;
};

// สร้าง permutations ของเลข 3 หลักแบบไม่ซ้ำ
function perms3(num: string): string[] {
  if (!num || num.length !== 3) return [num];
  const [a,b,c] = num.split('');
  return Array.from(new Set([
    `${a}${b}${c}`, `${a}${c}${b}`,
    `${b}${a}${c}`, `${b}${c}${a}`,
    `${c}${a}${b}`, `${c}${b}${a}`,
  ]));
}

export async function POST(req: Request) {
  try{
    const body = await req.json() as Body;
    const from = parseISO(body.from);
    const to   = parseISO(body.to);
    if (!from || !to) {
      return NextResponse.json({ error: 'invalid time range' }, { status: 400 });
    }

    const mode = body.mode==='MANUAL' ? 'MANUAL' : 'AUTO';
    const convert = !!body.convertTod3ToTop3;

    // --- เตรียมยอดรวมต่อเลขต่อหมวดจาก OrderItem ---
    const g = await prisma.orderItem.groupBy({
      by:['productId'],
      where:{ createdAt: { gte: from, lt: to } },
      _sum:{ sumAmount:true, price:true }
    });
    const ids = g.map(x=>x.productId).filter((x):x is number=>!!x);
    const prods = ids.length? await prisma.product.findMany({
      where:{ id:{ in: ids } },
      select:{ id:true, category:true, number:true }
    }) : [];

    // cat -> Map<numberString, total>
    const totals: Record<Cat, Map<string, number>> = {
      TOP3:new Map(), TOD3:new Map(), TOP2:new Map(),
      BOTTOM2:new Map(), RUN_TOP:new Map(), RUN_BOTTOM:new Map()
    };
    const prodMeta = new Map<number,{cat:Cat, number:string}>();
    prods.forEach(p=>prodMeta.set(p.id, {cat:p.category as Cat, number:p.number}));

    for (const row of g){
      const meta = row.productId ? prodMeta.get(row.productId) : undefined;
      if (!meta) continue;
      const cat = meta.cat;
      if (!CATS.includes(cat)) continue;
      const num = meta.number;
      const amt = Number(row._sum.sumAmount ?? row._sum.price ?? 0);
      if (!Number.isFinite(amt) || amt<=0) continue;
      totals[cat].set(num, (totals[cat].get(num)||0) + amt);
    }

    // --- แปลง 3 โต๊ด → 3 ตัวบน (ใช้ได้ทั้ง MANUAL และ AUTO เมื่อ convert=true) ---
    if (convert) {
      const tod = totals.TOD3;
      const top = totals.TOP3;

      tod.forEach((v, num) => {
        const list = perms3(num);
        const perEach = Math.round(v / list.length); // ปัดเศษแบบที่ตกลงกัน (เช่น 100/6 -> 17)
        for (const nn of list) {
          top.set(nn, (top.get(nn) || 0) + perEach);
        }
      });
      // เคลียร์ TOD3 ให้ threshold โหมด AUTO = 0 และใน MANUAL ก็ไม่ยุ่งกับ TOD3 ต่อ
      totals.TOD3 = new Map();
    }

    // --- หา threshold / topRanks ---
    let thresholds: Partial<Record<Cat, number>> = {};
    let topRanks: Partial<Record<Cat, Array<{number:string,total:number}>>> = {};

    if (mode==='AUTO'){
      const count = body.autoCount || {};
      for (const cat of CATS){
        const N = Number(count[cat] ?? 0);
        const arr = Array.from(totals[cat]).map(([number,total])=>({number,total}));
        arr.sort((a,b)=> b.total - a.total); // มาก→น้อย
        const topN = N>0 ? arr.slice(0, N) : [];
        topRanks[cat] = topN;
        thresholds[cat] = (topN.length>0)
          ? topN.reduce((min,x)=> Math.min(min, x.total), Infinity)
          : 0;

        if (!Number.isFinite(thresholds[cat]!)) thresholds[cat] = 0;
      }
      if (convert) thresholds.TOD3 = 0; // เน้นให้ชัด
    } else {
      const manual = body.manualThreshold || {};
      for (const cat of CATS){
        const v = Number(manual[cat] ?? 0);
        thresholds[cat] = Number.isFinite(v) && v>0 ? v : 0;

        // โชว์อันดับจริงประกอบการตัดสินใจ (ไม่กระทบ threshold manual)
        const arr = Array.from(totals[cat]).map(([number,total])=>({number,total}));
        arr.sort((a,b)=> b.total - a.total);
        topRanks[cat] = arr.slice(0, 30);
      }
      if (convert) {
        // แสดงให้ชัดว่า TOD3 ถูกแปลงทิ้งไปแล้ว
        thresholds.TOD3 = 0;
        topRanks.TOD3 = [];
      }
    }

    // --- บันทึกถ้าขอ preview_and_save ---
    if (body.action === 'preview_and_save'){
      await prisma.capRule.create({
        data:{
          mode: mode as any,
          convertTod3ToTop3: convert,

          autoTop3Count:      body.autoCount?.TOP3 ?? null,
          autoTod3Count:      body.autoCount?.TOD3 ?? null,
          autoTop2Count:      body.autoCount?.TOP2 ?? null,
          autoBottom2Count:   body.autoCount?.BOTTOM2 ?? null,
          autoRunTopCount:    body.autoCount?.RUN_TOP ?? null,
          autoRunBottomCount: body.autoCount?.RUN_BOTTOM ?? null,

          autoThresholdTop3:      thresholds.TOP3 ?? null,
          autoThresholdTod3:      thresholds.TOD3 ?? null,
          autoThresholdTop2:      thresholds.TOP2 ?? null,
          autoThresholdBottom2:   thresholds.BOTTOM2 ?? null,
          autoThresholdRunTop:    thresholds.RUN_TOP ?? null,
          autoThresholdRunBottom: thresholds.RUN_BOTTOM ?? null,

          top3:      mode==='MANUAL' ? (body.manualThreshold?.TOP3 ?? null) : null,
          tod3:      mode==='MANUAL' ? (body.manualThreshold?.TOD3 ?? null) : null,
          top2:      mode==='MANUAL' ? (body.manualThreshold?.TOP2 ?? null) : null,
          bottom2:   mode==='MANUAL' ? (body.manualThreshold?.BOTTOM2 ?? null) : null,
          runTop:    mode==='MANUAL' ? (body.manualThreshold?.RUN_TOP ?? null) : null,
          runBottom: mode==='MANUAL' ? (body.manualThreshold?.RUN_BOTTOM ?? null) : null,

          effectiveAtTop3:      from,
          effectiveAtTod3:      from,
          effectiveAtTop2:      from,
          effectiveAtBottom2:   from,
          effectiveAtRunTop:    from,
          effectiveAtRunBottom: from,
        }
      });
    }

    return NextResponse.json({
      mode,
      convertTod3ToTop3: convert,
      from: from.toISOString(),
      to: to.toISOString(),
      thresholds,
      topRanks
    });

  }catch(e:any){
    console.error('CAP ERROR:', e);
    return new NextResponse(typeof e?.message==='string'? e.message: 'Cap error', { status:500 });
  }
}
