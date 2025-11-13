'use client';

import { useEffect, useState } from 'react';

type Rule = {
  id?: number;
  mode: 'MANUAL' | 'AUTO';
  top3?: number | null;
  tod3?: number | null;
  top2?: number | null;
  bottom2?: number | null;
  runTop?: number | null;
  runBottom?: number | null;
  autoTopN?: number | null;
};

export default function AdminPage() {
  const [rule, setRule] = useState<Rule>({ mode: 'MANUAL' });
  const [timeWindows, setTimeWindows] = useState<{ id: number; startAt: string; endAt: string }[]>([]);
  const [selectTw, setSelectTw] = useState<number | ''>('');

  useEffect(() => {
    fetch('/api/admin/cap').then(r => r.json()).then(d => d.rule && setRule(d.rule));
    // ดึง time window คร่าว ๆ (คุณมีหน้า/ API แยกได้)
    fetch('/api/timewindows').then(r => r.json()).then(setTimeWindows).catch(() => setTimeWindows([]));
  }, []);

  async function saveCap() {
    const res = await fetch('/api/admin/cap', { method: 'POST', body: JSON.stringify(rule) });
    alert(res.ok ? 'บันทึกสำเร็จ' : 'บันทึกไม่สำเร็จ');
  }
  async function cut() {
    if (!selectTw) return alert('เลือกช่วงเวลา');
    const res = await fetch('/api/admin/cut', { method: 'POST', body: JSON.stringify({ timeWindowId: selectTw }) });
    alert(res.ok ? 'ตัดยอดสำเร็จ' : 'ตัดยอดไม่สำเร็จ');
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">ผู้ดูแลระบบ</h1>

      <section className="space-y-3 border p-4 rounded mb-6">
        <h2 className="font-medium">ตั้งค่าอั้น</h2>
        <label className="block">
          โหมด:
          <select
            value={rule.mode}
            onChange={e => setRule(r => ({ ...r, mode: e.target.value as Rule['mode'] }))}
            className="ml-2 border rounded px-2 py-1"
          >
            <option value="MANUAL">MANUAL</option>
            <option value="AUTO">AUTO</option>
          </select>
        </label>

        {rule.mode === 'MANUAL' && (
          <div className="grid grid-cols-2 gap-3">
            {(['top3','tod3','top2','bottom2','runTop','runBottom'] as const).map(k => (
              <label key={k} className="block">
                {k}: <input
                  type="number"
                  className="border rounded px-2 py-1 ml-2 w-32"
                  value={rule[k] ?? ''}
                  onChange={e => setRule(r => ({ ...r, [k]: e.target.value ? Number(e.target.value) : null }))}
                />
              </label>
            ))}
          </div>
        )}

        {rule.mode === 'AUTO' && (
          <label>
            autoTopN:
            <input
              type="number"
              className="border rounded px-2 py-1 ml-2 w-32"
              value={rule.autoTopN ?? ''}
              onChange={e => setRule(r => ({ ...r, autoTopN: e.target.value ? Number(e.target.value) : null }))}
            />
          </label>
        )}

        <button onClick={saveCap} className="mt-2 px-3 py-2 rounded bg-blue-600 text-white">บันทึก</button>
      </section>

      <section className="border p-4 rounded space-y-3">
        <h2 className="font-medium">ตัดยอดส่งเจ้ามือ</h2>
        <select
          value={selectTw}
          onChange={e => setSelectTw(e.target.value ? Number(e.target.value) : '')}
          className="border rounded px-2 py-1"
        >
          <option value="">-- เลือกช่วงเวลา --</option>
          {timeWindows.map(t => (
            <option key={t.id} value={t.id}>
              #{t.id} {new Date(t.startAt).toLocaleString()} - {new Date(t.endAt).toLocaleString()}
            </option>
          ))}
        </select>
        <button onClick={cut} className="px-3 py-2 rounded bg-emerald-600 text-white">ตัดยอด</button>
      </section>
    </main>
  );
}
