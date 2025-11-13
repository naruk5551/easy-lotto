// app/dashboard/page.tsx
import "server-only";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isAdmin = session.role === "ADMIN";

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">
        สวัสดี {session.username} ({session.role})
      </h1>

      <div className="grid sm:grid-cols-2 gap-3">
        {/* เมนูสำหรับทุกคน */}
        <Card title="สั่งซื้อ" href="/order" />
        <Card title="สรุปยอด" href="/reports" />

        {/* เมนูเฉพาะแอดมิน */}
        {isAdmin && (
          <>
            <Card title="อนุมัติผู้ใช้งาน" href="/admin/users" />
            <Card title="กำหนดช่วงเวลา (Time Window)" href="/admin/time" />
            <Card title="กำหนดยอดอั้น (Manual/Auto)" href="/admin/cap" />
            <Card title="ตัดยอดส่งเจ้ามือ / Export" href="/admin/export" />
          </>
        )}
      </div>

      <form action="/api/auth/logout" method="post" className="mt-8">
        <button className="rounded border px-4 py-2 hover:bg-gray-50">
          ออกจากระบบ
        </button>
      </form>
    </main>
  );
}

function Card({ title, href }: { title: string; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded border p-4 hover:bg-gray-50 transition"
    >
      {title}
    </Link>
  );
}
