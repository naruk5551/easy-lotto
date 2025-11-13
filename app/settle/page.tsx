'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type TW = { id: number; startAt: string; endAt: string; note?: string | null };
type ViewRow = { category: string; number: string; totalSend: number };
type ViewResp = {
  from: string;
  to: string;
  total: number;
  items: ViewRow[];
  page: number;
  pageSize: number;
};

// ===== Helpers: Thai time <-> UTC =====
const TH_OFFSET_MIN = 7 * 60;

// format UTC ISO -> "YYYY-MM-DDTHH:mm" ใน "เวลาไทย"
function utcToThaiLocalInput(iso: string): string {
  const d = new Date(iso); // UTC
  const msThai = d.getTime() + TH_OFFSET_MIN * 60_000;
  const t = new Date(msThai); // ใช้ getUTC* เพื่อดึงคอมโพเนนต์หลัง shift แล้ว
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

// แปลงค่า input "YYYY-MM-DDTHH:mm" (ตีความเป็นเวลาไทย) -> ISO UTC
function thaiLocalInputToUtcIso(v: string): string {
  // แยกคอมโพเนนต์อย่างตรงไปตรงมา
  // (ชั่วโมงไทย -7 ชั่วโมง) แล้วให้ Date.UTC จัดการ roll-over
  const [date, time] = v.split('T');
  const [Y, M, D] = date.split('-').map((x) => Number(x));
  const [h, mi] = time.split(':').map((x) => Number(x));
  const utcMs = Date.UTC(Y, (M || 1) - 1, D || 1, (h || 0) - 7, mi || 0, 0, 0);
  return new Date(utcMs).toISOString();
}

// โชว์ช่วงไทยให้ผู้ใช้ดู
function humanThaiRange(fromIsoUTC: string, toIsoUTC: string) {
  const f = utcToThaiLocalInput(fromIsoUTC).replace('T', ' ');
  const t = utcToThaiLocalInput(toIsoUTC).replace('T', ' ');
  return `ช่วงเวลา: ${toThaiHuman(f)} – ${toThaiHuman(t)}`;
}
function toThaiHuman(local: string) {
  // local: "YYYY-MM-DD HH:mm"
  const [d, tm] = local.split(' ');
  const [Y, M, D] = d.split('-').map((n) => Number(n));
  // แสดงแบบไทยสั้น ๆ (ไม่แปลงปีพ.ศ. เพื่อความง่าย)
  return `${D.toString().padStart(2, '0')}/${M.toString().padStart(2, '0')}/${Y} ${tm}`;
}

// ===== Page =====
export default function SettlePage() {
  // time-window ล่าสุด
  const [tw, setTW] = useState<TW | null>(null);

  // ฟอร์มกรอง (อินพุตเป็นเวลาไทย)
  const [fromTH, setFromTH] = useState<string>(''); // "YYYY-MM-DDTHH:mm"
  const [toTH, setToTH] = useState<string>('');

  // ตาราง
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [total, setTotal] = useState<number>(0);

  // สถานะ
  const [busy, setBusy] = useState<boolean>(false);
  const [settleMsg, setSettleMsg] = useState<string>('');

  // โหลด TW ล่าสุดและ set default input = ขอบงวด (ไทย)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/time-window/latest', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as TW | null;
        if (!data) return;
        setTW(data);

        // default ช่วงย่อย = ทั้งงวด (ไทย)
        const fromLocal = utcToThaiLocalInput(data.startAt);
        const toLocal = utcToThaiLocalInput(data.endAt);
        setFromTH(fromLocal);
        setToTH(toLocal);

        // โหลดตารางทันที (แสดงผลหลังตัดก็ใช้ตัวนี้เหมือนเดิม)
        await loadView(fromLocal, toLocal, 1, pageSize);
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadView(fromLocalTH: string, toLocalTH: string, pg: number, sz: number) {
    const fromUTC = thaiLocalInputToUtcIso(fromLocalTH);
    const toUTC = thaiLocalInputToUtcIso(toLocalTH);

    const qs = new URLSearchParams({
      from: fromUTC,
      to: toUTC,
      page: String(pg),
      pageSize: String(sz),
    });
    const res = await fetch(`/api/settle-view?${qs.toString()}`, { cache: 'no-store' });
    if (!res.ok) {
      setRows([]);
      setTotal(0);
      return;
    }
    const data = (await res.json()) as ViewResp;
    setRows(data.items || []);
    setTotal(data.total || 0);
    setPage(pg);
  }

  // กด "กรองช่วงเวลา" = ตัดช่วง (เรียก POST /api/settle) แล้วค่อยโหลดตาราง
  async function handleSettle() {
    try {
      setBusy(true);
      setSettleMsg('');
      const fromUTC = thaiLocalInputToUtcIso(fromTH);
      const toUTC = thaiLocalInputToUtcIso(toTH);

      const res = await fetch('/api/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: fromUTC, to: toUTC }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSettleMsg(data?.error || 'ตัดช่วงไม่สำเร็จ');
      } else {
        // โชว์ช่วงที่ตัดสำเร็จ
        const appliedFrom = data?.window?.appliedFrom ?? fromUTC;
        const appliedTo = data?.window?.appliedTo ?? toUTC;
        setSettleMsg(humanThaiRange(appliedFrom, appliedTo));
        // รีโหลดผลลัพธ์
        await loadView(fromTH, toTH, 1, pageSize);
      }
    } catch (e: any) {
      console.error(e);
      setSettleMsg('เกิดข้อผิดพลาดระหว่างตัดช่วง');
    } finally {
      setBusy(false);
    }
  }

  // เปลี่ยน pageSize / หน้า
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // ====== จัดรูปแบบตาราง: ให้แต่ละหมวดเริ่มบรรทัดที่ 1 ======
  const CATS = ['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const;
  type Cat = (typeof CATS)[number];

  const gridRows = useMemo(() => {
    const byCat: Record<Cat, ViewRow[]> = {
      TOP3: [],
      TOD3: [],
      TOP2: [],
      BOTTOM2: [],
      RUN_TOP: [],
      RUN_BOTTOM: [],
    };
    for (const r of rows) {
      const c = r.category as Cat;
      if ((CATS as readonly string[]).includes(c)) byCat[c].push(r);
    }
    const maxLen = Math.max(...CATS.map((c) => byCat[c].length), 0);
    const packed: Array<Partial<Record<Cat, ViewRow>>> = [];
    for (let i = 0; i < maxLen; i++) {
      const row: Partial<Record<Cat, ViewRow>> = {};
      for (const c of CATS) if (byCat[c][i]) row[c] = byCat[c][i];
      packed.push(row);
    }
    return packed;
  }, [rows]);

  return (
    <div className="max-w-[1100px] mx-auto px-3 py-4 space-y-3">
      <div className="flex items-center gap-3">
        <Link
          href="/home"
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          กลับหน้า Home
        </Link>
        <h1 className="text-xl font-semibold">ตารางตัดยอดส่งเจ้ามือ</h1>
      </div>

      {/* แสดงช่วงงวด (ไทย) */}
      {tw && (
        <div className="inline-block rounded-md bg-emerald-100 text-emerald-800 px-3 py-1 text-sm">
          {humanThaiRange(tw.startAt, tw.endAt)}
        </div>
      )}

      {/* ฟอร์มกรอบช่วงย่อย (ไทย) */}
      <div className="border rounded-md p-3">
        <div className="text-sm mb-2">ช่วงย่อยภายในงวด (กรองทีละช่วง) — เวลาไทย</div>

        <div className="flex flex-wrap gap-2 items-center">
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
            onClick={handleSettle}
            disabled={busy || !fromTH || !toTH}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white disabled:opacity-60"
          >
            {busy ? 'กำลังตัดช่วง…' : 'กรองช่วงเวลา'}
          </button>

          {/* แถบผลลัพธ์ของรอบที่เพิ่งตัด */}
          {!!settleMsg && (
            <span className="ml-2 rounded-md bg-emerald-100 text-emerald-800 px-3 py-1 text-sm">
              {settleMsg}
            </span>
          )}
        </div>
      </div>

      {/* ควบคุม page size */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>แสดงหน้า</span>
          <select
            className="border rounded-md px-2 py-1"
            value={pageSize}
            onChange={(e) => {
              const sz = Number(e.target.value) || 10;
              setPageSize(sz);
              loadView(fromTH, toTH, 1, sz);
            }}
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* pagination */}
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 border rounded-md"
            disabled={page <= 1}
            onClick={() => loadView(fromTH, toTH, page - 1, pageSize)}
          >
            ก่อนหน้า
          </button>
          <span>
            หน้า {page} / {totalPages}
          </span>
          <button
            className="px-2 py-1 border rounded-md"
            disabled={page >= totalPages}
            onClick={() => loadView(fromTH, toTH, page + 1, pageSize)}
          >
            ถัดไป
          </button>
        </div>
      </div>

      {/* ตาราง (จัดให้แต่ละหมวดเริ่มบรรทัดที่ 1) */}
      <div className="overflow-x-auto">
        <table className="min-w-full border">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-2 py-1">3 ตัวบน</th>
              <th className="border px-2 py-1">3 โต๊ด</th>
              <th className="border px-2 py-1">2 ตัวบน</th>
              <th className="border px-2 py-1">2 ตัวล่าง</th>
              <th className="border px-2 py-1">วิ่งบน</th>
              <th className="border px-2 py-1">วิ่งล่าง</th>
            </tr>
          </thead>
          <tbody>
            {gridRows.length === 0 ? (
              <tr>
                <td className="text-center py-6 text-gray-500" colSpan={6}>
                  — ไม่มีข้อมูล —
                </td>
              </tr>
            ) : (
              gridRows.map((r, i) => (
                <tr key={i}>
                  {(['TOP3', 'TOD3', 'TOP2', 'BOTTOM2', 'RUN_TOP', 'RUN_BOTTOM'] as const).map(
                    (cat) => (
                      <td key={cat} className="border px-2 py-1 align-top">
                        {r[cat] ? `${r[cat]!.number} = ${Number(r[cat]!.totalSend)}` : ''}
                      </td>
                    ),
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
