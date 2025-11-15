'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

type Prize = {
  timeWindowId: number;
  top3: string;
  bottom2: string;
  payoutTop3: number;
  payoutTod3: number;
  payoutTop2: number;
  payoutBottom2: number;
  payoutRunTop: number;
  payoutRunBottom: number;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
};

export default function AdminPrizes() {
  const [twId, setTwId] = useState<number>(0);
  const [p, setP] = useState<Prize | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        const r = await fetch('/api/prizes', { cache: 'no-store' });
        if (!r.ok) {
          throw new Error(await r.text());
        }
        const j = await r.json();
        setTwId(j.timeWindowId);
        setP(j);
      } catch (e: any) {
        setErr(e?.message || 'โหลดข้อมูลไม่สำเร็จ');
      }
    })();
  }, []);

  async function save() {
    if (!p) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch('/api/prizes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(p),
      });
      if (!r.ok) throw new Error(await r.text());
      alert('บันทึกสำเร็จ');
    } catch (e: any) {
      setErr(e?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof Prize) => (v: any) =>
    setP(prev => (prev ? { ...prev, [k]: v } : prev));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Link href="/home" className="rounded bg-gray-700 px-3 py-2 text-white">กลับหน้า Home</Link>
        <div style={{ flex: 1 }} />
        <div>
          งวดล่าสุด:&nbsp;
          <b>
            {p && p.timeWindowStart && p.timeWindowEnd
              ? `${new Date(p.timeWindowStart).toLocaleString('th-TH', { hour12: false })} – ${new Date(p.timeWindowEnd).toLocaleString('th-TH', { hour12: false })}`
              : '-'}
          </b>
        </div>

      </div>

      <h2 className="text-xl font-bold mb-3">ตั้งค่ารางวัล & อัตราจ่าย (ตามงวด)</h2>
      {err && (
        <div style={{ border: '1px solid #f99', background: '#fee', padding: 8, marginBottom: 8 }}>
          {err}
        </div>
      )}

      {!p && !err && <div>กำลังโหลด...</div>}

      {p && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="border rounded p-3">
            <h3 className="font-semibold mb-2">เลขรางวัล</h3>
            <label className="block mb-2">3 ตัวบน
              <input
                className="border p-2 w-full"
                value={p.top3}
                disabled={saving}
                onChange={e =>
                  set('top3')(e.target.value.replace(/\D/g, '').slice(0, 3))
                }
              />
            </label>
            <label className="block mb-2">2 ตัวล่าง
              <input
                className="border p-2 w-full"
                value={p.bottom2}
                disabled={saving}
                onChange={e =>
                  set('bottom2')(e.target.value.replace(/\D/g, '').slice(0, 2))
                }
              />
            </label>
          </div>

          <div className="border rounded p-3">
            <h3 className="font-semibold mb-2">อัตราจ่าย (บาท/หน่วย)</h3>
            <div className="grid grid-cols-2 gap-3">
              <label>3 ตัวบน
                <input
                  className="border p-2 w-full"
                  type="number"
                  value={p.payoutTop3}
                  disabled={saving}
                  onChange={e => set('payoutTop3')(Number(e.target.value))}
                />
              </label>
              <label>3 โต๊ด
                <input
                  className="border p-2 w-full"
                  type="number"
                  value={p.payoutTod3}
                  disabled={saving}
                  onChange={e => set('payoutTod3')(Number(e.target.value))}
                />
              </label>
              <label>2 ตัวบน
                <input
                  className="border p-2 w-full"
                  type="number"
                  value={p.payoutTop2}
                  disabled={saving}
                  onChange={e => set('payoutTop2')(Number(e.target.value))}
                />
              </label>
              <label>2 ตัวล่าง
                <input
                  className="border p-2 w-full"
                  type="number"
                  value={p.payoutBottom2}
                  disabled={saving}
                  onChange={e => set('payoutBottom2')(Number(e.target.value))}
                />
              </label>
              <label>วิ่งบน
                <input
                  className="border p-2 w-full"
                  type="number"
                  value={p.payoutRunTop}
                  disabled={saving}
                  onChange={e => set('payoutRunTop')(Number(e.target.value))}
                />
              </label>
              <label>วิ่งล่าง
                <input
                  className="border p-2 w-full"
                  type="number"
                  value={p.payoutRunBottom}
                  disabled={saving}
                  onChange={e => set('payoutRunBottom')(Number(e.target.value))}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          disabled={!p || saving}
          onClick={save}
          className="rounded bg-blue-600 text-white px-4 py-2"
        >
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </div>
  );
}
