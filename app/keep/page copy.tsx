'use client';

import React, { useEffect, useMemo, useState } from 'react';

const TZ = 'Asia/Bangkok';
const TH = 'th-TH';

function fmtThai(dt: Date | string | number) {
  const d = new Date(dt);
  return d.toLocaleString(TH, { hour12: false, timeZone: TZ });
}

function toUtcIsoFromLocalInput(v: string | null) {
  if (!v) return undefined;
  return new Date(v).toISOString();
}

type KeepRow = { category: string; number: string } & Record<string, any>;
type ApiKeepView = {
  from: string;
  to: string;
  total: number;
  items: KeepRow[];
  page: number;
  pageSize: number;
};

type TimeWindow = { id: number; startAt: string; endAt: string; note?: string | null };

function getAmount(it: KeepRow): number {
  // ชื่อ field ที่ API อาจคืนมาไม่ตายตัว => ป้องกัน undefined
  const v = it.keep ?? it.amount ?? it.inflow ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function KeepPage() {
  const [tw, setTw] = useState<TimeWindow | null>(null);

  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiKeepView | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/time-window/latest', { cache: 'no-store' });
      const j = (await res.json()) as TimeWindow | null;
      if (j) {
        setTw(j);
        const toLocalStr = (d: Date) =>
          new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .replace(':00.000Z', '');
        setFromLocal(toLocalStr(new Date(j.startAt)));
        setToLocal(toLocalStr(new Date(j.endAt)));
      }
    })();
  }, []);

  const badgeText = useMemo(() => {
    if (!tw) return '';
    return `ช่วงเวลา: ${fmtThai(tw.startAt)} – ${fmtThai(tw.endAt)}`;
  }, [tw]);

  async function doFilter(goPage = 1) {
    if (!fromLocal || !toLocal) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(goPage),
        pageSize: String(pageSize),
        from: toUtcIsoFromLocalInput(fromLocal)!,
        to: toUtcIsoFromLocalInput(toLocal)!,
      });
      const res = await fetch(`/api/keep-view?${q.toString()}`, { cache: 'no-store' });
      const j = (await res.json()) as ApiKeepView;
      setData(j);
      setPage(goPage);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (fromLocal && toLocal) doFilter(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLocal, toLocal, pageSize]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <a href="/home" className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
          กลับหน้า Home
        </a>
        <h1 className="text-xl font-semibold">ตาราง Keep (ยอดรับเอง)</h1>
      </div>

      {tw && (
        <div className="inline-block px-3 py-2 rounded bg-emerald-100 text-emerald-900">
          {badgeText}
        </div>
      )}

      <div className="border rounded p-3 space-y-2">
        <div className="font-medium mb-1">ช่วงย่อยภายในงวด (กรองทีละช่วง)</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={fromLocal}
            onChange={(e) => setFromLocal(e.target.value)}
            className="border rounded px-2 py-1"
          />
          <span>ถึง</span>
          <input
            type="datetime-local"
            value={toLocal}
            onChange={(e) => setToLocal(e.target.value)}
            className="border rounded px-2 py-1"
          />

          <button
            onClick={() => doFilter(1)}
            className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
          >
            กรองช่วงเวลา
          </button>

          {fromLocal && toLocal && (
            <div className="px-3 py-2 rounded bg-emerald-100 text-emerald-900">
              ช่วงเวลา: {fmtThai(new Date(fromLocal))} – {fmtThai(new Date(toLocal))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span>แสดงหน้า</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="border rounded px-2 py-1"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="w-full overflow-x-auto border rounded">
        <table className="min-w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left w-1/6">3 ตัวบน</th>
              <th className="p-2 text-left w-1/6">3 โต๊ด</th>
              <th className="p-2 text-left w-1/6">2 ตัวบน</th>
              <th className="p-2 text-left w-1/6">2 ตัวล่าง</th>
              <th className="p-2 text-left w-1/6">วิ่งบน</th>
              <th className="p-2 text-left w-1/6">วิ่งล่าง</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  กำลังโหลด…
                </td>
              </tr>
            ) : data && data.items.length > 0 ? (
              data.items.map((r, idx) => (
                <tr key={`${r.category}-${r.number}-${idx}`} className="border-t">
                  {(['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const).map(
                    (cat) => (
                      <td key={cat} className="p-2 align-top">
                        {r.category === cat ? (
                          <div>
                            {r.number} = {getAmount(r).toLocaleString()}
                          </div>
                        ) : null}
                      </td>
                    ),
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                — ไม่มีข้อมูล —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => doFilter(Math.max(1, page - 1))}
          className="px-3 py-1 rounded border"
          disabled={page <= 1}
        >
          ก่อนหน้า
        </button>
        <div>หน้า {page}</div>
        <button
          onClick={() => doFilter(page + 1)}
          className="px-3 py-1 rounded border"
          disabled={!data || data.items.length < pageSize}
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
}
