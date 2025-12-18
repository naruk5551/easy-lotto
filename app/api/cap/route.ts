// app/api/cap/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { POST as previewPOST, GET as previewGET } from './preview/route';

// ✅ ทำให้ /api/cap ใช้ logic เดียวกับ /api/cap/preview (กันสูตรไม่ตรงกัน)
// ✅ รองรับ client เก่าที่ส่ง autoCount มา: map -> autoDiscountPct

export async function GET(req: Request) {
  return previewGET();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // backward compatible: autoCount (เก่า) -> autoDiscountPct (ใหม่)
    if (body && body.autoDiscountPct == null && body.autoCount != null) {
      body.autoDiscountPct = body.autoCount;
    }

    // ส่งต่อให้ preview handler
    const nextReq = new Request(req.url.replace(/\/api\/cap$/, '/api/cap'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    return previewPOST(nextReq);
  } catch (e: any) {
    console.error('CAP ROUTE(PROXY) ERROR:', e);
    return new NextResponse(
      typeof e?.message === 'string' ? e.message : 'Cap error',
      { status: 500 },
    );
  }
}
