import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma, Category } from '@prisma/client';

function perms3(s:string){ if(s.length!==3) return [s]; const [a,b,c]=s.split(''); return Array.from(new Set([a+b+c,a+c+b,b+a+c,b+c+a,c+a+b,c+b+a])); }
const catTH:Record<Category,string>={
  TOP3:'3 ตัวบน', TOD3:'3 โต๊ด', TOP2:'2 ตัวบน', BOTTOM2:'2 ตัวล่าง', RUN_TOP:'วิ่งบน', RUN_BOTTOM:'วิ่งล่าง'
};

// format helper
function parseISO(s?:string|null){ return s? new Date(s): undefined; }

export async function GET(req:Request){
  const { searchParams } = new URL(req.url);
  let from = parseISO(searchParams.get('from'));
  let to   = parseISO(searchParams.get('to'));
  let timeWindowId = searchParams.get('timeWindowId') ? Number(searchParams.get('timeWindowId')) : undefined;

  // default: งวดล่าสุด
  if (!from || !to || !timeWindowId){
    const tw = await prisma.timeWindow.findFirst({ orderBy:{id:'desc'} });
    if (tw){ from ??= tw.startAt; to ??= tw.endAt; timeWindowId ??= tw.id; }
  }
  if (!from || !to) return NextResponse.json({ error:'from/to required' }, {status:400});

  // inflow by category,number
  const inflowRows = await prisma.$queryRaw<{category:Category, number:string, inflow:number}[]>(Prisma.sql`
    SELECT p."category"::text as category, p."number" as number,
           COALESCE(SUM(oi."sumAmount"),0)::float AS inflow
    FROM "OrderItem" oi
    JOIN "Order" o ON oi."orderId"=o."id"
    JOIN "Product" p ON oi."productId"=p."id"
    WHERE o."createdAt" >= ${from} AND o."createdAt" < ${to}
    GROUP BY p."category", p."number"
  `);

  // excess (ส่งเจ้ามือ) by category,number  (หลังแปลง TOD3->TOP3 แล้ว)
  const exRows = await prisma.$queryRaw<{category:Category, number:string, ex:number}[]>(Prisma.sql`
    SELECT p."category"::text as category, p."number" as number,
           COALESCE(SUM(e."amount"),0)::float AS ex
    FROM "ExcessBuy" e
    JOIN "Product" p ON e."productId"=p."id"
    WHERE e."createdAt" >= ${from} AND e."createdAt" < ${to}
    GROUP BY p."category", p."number"
  `);

  // ทำ mapเพื่อคำนวณ per-number
  const inflowMap = new Map<string, number>(); // key: cat|num
  inflowRows.forEach(r=> inflowMap.set(`${r.category}|${r.number}`, Number(r.inflow||0)));
  const exMap = new Map<string, number>();
  exRows.forEach(r=> exMap.set(`${r.category}|${r.number}`, Number(r.ex||0)));

  // เตรียมข้อมูลรางวัลของงวด
  const prize = await prisma.prizeSetting.findFirst({ where:{ timeWindowId } });
  const winTop3 = prize?.top3 ?? '';
  const winTop2 = winTop3.slice(1);
  const winBottom2 = prize?.bottom2 ?? '';
  const payout = {
    TOP3: prize?.payoutTop3 ?? 600,
    TOD3: prize?.payoutTod3 ?? 100,
    TOP2: prize?.payoutTop2 ?? 70,
    BOTTOM2: prize?.payoutBottom2 ?? 70,
    RUN_TOP: prize?.payoutRunTop ?? 3,
    RUN_BOTTOM: prize?.payoutRunBottom ?? 4,
  };

  const cats:Category[] = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'];
  const rows = cats.map(cat=>{
    // รวมรายเลข
    let inflow = 0, send=0, keep=0;
    let prizeSelf = 0, prizeDealer = 0;

    for (const [k, val] of inflowMap){
      const [c, num] = k.split('|') as [Category,string];
      if (c !== cat) continue;
      const ex = exMap.get(k) ?? 0;
      const selfAmt = Math.max(val - ex, 0);

      inflow += val;
      send   += ex;
      keep   += selfAmt;

      // ตัวคูณรางวัล (สำหรับวิ่ง)
      let multSelf = 0, multDealer = 0;
      if (cat==='TOP3'){
        multSelf   = (num===winTop3)?1:0;
        multDealer = (num===winTop3)?1:0;
      }else if (cat==='TOD3'){
        const ok = perms3(num).includes(winTop3);
        multSelf   = ok?1:0;
        multDealer = ok?1:0; // เผื่อโหมดไม่ convert
      }else if (cat==='TOP2'){
        multSelf   = (num===winTop2)?1:0;
        multDealer = (num===winTop2)?1:0;
      }else if (cat==='BOTTOM2'){
        multSelf   = (num===winBottom2)?1:0;
        multDealer = (num===winBottom2)?1:0;
      }else if (cat==='RUN_TOP'){
        const d = num.trim(); // หนึ่งหลัก
        const cnt = winTop3.split('').filter(x=>x===d).length;
        multSelf = cnt; multDealer = cnt;
      }else if (cat==='RUN_BOTTOM'){
        const d = num.trim();
        const cnt = winBottom2.split('').filter(x=>x===d).length;
        multSelf = cnt; multDealer = cnt;
      }

      prizeSelf   += selfAmt * (payout[cat] ?? 0) * multSelf;
      prizeDealer += ex      * (payout[cat] ?? 0) * multDealer;
    }

    return {
      category: catTH[cat],
      inflow,
      keep,
      prizeSelf,
      send,
      prizeDealer,
    };
  });

  // สรุปรวมท้ายตาราง
  const total = rows.reduce((a,r)=>({
    category:'รวม',
    inflow:a.inflow+r.inflow,
    keep: a.keep+r.keep,
    prizeSelf: a.prizeSelf+r.prizeSelf,
    send: a.send+r.send,
    prizeDealer: a.prizeDealer+r.prizeDealer
  }), {category:'รวม', inflow:0, keep:0, prizeSelf:0, send:0, prizeDealer:0});

  return NextResponse.json({
    timeWindowId,
    from, to,
    prize: prize ? { top3:prize.top3, bottom2:prize.bottom2, payout } : null,
    rows,
    total
  });
}
