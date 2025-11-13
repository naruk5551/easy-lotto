// app/components/TimeWindowFilter.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';

type TW = { id:number; startAt:string; endAt:string; note?:string|null };

const BKK_OFFSET_H = 7;

function toInputLocal(dtIso: string) {
  const d = new Date(dtIso);
  // ปรับเป็นเวลาไทยแล้ว format เป็น input[type=datetime-local]
  const t = d.getTime() + d.getTimezoneOffset()*60000 + BKK_OFFSET_H*3600000;
  const z = new Date(t);
  const pad = (n:number)=>String(n).padStart(2,'0');
  const y = z.getFullYear();
  const m = pad(z.getMonth()+1);
  const d2= pad(z.getDate());
  const hh= pad(z.getHours());
  const mm= pad(z.getMinutes());
  return `${y}-${m}-${d2}T${hh}:${mm}`;
}

function localInputToUtcIso(v: string) {
  // v เป็นเวลา local ไทย -> แปลงกลับเป็น UTC ISO
  if (!v) return '';
  const [date, time] = v.split('T');
  const [yy,mm,dd] = date.split('-').map(Number);
  const [hh,mi] = time.split(':').map(Number);
  // local ไทย -7h = UTC
  const utc = new Date(Date.UTC(yy, (mm-1), dd, hh - BKK_OFFSET_H, mi, 0));
  return utc.toISOString();
}

function fmtTH(dtIso: string) {
  const d = new Date(dtIso);
  return new Intl.DateTimeFormat('th-TH',{
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false,
    timeZone:'Asia/Bangkok'
  }).format(d);
}

export default function TimeWindowFilter(props:{
  onApply:(p:{timeWindowId:number; from:string; to:string; banner:string})=>void;
  autoLoadLatest?: boolean;     // โหลดงวดล่าสุดแล้วใส่ค่าให้ช่อง start/end
  defaultApplyOnLoad?: boolean; // โหลดแล้วกด apply ให้อัตโนมัติ
}) {
  const [list,setList] = useState<TW[]>([]);
  const [sel,setSel]   = useState<number>(0);
  const [tw,setTw]     = useState<TW|null>(null);

  // ช่องกรองช่วงย่อยในงวด (แสดงเป็นไทย)
  const [startLocal,setStartLocal] = useState('');
  const [endLocal,setEndLocal]     = useState('');
  const [banner,setBanner]         = useState('');

  useEffect(()=>{ (async()=>{
    const r = await fetch('/api/time-window?page=1&pageSize=200',{cache:'no-store'});
    const js = await r.json();
    const items:TW[] = js.items ?? [];
    setList(items);
    if (items.length>0 && props.autoLoadLatest!==false) {
      const latest = items[0];       // id desc
      setSel(latest.id);
      setTw(latest);
      setStartLocal(toInputLocal(latest.startAt));
      setEndLocal(toInputLocal(latest.endAt));
      setBanner(`${fmtTH(latest.startAt)} – ${fmtTH(latest.endAt)}${latest.note?` • ${latest.note}`:''}`);
      if (props.defaultApplyOnLoad) {
        props.onApply({
          timeWindowId: latest.id,
          from: latest.startAt,
          to: latest.endAt,
          banner: `${fmtTH(latest.startAt)} – ${fmtTH(latest.endAt)}${latest.note?` • ${latest.note}`:''}`
        });
      }
    }
  })(); },[]);

  function onChangeWindow(id:number) {
    setSel(id);
    const t = list.find(x=>x.id===id) || null;
    setTw(t);
    if (t) {
      setStartLocal(toInputLocal(t.startAt));
      setEndLocal(toInputLocal(t.endAt));
      setBanner(`${fmtTH(t.startAt)} – ${fmtTH(t.endAt)}${t.note?` • ${t.note}`:''}`);
    }
  }

  function apply() {
    if (!tw) return;
    // clamp: ถ้าผู้ใช้กรอกเกินกรอบงวด ให้บีบเข้ามาและเตือน
    const minLocal = toInputLocal(tw.startAt);
    const maxLocal = toInputLocal(tw.endAt);

    let s = startLocal || minLocal;
    let e = endLocal   || maxLocal;

    let clamped = false;
    if (s < minLocal) { s = minLocal; clamped = true; }
    if (e > maxLocal) { e = maxLocal; clamped = true; }
    if (e <= s) { e = maxLocal; clamped = true; }

    const fromIso = localInputToUtcIso(s);
    const toIso   = localInputToUtcIso(e);

    const b = `${fmtTH(fromIso)} – ${fmtTH(toIso)}${clamped?'  (ถูกปรับให้อยู่ในกรอบงวด)':''}`;
    setBanner(b);
    props.onApply({ timeWindowId: tw.id, from: fromIso, to: toIso, banner: b });
  }

  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:12}}>
      <div style={{display:'flex', gap:12, alignItems:'center', flexWrap:'wrap'}}>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <span style={{opacity:.7}}>งวด:</span>
          <select value={sel} onChange={e=>onChangeWindow(Number(e.target.value))}
                  style={{padding:'8px 10px', borderRadius:8, border:'1px solid #e5e7eb'}}>
            {list.map(w=>(
              <option key={w.id} value={w.id}>
                #{w.id} • {fmtTH(w.startAt)} – {fmtTH(w.endAt)} {w.note?`• ${w.note}`:''}
              </option>
            ))}
          </select>
        </div>

        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <span style={{opacity:.7}}>ช่วงย่อย:</span>
          <input type="datetime-local"
                 value={startLocal}
                 onChange={e=>setStartLocal(e.target.value)}
                 style={{padding:'8px', border:'1px solid #e5e7eb', borderRadius:8}}/>
          <span>–</span>
          <input type="datetime-local"
                 value={endLocal}
                 onChange={e=>setEndLocal(e.target.value)}
                 style={{padding:'8px', border:'1px solid #e5e7eb', borderRadius:8}}/>
        </div>

        <div style={{color:'#2563eb'}}>ช่วงเวลา: {banner || '—'}</div>
      </div>

      <div style={{display:'flex', justifyContent:'end'}}>
        <button onClick={apply}
                style={{padding:'10px 16px', borderRadius:10, background:'#2563eb', color:'#fff', fontWeight:600}}>
          กรองช่วงเวลา
        </button>
      </div>
    </div>
  );
}
