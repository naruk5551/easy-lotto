'use client';

import React, {useEffect, useMemo, useState} from 'react';
import Link from 'next/link';

type TW = { id:number; startAt:string; endAt:string; note?:string|null };

function thTime(s:string){
  const d = new Date(s);
  return new Intl.DateTimeFormat('th-TH',
    {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Bangkok'}).format(d);
}

export default function DataAdminPage(){
  const [windows, setWindows] = useState<TW[]>([]);
  const [selId, setSelId]     = useState<number|undefined>();
  const [from, setFrom]       = useState<string>('');
  const [to, setTo]           = useState<string>('');
  const [banner, setBanner]   = useState<string>('');

  useEffect(()=>{ (async ()=>{
    const r = await fetch('/api/time-window/list', {cache:'no-store'});
    const rows:TW[] = r.ok ? await r.json() : [];
    setWindows(rows);
    if (rows.length){
      setSelId(rows[0].id);
      setFrom(rows[0].startAt);
      setTo(rows[0].endAt);
      setBanner(`ช่วงเวลา: ${thTime(rows[0].startAt)} – ${thTime(rows[0].endAt)}`);
    }
  })(); },[]);

  const selected = useMemo(()=>windows.find(w=>w.id===selId),[windows,selId]);

  return (
    <div className="mx-auto max-w-5xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/home" className="rounded bg-blue-600 px-3 py-2 text-white">กลับหน้า Home</Link>
        <h2 className="text-xl font-semibold">จัดการข้อมูล (ลบตามงวด)</h2>
      </div>

      {/* แถบกรอง 1 บรรทัด */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm">งวด:</label>
        <select
          value={selId ?? ''}
          onChange={e=>{
            const id = Number(e.target.value||0);
            setSelId(id||undefined);
            const tw = windows.find(x=>x.id===id);
            if (tw){
              setFrom(tw.startAt); setTo(tw.endAt);
              setBanner(`ช่วงเวลา: ${thTime(tw.startAt)} – ${thTime(tw.endAt)}`);
            }
          }}
          className="rounded border px-2 py-1"
        >
          {windows.map(w=>(
            <option key={w.id} value={w.id}>
              #{w.id} • {thTime(w.startAt)} – {thTime(w.endAt)} {w.note?`• ${w.note}`:''}
            </option>
          ))}
        </select>

        <button
          onClick={async ()=>{
            if (!selected) return;
            if (!confirm(`ยืนยันลบข้อมูลทั้งหมดของงวด #${selected.id}?`)) return;
            const r = await fetch('/api/data/delete', {
              method:'POST',
              headers:{'content-type':'application/json'},
              body: JSON.stringify({ timeWindowId: selected.id })
            });
            if (r.ok){
              setBanner(`✅ ลบข้อมูลงวด #${selected.id} สำเร็จ`);
            }else{
              setBanner(`❌ ลบข้อมูลไม่สำเร็จ`);
            }
          }}
          className="rounded bg-red-600 px-3 py-1.5 text-white"
        >ลบข้อมูลงวดนี้</button>

        {/* Banner สีเขียว */}
        {!!banner && (
          <span className="ml-3 rounded bg-emerald-100 px-3 py-1 text-emerald-700 text-sm">{banner}</span>
        )}
      </div>

      <p className="text-sm text-gray-500">
        * การลบจะเก็บเฉพาะโครงสร้างงวดไว้ (TimeWindow) แต่ลบ Order/OrderItem/ExcessBuy/SettleBatch/AcceptSelf/PrizeSetting ของงวดนั้น
      </p>
    </div>
  );
}
