// app/api/admin/export/route.ts
import JSZip from 'jszip';
import { createCanvas } from 'canvas';
import type { Category } from '@prisma/client';
import { prisma } from '@/lib/db';

// ... ฟังก์ชันช่วย chunk(), renderPagePNG() เหมือนเดิม ...
// === Helper: แบ่ง array เป็นกลุ่ม (ใช้ทำ pagination) ===
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}



function renderPagePNG(opts: {
  title: string;
  columns: { header: string; lines: string[] }[];
  pageSize?: { w: number; h: number };
  margin?: number;
  rowHeight?: number;
  headerHeight?: number;
  colGap?: number;
  fontFamily?: string;
}) {
  const {
    title,
    columns,
    pageSize = { w: 1600, h: 2000 },
    margin = 40,
    rowHeight = 44,
    headerHeight = 52,
    colGap = 20,
    fontFamily = "Arial",
  } = opts;

  const canvas = createCanvas(pageSize.w, pageSize.h);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, pageSize.w, pageSize.h);

  ctx.fillStyle = "#111827";
  ctx.font = `bold 28px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText(title, pageSize.w / 2, margin + 10);

  const cols = columns.length;
  const innerW = pageSize.w - margin * 2 - colGap * (cols - 1);
  const colW = Math.floor(innerW / cols);
  let y = margin + 50;

  ctx.font = `bold 20px ${fontFamily}`;
  ctx.textAlign = "left";
  for (let c = 0; c < cols; c++) {
    const x = margin + c * (colW + colGap);
    ctx.fillStyle = "#F3F4F6";
    ctx.fillRect(x, y, colW, headerHeight);
    ctx.fillStyle = "#111827";
    ctx.fillText(columns[c].header, x + 10, y + 30);
  }
  y += headerHeight;

  ctx.font = `18px ${fontFamily}`;
  const maxLines = Math.max(...columns.map((c) => c.lines.length));
  for (let r = 0; r < maxLines; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + c * (colW + colGap);
      const line = columns[c].lines[r] ?? "";
      ctx.fillStyle = r % 2 === 0 ? "#FFFFFF" : "#FAFAFA";
      ctx.fillRect(x, y + r * rowHeight, colW, rowHeight);
      ctx.fillStyle = "#111827";
      ctx.fillText(line, x + 10, y + r * rowHeight + 28);
    }
  }

  return canvas.toBuffer("image/png");
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const start = url.searchParams.get('start') ?? new Date(new Date().setHours(0,0,0,0)).toISOString();
  const end   = url.searchParams.get('end')   ?? new Date().toISOString();

  const pick = (k: string, d: number) => Number(url.searchParams.get(k) ?? d);
  const limTop3 = pick('topTop3', 30);
  const limTod3 = pick('topTod3', 20);
  const limTop2 = pick('topTop2', 30);
  const limBot2 = pick('topBottom2', 30);
  const limRunT = pick('topRunTop', 50);
  const limRunB = pick('topRunBottom', 50);

  const rows = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { createdAt: { gte: new Date(start), lte: new Date(end) } },
    _sum: { sumAmount: true },
  });

  const productIds = rows.map(r => r.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, category: true, number: true },
  });

  const pmap = new Map<number, {category: Category; number: string}>();
  products.forEach(p => pmap.set(p.id, {category: p.category, number: p.number}));

  type R = { number: string; total: number };
  const agg: Record<Category, R[]> = {
    TOP3: [], TOD3: [], TOP2: [], BOTTOM2: [], RUN_TOP: [], RUN_BOTTOM: [],
  };
  rows.forEach(r => {
    const info = pmap.get(r.productId);
    if (!info) return;
    agg[info.category].push({ number: info.number, total: Number(r._sum.sumAmount ?? 0) });
  });

  const topN = (a: R[], n: number) => a.sort((x,y)=>y.total-x.total).slice(0, Math.max(n,0)).map(x => `${x.number} = ${x.total}`);

  const colA = topN(agg.TOP3, limTop3);
  const colB = topN(agg.TOD3, limTod3);
  const colC = topN(agg.TOP2, limTop2);
  const colD = topN(agg.BOTTOM2, limBot2);
  const colE = topN(agg.RUN_TOP, limRunT);
  const colF = topN(agg.RUN_BOTTOM, limRunB);

  const linesPerCol = 35;
  const A = chunk(colA, linesPerCol);
  const B = chunk(colB, linesPerCol);
  const C = chunk(colC, linesPerCol);
  const D = chunk(colD, linesPerCol);
  const E = chunk(colE, linesPerCol);
  const F = chunk(colF, linesPerCol);

  const maxPages = Math.max(A.length, B.length, C.length, D.length, E.length, F.length);

  const zip = new JSZip();
  for (let page = 0; page < maxPages; page++) {
    const columns = [
      { header: '3 ตัวบน',   lines: A[page] ?? [] },
      { header: '3 โต๊ด',    lines: B[page] ?? [] },
      { header: '2 ตัวบน',   lines: C[page] ?? [] },
      { header: '2 ตัวล่าง', lines: D[page] ?? [] },
      { header: 'วิ่งบน',    lines: E[page] ?? [] },
      { header: 'วิ่งล่าง',  lines: F[page] ?? [] },
    ];
    if (!columns.some(c => c.lines.length)) continue;

    const pngBuf = renderPagePNG({
      title: `ช่วงเวลา: ${new Date(start).toLocaleString()} - ${new Date(end).toLocaleString()}`,
      columns,
    });
    const name = `report-${String(page+1).padStart(2,'0')}.png`;
    zip.file(name, pngBuf);
  }

  // ให้ JSZip สร้างเป็น nodebuffer แล้ว "บังคับ" เป็น Uint8Array 100% เพื่อให้ตรง BodyInit
  const zipBuf = (await zip.generateAsync({ type: "nodebuffer" })) as Buffer;
const u8 = new Uint8Array(zipBuf);
return new Response(u8, {
  headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="report_${new Date()
      .toISOString()
      .slice(0, 10)}.zip"`,
  },
});

}
