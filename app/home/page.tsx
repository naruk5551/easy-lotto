// app/home/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Role = "USER" | "ADMIN";

type Me = {
  ok: boolean;
  user?: {
    id: number;
    username: string;
    role: Role;
    approved: boolean;
  };
};

export default function HomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let keep = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data: Me = await res.json();
        if (!keep) return;
        setMe(data);
      } catch {
        if (!keep) return;
        setMe({ ok: false });
      } finally {
        if (keep) setLoading(false);
      }
    })();
    return () => {
      keep = false;
    };
  }, []);

  if (loading) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="text-gray-600">กำลังโหลด...</div>
      </main>
    );
  }

  if (!me?.ok || !me.user) {
    return (
      <main className="min-h-dvh grid place-items-center p-6">
        <div className="w-full max-w-md text-center">
          <p className="mb-4">ยังไม่ได้เข้าสู่ระบบ</p>
          <Link
            href="/login"
            className="rounded bg-blue-600 px-4 py-2 text-white text-center hover:bg-blue-700"
          >
            ไปหน้า Login
          </Link>
        </div>
      </main>
    );
  }

  const isAdmin = me.user.role === "ADMIN";

  return (
    <main className="min-h-dvh p-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">หน้า Home</h1>
            <div className="text-sm text-gray-500">
              ผู้ใช้: {me.user.username} • สิทธิ์: {me.user.role}
            </div>
          </div>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded border px-3 py-2 hover:bg-gray-50"
            >
              ออกจากระบบ
            </button>
          </form>
        </header>

        {!me.user.approved && (
          <div className="mb-5 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
            บัญชียังไม่ถูกอนุมัติโดยผู้ดูแลระบบ — กรุณารอการอนุมัติ
          </div>
        )}

        {/* ===== ส่วนที่ 1: ปุ่มสั่งซื้อ / สรุปการสั่งซื้อ (USER/ADMIN เห็นได้) ===== */}
        <Section title="ปุ่มสั่งซื้อ & สรุป">
          <Card title="สั่งซื้อ" desc="ลงคำสั่งซื้อรายการเลข">
            <Link
              href="/order"
              className="inline-block rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              ไปหน้า สั่งซื้อ
            </Link>
          </Card>

          <Card title="สรุปการสั่งซื้อ" desc="ดูยอดรวมตามรายการที่ลง (รายตัว)">
            <Link
              href="/reports"
              className="inline-block rounded bg-slate-700 px-4 py-2 text-white hover:bg-slate-800"
            >
              ไปหน้า สรุปยอด
            </Link>
          </Card>
        </Section>

        {/* ===== ส่วนที่ 2: ผู้ดูแลระบบ (ตั้งค่า/จัดการ) ===== */}
        {isAdmin && (
          <Section title="ผู้ดูแลระบบ: ตั้งค่า/จัดการ">
            <Card title="กำหนดช่วงเวลาลงสินค้า" desc="ตั้งค่า Time Window">
              <Link
                href="/time-window"
                className="inline-block rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
              >
                ตั้งค่า Time Window
              </Link>
            </Card>

            <Card title="กำหนดยอดอั้น (Cap)" desc="ตั้ง CAP แบบ Manual/Auto">
              <Link
                href="/cap"
                className="inline-block rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
              >
                ไปหน้า กำหนดยอดอั้น
              </Link>
            </Card>

            <Card title="รางวัลที่ออก" desc="ตั้งเลขที่ออก/อัตราจ่ายต่อ งวด">
              {/* ✅ ปรับลิงก์ให้ไปหน้าใหม่ที่คุณใช้งาน */}
              <Link
                href="/prizes"
                className="inline-block rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
              >
                ไปหน้า รางวัลที่ออก
              </Link>
            </Card>

            <Card
              title="จัดการข้อมูล"
              desc="ลบข้อมูลทั้งงวด (เลือก Time Window แล้วลบ)"
            >
              {/* ✅ ปุ่มจัดการข้อมูลใหม่ */}
              <Link
                href="/data"
                className="inline-block rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
              >
                ไปหน้า จัดการข้อมูล
              </Link>
            </Card>

            <Card title="ลงสินค้า" desc="เพิ่มเลข/หมวดที่ใช้งาน (ถ้ามี)">
              <Link
                href="/products"
                className="inline-block rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
              >
                ไปหน้า ลงสินค้า
              </Link>
            </Card>
          </Section>
        )}

        {/* ===== ส่วนที่ 3: รายงาน/แสดงผล ===== */}
        {isAdmin && (
          <Section title="รายงาน/แสดงผล">
            <Card title="ยอดส่งเจ้ามือ" desc="รายการส่วนเกินอั้นส่งเจ้ามือ (Settle)">
              <Link
                href="/settle"
                className="inline-block rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
              >
                ไปหน้า ส่งเจ้ามือ
              </Link>
            </Card>

            <Card title="ยอดรับเอง (Keep)" desc="ยอดที่ไม่ถูกตัดอั้น">
              <Link
                href="/keep"
                className="inline-block rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
              >
                ไปหน้า ยอดรับเอง
              </Link>
            </Card>

            <Card title="ยอดรวม (Summary)" desc="สรุปทุกหมวดตามงวดที่เลือก">
              <Link
                href="/summary"
                className="inline-block rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
              >
                ไปหน้า ยอดรวม
              </Link>
            </Card>
          </Section>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold text-gray-700">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Card({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-2 text-lg font-medium">{title}</div>
      {desc && <div className="mb-4 text-sm text-gray-600">{desc}</div>}
      {children}
    </div>
  );
}
