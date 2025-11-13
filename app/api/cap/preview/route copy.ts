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

function* permute3(num: string) {
  if (num.length !== 3) return;
  const digits = num.split('');
  const perms = new Set<string>();
  const used = [false,false,false];
  const cur: string[] = [];
  function dfs() {
    if (cur.length === 3) { perms.add(cur.join('')); return; }
    for (let i=0;i<3;i++){
      if (used[i]) continue;
      used[i] = true;
      cur.push(digits[i]);
      dfs();
      cur.pop();
      used[i] = false;
    }
  }
  dfs();
  for (const p of perms) yield p;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = body.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const convert = !!body.convertTod3ToTop3;
    const from = parseISO(body.from);
    const to = parseISO(body.to);
    if (!from || !to) return NextResponse.json({ error: 'invalid date' }, { status: 400 });

    const autoCount = body.autoCount || {};
    const manualThreshold = body.manualThreshold || {};

    // โหลดยอดรวมจาก OrderItem
    const g = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: { createdAt: { gte: from, lt: to } },
      _sum: { sumAmount: true, price: true },
    });
    const ids = g.map(g=>g.productId).filter((x):x is number=>!!x);
    const products = ids.length ? await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id:true, category:true, number:true },
    }) : [];

    const totals: Record<Cat, Map<string, number>> = Object.fromEntries(CATS.map(c=>[c,new Map()])) as any;
    const prodInfo = new Map<number,{cat:Cat, number:string}>();
    products.forEach(p=>prodInfo.set(p.id,{cat:p.category as Cat,number:p.number}));

    for (const r of g){
      const meta = prodInfo.get(r.productId!);
      if (!meta) continue;
      const cat = meta.cat;
      const num = meta.number;
      const amt = Number(r._sum.sumAmount ?? r._sum.price ?? 0);
      if (!Number.isFinite(amt)||amt<=0) continue;
      totals[cat].set(num, (totals[cat].get(num)||0)+amt);
    }

    // ===== แปลง 3 โต๊ด → 3 ตัวบน (6 permutations) =====
    if (mode==='AUTO' && convert) {
      const tod = totals.TOD3;
      const top = totals.TOP3;
      tod.forEach((v,num)=>{
        if (num.length===3) {
          const perAmt = Math.round(v/6);
          for (const p of permute3(num)) {
            top.set(p, (top.get(p)||0)+perAmt);
          }
        }
      });
      totals.TOD3 = new Map(); // clear หมวดโต๊ด
    }

    const thresholds: Partial<Record<Cat, number>> = {};
    const topRanks: Partial<Record<Cat, { number: string; total: number }[]>> = {};
    const countNumbers: Partial<Record<Cat, number>> = {};

    for (const cat of CATS) {
      const arr = Array.from(totals[cat].entries()).map(([number,total])=>({number,total}));
      arr.sort((a,b)=>b.total-a.total);
      countNumbers[cat] = arr.length;
      if (mode==='AUTO') {
        const N = Number(autoCount[cat]||0);
        const topN = arr.slice(0,N);
        thresholds[cat] = topN.length? Math.min(...topN.map(x=>x.total)) : 0;
        topRanks[cat] = topN;
      } else {
        thresholds[cat] = Number(manualThreshold[cat]||0);
        topRanks[cat] = arr.slice(0,30);
      }
    }
    if (convert) thresholds.TOD3 = 0;

    return NextResponse.json({
      mode, convertTod3ToTop3: convert,
      from: from.toISOString(), to: to.toISOString(),
      thresholds, topRanks, countNumbers,
    });
  } catch (e:any) {
    console.error('CAP PREVIEW ERROR', e);
    return new NextResponse(e?.message||'Cap preview error',{status:500});
  }
}
