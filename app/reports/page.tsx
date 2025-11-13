'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// ==== Inline SVG Icons (แทน lucide-react) ====
function LockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="11" width="18" height="10" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      <circle cx="12" cy="16" r="1.5" fill="currentColor"></circle>
    </svg>
  );
}
function UnlockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="11" width="18" height="10" rx="2" ry="2"></rect>
      <path d="M17 11V7a5 5 0 0 0-9.5-2"></path>
      <circle cx="12" cy="16" r="1.5" fill="currentColor"></circle>
    </svg>
  );
}
// ==============================================

type TW = { id: number; startAt: string; endAt: string; note?: string | null };
type Item = {
  id: number;
  number: string;
  category: string;
  price: number;
  createdAt: string;
  userId?: number;
  canEdit?: boolean;
};
type GetResp = {
  items: Item[];
  total: number;
  from: string;
  to: string;
  windows: TW[];
  latest: TW | null;
  meId?: number | null;
};

const CATS = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
const CAT_TH: Record<(typeof CATS)[number], string> = {
  TOP3: '3 ตัวบน',
  TOD3: '3 โต๊ด',
  TOP2: '2 ตัวบน',
  BOTTOM2: '2 ตัวล่าง',
  RUN_TOP: 'วิ่งบน',
  RUN_BOTTOM: 'วิ่งล่าง',
};

// ===== helpers: ไทย <-> UTC =====
const TH_OFFSET_MIN = 7 * 60;
function utcToThaiLocalInput(iso: string): string {
  const d = new Date(iso);
  const msThai = d.getTime() + TH_OFFSET_MIN * 60_000;
  const t = new Date(msThai);
  const Y = t.getUTCFullYear();
  const M = String(t.getUTCMonth() + 1).padStart(2, '0');
  const D = String(t.getUTCDate()).padStart(2, '0');
  const h = String(t.getUTCHours()).padStart(2, '0');
  const m = String(t.getUTCMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D}T${h}:${m}`;
}
function thaiLocalInputToUtcIso(v: string): string {
  const [date, time] = v.split('T');
  const [Y, M, D] = (date || '').split('-').map((x) => Number(x));
  const [h, mi] = (time || '').split(':').map((x) => Number(x));
  const utcMs = Date.UTC(Y, (M || 1) - 1, D || 1, (h || 0) - 7, mi || 0, 0, 0);
  return new Date(utcMs).toISOString();
}
function fmtThai(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('th-TH', { hour12: false, timeZone: 'Asia/Bangkok' });
}

// ===== auth helpers (ไม่แตะลอจิกหลัก) =====
function readUidFromUrl(): number | null {
  if (typeof window === 'undefined') return null;
  const u = new URL(window.location.href);
  const val = u.searchParams.get('uid');
  if (!val) return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function readUidFromStorage(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('x-user-id');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function setUidToStorage(n: number) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('x-user-id', String(n));
}

export default function ReportsPage() {
  // meta
  const [windows, setWindows] = useState<TW[]>([]);
  const [latest, setLatest] = useState<TW | null>(null);
  const [meId, setMeId] = useState<number | null>(null);

  // ฟิลเตอร์
  const [twId, setTwId] = useState<string>('');
  const [fromTH, setFromTH] = useState<string>('');
  const [toTH, setToTH] = useState<string>('');
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState<string>('');

  // ตาราง
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // UI
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string>('');
  const [authWarn, setAuthWarn] = useState<string>('');

  // โหลด meta (และดึง uid เริ่มต้น)
  useEffect(() => {
    const uid = readUidFromUrl() ?? readUidFromStorage();
    if (uid) setMeId(uid);

    (async () => {
      const params = new URLSearchParams({ meta: 'only' });
      const res = await fetch(`/api/reports?${params.toString()}`, { cache: 'no-store', credentials: 'include' });
      const meta = (await res.json()) as { windows: TW[]; latest: TW | null; meId?: number | null };
      setWindows(meta.windows || []);
      setLatest(meta.latest || null);
      if (typeof meta.meId === 'number' && meta.meId > 0) {
        setMeId(meta.meId);
        setUidToStorage(meta.meId);
      }
      if (!uid && !meta.meId) {
        setAuthWarn('กรุณาใส่ x-user-id (เช่น เพิ่ม ?uid=1 ใน URL หรือ localStorage.setItem("x-user-id","1"))');
      }
      if (meta.latest) {
        setTwId(String(meta.latest.id));
        setFromTH(utcToThaiLocalInput(meta.latest.startAt));
        setToTH(utcToThaiLocalInput(meta.latest.endAt));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // เปลี่ยนงวด -> อัปเดตช่วงเวลาไทย
  useEffect(() => {
    if (!twId || !windows.length) return;
    const tw = windows.find((w) => String(w.id) === String(twId));
    if (tw) {
      setFromTH(utcToThaiLocalInput(tw.startAt));
      setToTH(utcToThaiLocalInput(tw.endAt));
    }
  }, [twId, windows]);

  const rangeLabel = useMemo(() => {
    if (!fromTH || !toTH) return '';
    const f = thaiLocalInputToUtcIso(fromTH);
    const t = thaiLocalInputToUtcIso(toTH);
    return `ช่วงเวลา: ${fmtThai(f)} – ${fmtThai(t)}`;
  }, [fromTH, toTH]);

  async function loadData(goPage = 1) {
    if (!fromTH || !toTH) return;
    setBusy(true);
    setAuthWarn('');
    try {
      const params = new URLSearchParams({
        page: String(goPage),
        pageSize: String(pageSize),
        ownOnly: '1',
      });
      if (twId) params.set('twId', String(twId));
      params.set('from', thaiLocalInputToUtcIso(fromTH));
      params.set('to', thaiLocalInputToUtcIso(toTH));
      if (q.trim()) params.set('q', q.trim());
      if (cat) params.set('cat', cat);

      const res = await fetch(`/api/reports?${params.toString()}`, { cache: 'no-store', credentials: 'include' });
      if (res.status === 401) {
        setItems([]);
        setTotal(0);
        setAuthWarn('เกิดข้อผิดพลาด: Unauthorized (missing x-user-id)');
        setBusy(false);
        return;
      }

      const data = (await res.json()) as GetResp;
      if (typeof data.meId === 'number' && data.meId > 0) {
        setMeId(data.meId);
        setUidToStorage(data.meId);
      }
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(goPage);
      setBanner(`กรองสำเร็จ • ${rangeLabel}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (fromTH && toTH) loadData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTH, toTH, pageSize]);

  // สิทธิ์แก้ไข
  function canEditThis(r: Item) {
    if (typeof r.canEdit === 'boolean') return r.canEdit;
    if (typeof r.userId === 'number' && typeof meId === 'number') return r.userId === meId;
    return false;
  }

  // Modal edit
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<Item | null>(null);
  const [editNum, setEditNum] = useState('');
  const [editCat, setEditCat] = useState<string>('');
  const [editPrice, setEditPrice] = useState<number>(0);

  function openEdit(row: Item) {
    if (!canEditThis(row)) return;
    setEditRow(row);
    setEditNum(row.number);
    setEditCat(row.category);
    setEditPrice(row.price);
    setEditOpen(true);
  }
  async function saveEdit() {
    if (!editRow) return;
    setBusy(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: editRow.id, number: editNum, category: editCat, price: editPrice, ownOnly: true }),
        credentials: 'include',
      });
      if (!res.ok) {
        alert('บันทึกไม่สำเร็จ');
      } else {
        setEditOpen(false);
        await loadData(page);
      }
    } finally {
      setBusy(false);
    }
  }
  async function delRow(id: number) {
    if (!confirm('ยืนยันลบรายการนี้?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/reports?id=${id}&ownOnly=1`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        alert('ลบไม่สำเร็จ');
      } else {
        await loadData(page);
      }
    } finally {
      setBusy(false);
    }
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  return (
    <div className="max-w-[1100px] mx-auto px-3 py-4 space-y-3">
      <div className="flex items-center gap-3">
        <Link href="/home" className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700">
          กลับหน้า Home
        </Link>
        <h1 className="text-lg font-semibold">รายงาน</h1>
      </div>

      {/* แถว 1: งวด */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600">งวด:</label>
        <select
          value={twId}
          onChange={(e) => setTwId(e.target.value)}
          className="border rounded-md px-2 py-1"
        >
          {windows.map((w) => (
            <option key={w.id} value={w.id}>
              #{w.id} • {fmtThai(w.startAt)} – {fmtThai(w.endAt)}
            </option>
          ))}
        </select>
      </div>

      {/* แถว 2: ช่วงเวลา */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-gray-600">ช่วงเวลา</div>
        <input
          type="datetime-local"
          className="border rounded-md px-2 py-1"
          value={fromTH}
          onChange={(e) => setFromTH(e.target.value)}
        />
        <span>ถึง</span>
        <input
          type="datetime-local"
          className="border rounded-md px-2 py-1"
          value={toTH}
          onChange={(e) => setToTH(e.target.value)}
        />
        <button
          onClick={() => loadData(1)}
          disabled={busy || !fromTH || !toTH}
          className="rounded bg-emerald-600 text-white px-3 py-2 disabled:opacity-60"
        >
          {busy ? 'กำลังกรอง…' : 'กรองช่วงเวลา'}
        </button>

        {banner && (
          <div className="ml-2 px-3 py-2 rounded bg-emerald-100 text-emerald-800 text-sm">
            {banner}
          </div>
        )}
        {authWarn && (
          <div className="ml-2 px-3 py-2 rounded bg-amber-100 text-amber-800 text-sm">
            {authWarn}
          </div>
        )}
      </div>

      {/* แถว 3: กรองเลข + หมวด */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-gray-600">หมวด:</div>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="border rounded-md px-2 py-1"
        >
          <option value="">ทั้งหมด</option>
          {CATS.map((c) => (
            <option key={c} value={c}>
              {CAT_TH[c]}
            </option>
          ))}
        </select>

        <div className="text-sm text-gray-600 ml-3">เลข:</div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาเลข"
          className="border rounded-md px-2 py-1"
        />
        <button
          onClick={() => loadData(1)}
          disabled={busy}
          className="rounded bg-gray-800 text-white px-3 py-2 disabled:opacity-60"
        >
          {busy ? 'กำลังค้นหา…' : 'ค้นหา'}
        </button>
      </div>

      {/* ตาราง */}
      <div className="overflow-x-auto">
        <table className="min-w-full border">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-2 py-1 text-center w-[16%]">เลข</th>
              <th className="border px-2 py-1 text-center w-[16%]">หมวด</th>
              <th className="border px-2 py-1 text-center w-[16%]">ราคา</th>
              <th className="border px-2 py-1 text-center w-[16%]">เวลา (ไทย)</th>
              <th className="border px-2 py-1 text-center w-[20%]">การกระทำ</th>
              <th className="border px-2 py-1 text-center w-[16%]">ล็อค</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-gray-500">
                  — ไม่มีข้อมูล —
                </td>
              </tr>
            ) : (
              items.map((r) => {
                const own = canEditThis(r);
                const locked = !own; // ไม่แตะลอจิกเดิม

                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="border px-2 py-1 text-center">{r.number}</td>
                    <td className="border px-2 py-1 text-center">
                      {CAT_TH[r.category as keyof typeof CAT_TH] || r.category}
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {Number(r.price).toLocaleString()}
                    </td>
                    <td className="border px-2 py-1 text-center">{fmtThai(r.createdAt)}</td>
                    <td className="border px-2 py-1">
                      <div className="flex items-center justify-center gap-4">
                        <button
                          className={`${own ? 'text-blue-600 hover:underline' : 'text-gray-400 cursor-not-allowed'}`}
                          onClick={() => own && openEdit(r)}
                          disabled={!own}
                          title={own ? '' : 'แก้ไขได้เฉพาะรายการของคุณ'}
                        >
                          แก้ไข
                        </button>
                        <button
                          className={`${own ? 'text-red-600 hover:underline' : 'text-gray-400 cursor-not-allowed'}`}
                          onClick={() => own && delRow(r.id)}
                          disabled={!own}
                          title={own ? '' : 'ลบได้เฉพาะรายการของคุณ'}
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                    <td className="border px-2 py-1 text-center">
                      {locked ? (
                        <span
                          title="ถูกล็อค (แก้ไข/ลบไม่ได้)"
                          className="inline-flex items-center justify-center"
                        >
                          <LockIcon
                            className="inline w-5 h-5 text-gray-600"
                            aria-label="ถูกล็อค (แก้ไข/ลบไม่ได้)"
                          />
                        </span>
                      ) : (
                        <span
                          title="ปลดล็อค (แก้ไข/ลบได้)"
                          className="inline-flex items-center justify-center"
                        >
                          <UnlockIcon
                            className="inline w-5 h-5 text-emerald-600"
                            aria-label="ปลดล็อค (แก้ไข/ลบได้)"
                          />
                        </span>
                      )}
                    </td>

                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* แถว 4: pagination ด้านขวา */}
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">แสดงหน้า</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const sz = Number(e.target.value) || 10;
              setPageSize(sz);
              loadData(1);
            }}
            className="border rounded-md px-2 py-1"
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
            className="px-2 py-1 border rounded-md"
            disabled={page <= 1}
            onClick={() => loadData(page - 1)}
          >
            ก่อนหน้า
          </button>
          <span>
            หน้า {page} / {totalPages}
          </span>
          <button
            className="px-2 py-1 border rounded-md"
            disabled={page >= totalPages}
            onClick={() => loadData(page + 1)}
          >
            ถัดไป
          </button>
        </div>
      </div>

      {/* Modal แก้ไข */}
      {editOpen && editRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3">
            <div className="text-lg font-semibold text-center">แก้ไขรายการ</div>
            <div className="space-y-2">
              <label className="block text-sm">เลข</label>
              <input
                value={editNum}
                onChange={(e) => setEditNum(e.target.value)}
                className="w-full border rounded-md px-2 py-1"
              />
              <label className="block text-sm mt-2">หมวด</label>
              <select
                value={editCat}
                onChange={(e) => setEditCat(e.target.value)}
                className="w-full border rounded-md px-2 py-1"
              >
                {CATS.map((c) => (
                  <option key={c} value={c}>
                    {CAT_TH[c]}
                  </option>
                ))}
              </select>
              <label className="block text-sm mt-2">ราคา</label>
              <input
                type="number"
                value={editPrice}
                onChange={(e) => setEditPrice(Number(e.target.value))}
                className="w-full border rounded-md px-2 py-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditOpen(false)} className="px-3 py-1.5 rounded-md border">
                ยกเลิก
              </button>
              <button onClick={saveEdit} className="px-3 py-1.5 rounded-md bg-blue-600 text-white">
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
