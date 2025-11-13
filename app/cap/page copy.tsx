'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

type TW = { id:number; startAt:string; endAt:string; note?:string|null };

type Cat = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';
const CATS: Cat[] = ['TOP3','TOD3','TOP2','BOTTOM2','RUN_TOP','RUN_BOTTOM'];
const CAT_TH: Record<Cat,string> = {
  TOP3:'3 ตัวบน',
  TOD3:'3 โต๊ด',
  TOP2:'2 ตัวบน',
  BOTTOM2:'2 ตัวล่าง',
  RUN_TOP:'วิ่งบน',
  RUN_BOTTOM:'วิ่งล่าง',
};

type PreviewRow = { number:string; total:number };
type PreviewResp = {
  mode: 'MANUAL'|'AUTO';
  convertTod3ToTop3: boolean;
  from: string;
  to: string;
  thresholds: Partial<Record<Cat, number>>;
  topRanks: Partial<Record<Cat, PreviewRow[]>>;
  // เพิ่มมาเพื่อคอลัมน์ “จำนวนเลขทั้งหมด”
  countNumbers?: Partial<Record<Cat, number>>;
};

const TH = 'th-TH';
const TZ = 'Asia/Bangkok';
const TH_OFFSET_MIN = 7 * 60;

function fmtThai(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(TH, { hour12: false, timeZone: TZ });
}
function utcToThaiLocalInput(iso: string): string {
  const d = new Date(iso);
  const msThai = d.getTime() + TH_OFFSET_MIN * 60000;
  const t = new Date(msThai);
  const Y = t.getUTCFullYear();
  const M = String(t.getUTCMonth()+1).padStart(2,'0');
  const D = String(t.getUTCDate()).padStart(2,'0');
  const h = String(t.getUTCHours()).padStart(2,'0');
  const m = String(t.getUTCMinutes()).padStart(2,'0');
  return `${Y}-${M}-${D}T${h}:${m}`;
}
function thaiLocalInputToUtcIso(v: string): string {
  const [date,time] = v.split('T');
  const [Y,M,D] = (date||'').split('-').map(Number);
  const [h,mi]  = (time||'').split(':').map(Number);
  const ms = Date.UTC(Y,(M||1)-1,D||1,(h||0)-7,mi||0,0,0);
  return new Date(ms).toISOString();
}

export default function CapPage(){
  // ===== meta TW =====
  const [windows, setWindows] = useState<TW[]>([]);
  const [latest, setLatest]   = useState<TW|null>(null);

  // ฟอร์มช่วงเวลา (ไทย) + window เลือก
  const [twId, setTwId] = useState<string>('');
  const [fromTH, setFromTH] = useState<string>('');
  const [toTH, setToTH]     = useState<string>('');

  // โหมด + ตัวเลือก
  const [mode, setMode] = useState<'MANUAL'|'AUTO'>('AUTO');
  const [convertTod3ToTop3, setConvert] = useState<boolean>(false);

  // AUTO: Top-N ต่อหมวด
  const [autoCount, setAutoCount] = useState<Partial<Record<Cat, number>>>({
    TOP3:30, TOD3:30, TOP2:30, BOTTOM2:30, RUN_TOP:30, RUN_BOTTOM:30
  });

  // MANUAL: threshold ต่อหมวด
  const [manualThreshold, setManualThreshold] = useState<Partial<Record<Cat, number>>>({});

  // ผล Preview
  const [preview, setPreview] = useState<PreviewResp|null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string>('');

  // state สำหรับ “ย่อ/ขยาย” ของแต่ละหมวด
  const [expanded, setExpanded] = useState<Record<Cat, boolean>>({
    TOP3:false, TOD3:false, TOP2:false, BOTTOM2:false, RUN_TOP:false, RUN_BOTTOM:false
  });
  const DEFAULT_SHOW = 10; // โชว์เริ่มต้น 10 ตัว

  // ใช้สำหรับ auto preview ครั้งแรก
  const [autoPreviewDone, setAutoPreviewDone] = useState(false);

  const saveBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(()=>{(async()=>{
    const latestRes = await fetch('/api/time-window/latest',{cache:'no-store'});
    const latestTW:TW|null = latestRes.ok? await latestRes.json():null;

    const listRes = await fetch('/api/time-window/list',{cache:'no-store'});
    const tws:TW[] = listRes.ok? await listRes.json():[];

    setWindows(tws || []);
    setLatest(latestTW || null);

    if (latestTW){
      setTwId(String(latestTW.id));
      setFromTH(utcToThaiLocalInput(latestTW.startAt));
      setToTH(utcToThaiLocalInput(latestTW.endAt));
      setBanner(`งวดล่าสุด: ${fmtThai(latestTW.startAt)} – ${fmtThai(latestTW.endAt)}`);
    }else if (tws.length){
      const w = tws[tws.length-1];
      setTwId(String(w.id));
      setFromTH(utcToThaiLocalInput(w.startAt));
      setToTH(utcToThaiLocalInput(w.endAt));
      setBanner(`ช่วงเวลา: ${fmtThai(w.startAt)} – ${fmtThai(w.endAt)}`);
    }
  })()},[]);

  useEffect(()=>{
    if (!twId || !windows.length) return;
    const w = windows.find(x => String(x.id) === String(twId));
    if (w){
      setFromTH(utcToThaiLocalInput(w.startAt));
      setToTH(utcToThaiLocalInput(w.endAt));
      setBanner(`ช่วงเวลา: ${fmtThai(w.startAt)} – ${fmtThai(w.endAt)}`);
    }
  }, [twId, windows]);

  const fromUTC = useMemo(()=>fromTH? thaiLocalInputToUtcIso(fromTH):'', [fromTH]);
  const toUTC   = useMemo(()=>toTH? thaiLocalInputToUtcIso(toTH):'',   [toTH]);

  // auto preview ครั้งแรกหลังจากได้ fromUTC/toUTC แล้ว
  useEffect(() => {
    if (autoPreviewDone) return;
    if (!fromUTC || !toUTC) return;
    (async () => {
      await onPreviewOnly();       // ใช้ฟังก์ชันเดิม ไม่แตะ logic ภายใน
      setAutoPreviewDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUTC, toUTC, autoPreviewDone]);

  async function callCapApi(action:'preview'|'preview_and_save'){
    const res = await fetch('/api/cap', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({
        action,
        mode,
        convertTod3ToTop3,
        from: fromUTC,
        to: toUTC,
        autoCount,
        manualThreshold
      })
    });
    const json:PreviewResp = await res.json();
    setPreview(json);
    setBanner(`${action==='preview_and_save'?'บันทึก & Preview สำเร็จ':'Preview สำเร็จ'} • ช่วงเวลา: ${fmtThai(json.from)} – ${fmtThai(json.to)} • โหมด: ${json.mode}${json.convertTod3ToTop3?' • แปลงโต๊ด→บน':''}`);
  }

  async function onPreviewOnly(){
    if (!fromUTC || !toUTC) return;
    setBusy(true);
    try { await callCapApi('preview'); }
    finally { setBusy(false); }
  }
  async function onPreviewAndSave(){
    if (!fromUTC || !toUTC) return;
    setBusy(true);
    try {
      await callCapApi('preview_and_save');
    } finally {
      setBusy(false);
      saveBtnRef.current?.focus();
    }
  }

  function numInput(
    v:number|undefined,
    onChange:(n:number|undefined)=>void,
    placeholder?:string
  ){
    return (
      <input
        type="number"
        className="w-24 border rounded px-2 py-1"
        value={typeof v==='number'? v: '' }
        onChange={e=>{
          const raw = e.target.value;
          if (raw==='') onChange(undefined);
          else{
            const n = Number(raw);
            onChange(Number.isFinite(n)? n: undefined);
          }
        }}
        placeholder={placeholder||''}
        min={0}
      />
    );
  }

  // ปุ่มย่อ/ขยายต่อหมวด
  function ToggleBtn({cat, total}:{cat:Cat; total:number}) {
    if (total <= DEFAULT_SHOW) return null;
    const isOpen = expanded[cat];
    return (
      <button
        className="ml-2 rounded border px-2 py-0.5 text-xs hover:bg-gray-50"
        onClick={()=>setExpanded(s=>({...s, [cat]: !s[cat]}))}
      >
        {isOpen ? 'ย่อ' : `ดูทั้งหมด (${total.toLocaleString()})`}
      </button>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-3 py-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/home" className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700">กลับหน้า Home</Link>
        <h1 className="text-xl font-semibold">กำหนด Cap (อั้น)</h1>
      </div>

      {/* งวด + ช่วงเวลา (ไทย) */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600">งวด:</label>
        <select value={twId} onChange={e=>setTwId(e.target.value)} className="border rounded px-2 py-1">
          {windows.map(w=>(
            <option key={w.id} value={w.id}>#{w.id} • {fmtThai(w.startAt)} – {fmtThai(w.endAt)}</option>
          ))}
        </select>

        <div className="ml-4 text-sm text-gray-600">ช่วงเวลา</div>
        <input type="datetime-local" className="border rounded px-2 py-1" value={fromTH} onChange={e=>setFromTH(e.target.value)} />
        <span>ถึง</span>
        <input type="datetime-local" className="border rounded px-2 py-1" value={toTH} onChange={e=>setToTH(e.target.value)} />

        {!!banner && (
          <div className="ml-auto px-3 py-2 rounded bg-emerald-100 text-emerald-800 text-sm">
            {banner}
          </div>
        )}
      </div>

      {/* โหมด + ตัวเลือกแปลงโต๊ด */}
      <div className="border rounded p-3 space-y-3">
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="mode" checked={mode==='AUTO'} onChange={()=>setMode('AUTO')} />
            <span>Auto</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="mode" checked={mode==='MANUAL'} onChange={()=>setMode('MANUAL')} />
            <span>Manual</span>
          </label>

          <label className="inline-flex items-center gap-2 ml-6">
            <input
              type="checkbox"
              checked={convertTod3ToTop3}
              onChange={e=>setConvert(e.target.checked)}
            />
            <span>แปลง 3 โต๊ด → 3 ตัวบน (ใช้กับ Auto)</span>
          </label>
        </div>

        {/* ฟอร์ม AUTO: กรอก Top-N */}
        {mode==='AUTO' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {CATS.map(c=>(
              <div key={c} className="flex items-center justify-between rounded border p-2">
                <div>{CAT_TH[c]}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Top-N</span>
                  {numInput(autoCount[c], n=>setAutoCount(s=>({...s,[c]: n})), 'เช่น 30')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ฟอร์ม Manual: กรอก threshold */}
        {mode==='MANUAL' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {CATS.map(c=>(
              <div key={c} className="flex items-center justify-between rounded border p-2">
                <div>{CAT_TH[c]}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Threshold</span>
                  {numInput(manualThreshold[c], n=>setManualThreshold(s=>({...s,[c]: n})), 'บาท')}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={onPreviewOnly}
            disabled={busy}
            className="rounded px-3 py-2 bg-gray-700 text-white disabled:opacity-60"
          >
            {busy? 'กำลังคำนวณ…' : 'Preview'}
          </button>
          <button
            ref={saveBtnRef}
            onClick={onPreviewAndSave}
            disabled={busy}
            className="rounded px-3 py-2 bg-emerald-600 text-white disabled:opacity-60"
          >
            {busy? 'กำลังบันทึก…' : 'บันทึก & Preview'}
          </button>
        </div>
      </div>

      {/* ตารางผลลัพธ์ Preview */}
      <div className="border rounded p-3">
        <div className="font-semibold mb-2">ผลลัพธ์ Preview</div>
        {!preview ? (
          <div className="text-gray-500">— ยังไม่มีผลลัพธ์ —</div>
        ) : (
          <>
            <div className="text-sm mb-2">
              โหมด: <b>{preview.mode}</b>
              {preview.convertTod3ToTop3 && (
                <span className="ml-2 rounded bg-amber-100 text-amber-800 px-2 py-0.5">
                  แปลง 3 โต๊ด → 3 ตัวบน
                </span>
              )}
              <span className="ml-3">ช่วง: {fmtThai(preview.from)} – {fmtThai(preview.to)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border px-2 py-1 text-left">หมวด</th>
                    <th className="border px-2 py-1 text-right">Threshold (บาท)</th>
                    <th className="border px-2 py-1 text-right">จำนวนเลขทั้งหมด</th>
                    <th className="border px-2 py-1 text-left">Top-N (จากมาก→น้อย)</th>
                  </tr>
                </thead>
                <tbody>
                  {CATS.map((c)=>{
                    const th = preview.thresholds?.[c] ?? 0;
                    const rows = preview.topRanks?.[c] || [];
                    const totalCount = preview.countNumbers?.[c] ?? rows.length;
                    const showAll = expanded[c];
                    const list = showAll ? rows : rows.slice(0, DEFAULT_SHOW);

                    return (
                      <tr key={c}>
                        <td className="border px-2 py-1">{CAT_TH[c]}</td>
                        <td className="border px-2 py-1 text-right">{(th||0).toLocaleString()}</td>
                        <td className="border px-2 py-1 text-right">{totalCount.toLocaleString()}</td>
                        <td className="border px-2 py-1">
                          {rows.length===0 ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-2 items-center">
                              {list.map((r,i)=>(
                                <span key={i} className="inline-block rounded border px-2 py-0.5">
                                  {r.number}: {r.total.toLocaleString()}
                                </span>
                              ))}
                              <ToggleBtn cat={c} total={rows.length}/>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
