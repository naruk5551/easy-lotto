'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

type PrizeDTO = {
  id?: number;
  timeWindowId: number;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  top3: string; bottom2: string;
  payoutTop3: number; payoutTod3: number; payoutTop2: number; payoutBottom2: number; payoutRunTop: number; payoutRunBottom: number;
};

type PrizeRow = {
  id: number;
  timeWindowId: number;
  windowStartTH: string;
  windowEndTH: string;
  top3: string; bottom2: string;
  payoutTop3: number; payoutTod3: number; payoutTop2: number; payoutBottom2: number; payoutRunTop: number; payoutRunBottom: number;
  createdAtTH: string;
};

export default function AdminPrizes() {
  const [p, setP] = useState<PrizeDTO | null>(null);
  const [list, setList] = useState<PrizeRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  async function loadLatest() {
    setErr(null);
    const r = await fetch('/api/prizes', { cache: 'no-store' });
    if (!r.ok) { setErr(await r.text()); return; }
    const j = await r.json();
    setP(j);
    setBanner(`งวดล่าสุด: ${new Date(j.timeWindowStart).toLocaleString('th-TH', { hour12: false })} – ${new Date(j.timeWindowEnd).toLocaleString('th-TH', { hour12: false })}`);
  }
  async function loadList() {
    const r = await fetch('/api/prizes?list=1', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      setList(j.items ?? []);
    }
  }

  useEffect(() => { loadLatest(); loadList(); }, []);

  const setField = (k: keyof PrizeDTO) => (v: any) => p && setP({ ...p, [k]: v });

  async function save() {
    if (!p) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch('/api/prizes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
      if (!r.ok) throw new Error(await r.text());
      await loadLatest();
      await loadList();
      alert('บันทึกสำเร็จ');
    } catch (e: any) { setErr(e?.message || 'บันทึกไม่สำเร็จ'); }
    finally { setSaving(false); }
  }

  async function remove(id: number) {
    if (!confirm('ลบรายการนี้?')) return;
    const r = await fetch(`/api/prizes?id=${id}`, { method: 'DELETE' });
    if (r.ok) {
      await loadLatest();
      await loadList();
    } else {
      alert(await r.text());
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 16 }}>
      {/* แถบบน */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
        <Link href="/home" className="rounded bg-gray-700 px-3 py-2 text-white">กลับหน้า Home</Link>
        <div style={{ flex:1 }} />
        {banner && <div style={{ padding:'6px 10px', border:'1px solid #09f', background:'#eef7ff' }}>{banner}</div>}
      </div>

      <h2 className="text-xl font-bold mb-3">ตั้งค่ารางวัล & อัตราจ่าย (ตามงวด)</h2>
      {err && <div style={{ border:'1px solid #f99', background:'#fee', padding:8, marginBottom:12 }}>{err}</div>}

      {!p ? <div>กำลังโหลด...</div> : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div className="border rounded p-3">
            <h3 className="font-semibold mb-2">เลขรางวัล</h3>
            <label className="block mb-2">3 ตัวบน
              <input className="border p-2 w-full" value={p.top3} onChange={e => setField('top3')(e.target.value.replace(/\D/g,'').slice(0,3))} />
            </label>
            <label className="block mb-2">2 ตัวล่าง
              <input className="border p-2 w-full" value={p.bottom2} onChange={e => setField('bottom2')(e.target.value.replace(/\D/g,'').slice(0,2))} />
            </label>
          </div>
          <div className="border rounded p-3">
            <h3 className="font-semibold mb-2">อัตราจ่าย (บาท/หน่วย)</h3>
            <div className="grid grid-cols-2 gap-3">
              <label>3 ตัวบน <input className="border p-2 w-full" type="number" value={p.payoutTop3} onChange={e=>setField('payoutTop3')(Number(e.target.value))} /></label>
              <label>3 โต๊ด <input className="border p-2 w-full" type="number" value={p.payoutTod3} onChange={e=>setField('payoutTod3')(Number(e.target.value))} /></label>
              <label>2 ตัวบน <input className="border p-2 w-full" type="number" value={p.payoutTop2} onChange={e=>setField('payoutTop2')(Number(e.target.value))} /></label>
              <label>2 ตัวล่าง <input className="border p-2 w-full" type="number" value={p.payoutBottom2} onChange={e=>setField('payoutBottom2')(Number(e.target.value))} /></label>
              <label>วิ่งบน <input className="border p-2 w-full" type="number" value={p.payoutRunTop} onChange={e=>setField('payoutRunTop')(Number(e.target.value))} /></label>
              <label>วิ่งล่าง <input className="border p-2 w-full" type="number" value={p.payoutRunBottom} onChange={e=>setField('payoutRunBottom')(Number(e.target.value))} /></label>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button disabled={!p || saving} onClick={save} className="rounded bg-blue-600 text-white px-4 py-2">{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
      </div>

      {/* ตารางรายการทั้งหมด */}
      <h3 className="text-lg font-semibold mt-8 mb-2">รายการ Prize Settings ทั้งหมด</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full border">
          <thead>
            <tr className="bg-gray-100">
              <th className="border px-2 py-1">#</th>
              <th className="border px-2 py-1">งวด (เวลาไทย)</th>
              <th className="border px-2 py-1">3 ตัวบน</th>
              <th className="border px-2 py-1">2 ตัวล่าง</th>
              <th className="border px-2 py-1">อัตราจ่าย</th>
              <th className="border px-2 py-1">สร้างเมื่อ</th>
              <th className="border px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, idx) => (
              <tr key={r.id}>
                <td className="border px-2 py-1">{idx+1}</td>
                <td className="border px-2 py-1">{r.windowStartTH} – {r.windowEndTH}</td>
                <td className="border px-2 py-1">{r.top3}</td>
                <td className="border px-2 py-1">{r.bottom2}</td>
                <td className="border px-2 py-1">
                  <div>บน: {r.payoutTop3} / โต๊ด: {r.payoutTod3}</div>
                  <div>2 บน: {r.payoutTop2} / 2 ล่าง: {r.payoutBottom2}</div>
                  <div>วิ่งบน: {r.payoutRunTop} / วิ่งล่าง: {r.payoutRunBottom}</div>
                </td>
                <td className="border px-2 py-1">{r.createdAtTH}</td>
                <td className="border px-2 py-1">
                  <button className="rounded bg-red-600 text-white px-3 py-1" onClick={() => remove(r.id)}>ลบ</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td className="border px-2 py-2 text-center" colSpan={7}>ไม่มีข้อมูล</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
