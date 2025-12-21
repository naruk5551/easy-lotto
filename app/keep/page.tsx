'use client';

import React, { useEffect, useMemo, useState } from 'react';

type TimeWindow = { id: number; startAt: string; endAt: string; note?: string | null };
type KeepItem = { category: string; number: string } & Record<string, any>;
type KeepViewResp = {
  from: string;
  to: string;
  total: number;
  items: KeepItem[];
  page: number;
  pageSize: number;
};

const TZ = 'Asia/Bangkok';
const TH = 'th-TH';
const CATS = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;

/* ---------- utils ---------- */
function fmtThai(iso: string | Date) {
  return new Date(iso).toLocaleString(TH, { hour12: false, timeZone: TZ });
}

// แปลง Date → string สำหรับ <input type="datetime-local">
function toLocalInputValue(d: Date) {
  const noTZ = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return noTZ.toISOString().slice(0, 16);
}

// ✅ FIX TIMEZONE: แปลงค่าจาก <input type="datetime-local"> (ตีเป็น “เวลาไทย +07:00” เสมอ) → UTC ISO
function toUTCFromThaiLocalInput(v?: string | null) {
  if (!v) return undefined;
  const [date, time] = v.split('T');
  const [Y, M, D] = (date || '').split('-').map(Number);
  const [h, mi] = (time || '').split(':').map(Number);

  // NOTE: input เป็นเวลาไทย (+07) → แปลงเป็น UTC โดยลบ 7 ชม.
  const ms = Date.UTC(Y, (M || 1) - 1, D || 1, (h || 0) - 7, mi || 0, 0, 0);
  return new Date(ms).toISOString();
}

// ✅ FIX TIMEZONE (สำหรับแสดงผลกรองช่วงเวลา): สร้าง Date จาก input โดย “บังคับ +07:00”
function thaiLocalInputToDate(v?: string) {
  if (!v) return undefined;
  // ใส่ offset ให้ชัดเจน ไม่พึ่ง timezone เครื่องผู้ใช้
  const d = new Date(`${v}:00+07:00`); // v = YYYY-MM-DDTHH:mm
  return isNaN(d.getTime()) ? undefined : d;
}

// อ่านยอดจากแถว (ชื่อ field ที่ API อาจต่างกันเล็กน้อย)
function readAmount(it: KeepItem) {
  const v = it.keep ?? it.amount ?? it.inflow ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- page ---------- */
export default function KeepPage() {
  const [tw, setTw] = useState<TimeWindow | null>(null);

  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');

  const [loading, setLoading] = useState(false);

  // paging (ทำที่ฝั่ง client เอง)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // เก็บรายการ keep หลังกรอง 0 ออกแล้ว (ของทั้งช่วง)
  const [items, setItems] = useState<KeepItem[]>([]);

  /* โหลดงวดล่าสุด -> เซ็ตค่า default ให้ input */
  useEffect(() => {
    (async () => {
      const r = await fetch('/api/time-window/latest', { cache: 'no-store' });
      const j = (await r.json()) as TimeWindow | null;
      if (j) {
        setTw(j);
        setFromLocal(toLocalInputValue(new Date(j.startAt)));
        setToLocal(toLocalInputValue(new Date(j.endAt)));
      }
    })();
  }, []);

  const badgeText = useMemo(() => {
    if (!tw) return '';
    return `ช่วงเวลา: ${fmtThai(tw.startAt)} – ${fmtThai(tw.endAt)}`;
  }, [tw]);

  /* กดกรอง → POST /api/keep (บันทึก AcceptSelf) → GET /api/keep-view (ดึง “ทั้งช่วง”) */
  async function handleFilter(goPage = 1) {
    if (!fromLocal || !toLocal) return;
    setLoading(true);
    try {
      // ✅ FIX TIMEZONE: ใช้ตัวแปลงแบบบังคับเวลาไทย (+07) → UTC
      const fromISO = toUTCFromThaiLocalInput(fromLocal)!; // <--- changed
      const toISO = toUTCFromThaiLocalInput(toLocal)!;     // <--- changed

      // 1) บันทึก AcceptSelf ตามช่วง (เหมือนเดิม)
      await fetch('/api/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromISO, to: toISO }),
      });

      // 2) โหลด keep-view “รวบหน้าเดียว” แล้วค่อยแบ่งหน้าเองที่ฝั่ง client
      const p = new URLSearchParams({
        page: '1',
        pageSize: '100000', // ดึงชุดใหญ่ครั้งเดียว
        from: fromISO,
        to: toISO,
      });
      const res = await fetch('/api/keep-view?' + p.toString(), { cache: 'no-store' });
      const data = (await res.json()) as KeepViewResp;

      // 3) ตัด 0 บาทออก และเรียงตามหมวด + keep มาก → น้อย + เลข
      const filtered = (data.items || [])
        .filter((x) => readAmount(x) > 0)
        .sort((a, b) => {
          if (a.category !== b.category) return a.category.localeCompare(b.category);
          const ak = readAmount(a);
          const bk = readAmount(b);
          if (ak !== bk) return bk - ak; // มาก → น้อย
          return String(a.number).localeCompare(String(b.number));
        });

      setItems(filtered);
      setPage(goPage); // เริ่มที่หน้าที่สั่ง (ปกติส่ง 1)
    } finally {
      setLoading(false);
    }
  }

  /* เตรียมข้อมูลแบบ “หกคอลัมน์” ของทั้งช่วง */
  const { allGridRows, totalRowCount } = useMemo(() => {
    const byCat: Record<(typeof CATS)[number], KeepItem[]> = {
      TOP3: [],
      TOD3: [],
      TOP2: [],
      BOTTOM2: [],
      RUN_TOP: [],
      RUN_BOTTOM: [],
    };

    for (const it of items) {
      const cat = it.category as (typeof CATS)[number];
      if (CATS.includes(cat)) byCat[cat].push(it);
    }

    const maxLen = Math.max(...CATS.map((c) => byCat[c].length), 0);
    const rows: Array<Partial<Record<(typeof CATS)[number], KeepItem>>> = [];

    for (let i = 0; i < maxLen; i++) {
      const row: Partial<Record<(typeof CATS)[number], KeepItem>> = {};
      for (const c of CATS) {
        if (byCat[c][i]) row[c] = byCat[c][i];
      }
      rows.push(row);
    }

    return { allGridRows: rows, totalRowCount: maxLen };
  }, [items]);

  // slice ตาม page / pageSize  →  1 “รายการในตาราง” = 1 แถว สูงสุด pageSize แถว
  const pagedGridRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return allGridRows.slice(start, start + pageSize);
  }, [allGridRows, page, pageSize]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((totalRowCount || 1) / pageSize)),
    [totalRowCount, pageSize],
  );

  // ✅ FIX TIMEZONE: ข้อความ “ช่วงเวลา” ในกล่องเขียว ให้แสดงตามเวลาไทยจริง (ไม่พึ่ง timezone เครื่อง)
  const fromThaiDate = useMemo(() => thaiLocalInputToDate(fromLocal), [fromLocal]); // <--- added
  const toThaiDate = useMemo(() => thaiLocalInputToDate(toLocal), [toLocal]);       // <--- added

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <a href="/home" className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">
          กลับหน้า Home
        </a>
        <h1 className="text-xl font-semibold">ตาราง Keep (ยอดรับเอง)</h1>
      </div>

      {/* งวด */}
      {tw && (
        <div className="inline-block px-3 py-2 rounded bg-emerald-100 text-emerald-900">
          {badgeText}
        </div>
      )}

      {/* ฟอร์มกรอง (สไตล์เหมือนหน้า settle) */}
      <div className="border rounded p-3 space-y-2">
        <div className="font-medium mb-1">ช่วงย่อยภายในงวด (กรองทีละช่วง) — เวลาไทย</div>
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
            onClick={() => handleFilter(1)}
            className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
            disabled={loading}
          >
            {loading ? 'กำลังคำนวณ…' : 'กรองช่วงเวลา'}
          </button>

          {fromThaiDate && toThaiDate && (
            <div className="px-3 py-2 rounded bg-emerald-100 text-emerald-900">
              ช่วงเวลา: {fmtThai(fromThaiDate)} – {fmtThai(toThaiDate)}
              {/* ✅ FIX TIMEZONE: แสดงจาก Date ที่บังคับ +07:00 */}
            </div>
          )}
        </div>
      </div>

      {/* แถวควบคุมหน้า / pageSize (ตำแหน่งเหมือนหน้า settle) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>แสดงหน้า</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const sz = Number(e.target.value) || 10;
              setPageSize(sz);
              setPage(1);
            }}
            className="border rounded px-2 py-1"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1 rounded border"
            disabled={page <= 1 || loading}
          >
            ก่อนหน้า
          </button>
          <span>
            หน้า {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1 rounded border"
            disabled={loading || page >= totalPages}
          >
            ถัดไป
          </button>
        </div>
      </div>

      {/* ตารางหกคอลัมน์ (แต่ละหมวดเริ่มบรรทัดที่ 1) */}
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
            ) : pagedGridRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                  — ไม่มีข้อมูล —
                </td>
              </tr>
            ) : (
              pagedGridRows.map((row, i) => (
                <tr key={i} className="border-t align-top">
                  {CATS.map((c) => (
                    <td key={c} className="p-2 align-top">
                      {row[c] ? (
                        <div>
                          {row[c]!.number} = {readAmount(row[c]!).toLocaleString('th-TH')}
                        </div>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
