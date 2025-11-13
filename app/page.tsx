// app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold mb-6">ยินดีต้อนรับ</h1>

        <div className="grid gap-3">
          <Link
            href="/login"
            className="rounded bg-blue-600 px-4 py-2 text-white text-center hover:bg-blue-700"
          >
            เข้าสู่ระบบ
          </Link>

          <Link
            href="/register"
            className="rounded bg-emerald-600 px-4 py-2 text-white text-center hover:bg-emerald-700"
          >
            สมัครสมาชิก
          </Link>

          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full rounded border px-4 py-2 text-center hover:bg-gray-50"
            >
              ออกจากระบบ
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
