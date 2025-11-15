'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';

type TW = { id:number; startAt:string; endAt:string; note?:string|null };
type Row = {
  category:string;
  inflow:number;
  acceptSelf:number;
  prizeSelf:number;
  shouldSend:number;
  prizeDealer:number;
};
type Resp = {
  from:string|null; to:string|null;
  prize:number; prizeDealer:number; prizeSelf:number;
  rows:Row[];
};

const CAT_ORDER = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'] as const;

// === helper ===
const thTime = (iso:string)=>new Intl.DateTimeFormat('th-TH',{
  dateStyle:'medium',
  timeStyle:'short',
  hour12:false,
  timeZone:'Asia/Bangkok'
}).format(new Date(iso));

const thCat = (c:string)=>({
  TOP3:'3 ตัวบน',
  TOD3:'3 โต๊ด',
  TOP2:'2 ตัวบน',
  BOTTOM2:'2 ตัวล่าง',
  RUN_TOP:'วิ่งบน',
  RUN_BOTTOM:'วิ่งล่าง'
} as Record<string,string>)[c] ?? c;

// ===================================================================
//                OPTIMIZED COMPONENT (SAFE) 
// ===================================================================

export default function SummaryPage(){

  const [windows,setWindows]=useState<TW[]>([]);
  const [selId,setSelId]=useState<number>();
  const [from,setFrom]=useState<string>('');
  const [to,setTo]=useState<string>('');
  const [banner,setBanner]=useState<string>('');
  const [data,setData]=useState<Resp|null>(null);
  const [busy, setBusy] = useState(false);

  // -------------------------------------------------------
  // โหลดรายการงวด (เร็วขึ้น + กัน fetch ซ้ำ)
  // -------------------------------------------------------
  useEffect(()=>{
    let canceled = false;

    (async()=>{
      const r = await fetch('/api/time-window/list',{cache:'no-store'});
      let arr:TW[] = r.ok? await r.json():[];

      // sort ก่อนเสมอ (รวดเร็วกว่าเดิมเพราะ sort ผ่าน array copy)
      arr = arr.slice().sort((a,b)=>a.id - b.id);

      if (canceled) return;
      setWindows(arr);

      let startISO = '', endISO = '';

      if(arr.length>0){
        const last=arr[arr.length-1];
        setSelId(last.id);
        startISO = last.startAt; 
        endISO = last.endAt;
      }else{
        const r2 = await fetch('/api/time-window/latest',{cache:'no-store'});
        if(r2.ok){
          const latest = await r2.json() as TW|null;
          if(latest){ startISO = latest.startAt; endISO = latest.endAt; }
        }
      }

      if(startISO && endISO){
        setFrom(startISO); 
        setTo(endISO);
        setBanner(`ช่วงเวลา: ${thTime(startISO)} – ${thTime(endISO)}`);
      }
    })();

    return ()=>{ canceled = true };
  },[]);

  // -------------------------------------------------------
  // applyFilter (ทำงานเร็วขึ้น)
  // -------------------------------------------------------
  const applyFilter = useCallback(async (fromISO=from, toISO=to)=>{
    if(!fromISO || !toISO) return;

    try{
      setBusy(true);

      const u = new URL('/api/summary', location.origin);
      u.searchParams.set('from', fromISO);
      u.searchParams.set('to', toISO);

      const r = await fetch(u,{cache:'no-store'});
      const json:Resp = await r.json();

      // sort เร็วขึ้น (index จากตาราง CAT_ORDER)
      const rowsSorted = json.rows
        ? json.rows.slice().sort(
            (a,b)=> CAT_ORDER.indexOf(a.category as any) - CAT_ORDER.indexOf(b.category as any)
          )
        : [];

      setData({...json, rows: rowsSorted});
    } 
    finally {
      setBusy(false);
    }
  },[from,to]);

  // -------------------------------------------------------
  // เปลี่ยนงวด: แค่เปลี่ยนช่วงเวลา ไม่ยิง API (เร็วขึ้น)
  // -------------------------------------------------------
  const onChangeWindow = useCallback((id:number)=>{
    setSelId(id);
    const w = windows.find(x=>x.id===id);
    if(!w) return;

    setFrom(w.startAt);
    setTo(w.endAt);
    setBanner(`ช่วงเวลา: ${thTime(w.startAt)} – ${thTime(w.endAt)}`);

    // ❗ ไม่เรียก applyFilter ที่นี่ (เพื่อลดงาน)  
  },[windows]);

  // -------------------------------------------------------
  // total fields (memoized)
  // -------------------------------------------------------
  const totals = useMemo(()=>{
    if(!data?.rows) return {
      inflow:0, acceptSelf:0, prizeSelf:0, shouldSend:0, prizeDealer:0
    };
    let t = {inflow:0,acceptSelf:0,prizeSelf:0,shouldSend:0,prizeDealer:0};
    for(const r of data.rows){
      t.inflow += r.inflow||0;
      t.acceptSelf += r.acceptSelf||0;
      t.prizeSelf += r.prizeSelf||0;
      t.shouldSend += r.shouldSend||0;
      t.prizeDealer += r.prizeDealer||0;
    }
    return t;
  },[data]);

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------
  return (
    <div className="p-4">
      <Link href="/home" className="inline-block rounded bg-blue-600 text-white px-3 py-2">
        กลับหน้า Home
      </Link>
      <h2 className="inline-block ml-4 text-xl font-semibold">สรุปยอด</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">

        {windows.length>0 && (
          <div className="flex items-center gap-2">
            <span>งวด:</span>
            <select
              className="rounded border px-2 py-1"
              value={selId ?? ''}
              onChange={e=>onChangeWindow(Number(e.target.value))}
            >
              {windows.map(w=>(
                <option key={w.id} value={w.id}>
                  #{w.id} • {thTime(w.startAt)} • {w.note||''}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={()=>applyFilter()}
          disabled={busy}
          className={`rounded px-3 py-2 text-white ${
            busy ? 'bg-emerald-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {busy ? 'กำลังกรอง…' : 'กรองช่วงเวลา'}
        </button>

        {!!banner && (
          <span className="rounded bg-emerald-100 text-emerald-700 px-3 py-2">
            {banner}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded border p-4">
          <div className="text-gray-500">ยอดสั่งซื้อ</div>
          <div className="text-2xl font-semibold">{totals.inflow.toLocaleString()}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-gray-500">ยอดส่งเจ้ามือ</div>
          <div className="text-2xl font-semibold">{totals.shouldSend.toLocaleString()}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-gray-500">ยอดรับเอง</div>
          <div className="text-2xl font-semibold">{totals.acceptSelf.toLocaleString()}</div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-50">
              {['หมวดหมู่','ยอดสั่งซื้อ (บาท)','ยอดรับเอง (บาท)','ยอดถูกรางวัลรับเอง','ยอดส่งเจ้ามือ (บาท)','ยอดถูกรางวัล เจ้ามือ']
                .map(h=>(
                  <th key={h} className="border-b border-r border-gray-300 px-3 py-2 text-left">
                    {h}
                  </th>
                ))}
            </tr>
          </thead>

          <tbody>
            {data?.rows?.map((r,i)=>(
              <tr key={`${i}-${r.category}`}>
                <td className="border-t border-r px-3 py-2">{thCat(r.category)}</td>
                <td className="border-t border-r px-3 py-2">{r.inflow.toLocaleString()}</td>
                <td className="border-t border-r px-3 py-2">{r.acceptSelf.toLocaleString()}</td>
                <td className="border-t border-r px-3 py-2">{r.prizeSelf.toLocaleString()}</td>
                <td className="border-t border-r px-3 py-2">{r.shouldSend.toLocaleString()}</td>
                <td className="border-t px-3 py-2">{r.prizeDealer.toLocaleString()}</td>
              </tr>
            ))}

            <tr className="bg-gray-50 font-semibold">
              <td className="border-t border-r px-3 py-2">รวม</td>
              <td className="border-t border-r px-3 py-2">{totals.inflow.toLocaleString()}</td>
              <td className="border-t border-r px-3 py-2">{totals.acceptSelf.toLocaleString()}</td>
              <td className="border-t border-r px-3 py-2">{totals.prizeSelf.toLocaleString()}</td>
              <td className="border-t border-r px-3 py-2">{totals.shouldSend.toLocaleString()}</td>
              <td className="border-t px-3 py-2">{totals.prizeDealer.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
