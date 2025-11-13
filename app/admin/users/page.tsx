import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const pending = await prisma.user.findMany({
    where: { approved: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, role: true, createdAt: true },
  });

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">อนุมัติผู้ใช้งาน</h1>

      {pending.length === 0 ? (
        <p>ไม่มีรายการรออนุมัติ</p>
      ) : (
        <table className="w-full border">
          <thead>
            <tr className="bg-gray-50">
              <th className="border px-2 py-1">ID</th>
              <th className="border px-2 py-1">Username</th>
              <th className="border px-2 py-1">Role</th>
              <th className="border px-2 py-1">สมัครเมื่อ</th>
              <th className="border px-2 py-1">Action</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((u) => (
              <tr key={u.id}>
                <td className="border px-2 py-1">{u.id}</td>
                <td className="border px-2 py-1">{u.username}</td>
                <td className="border px-2 py-1">{u.role}</td>
                <td className="border px-2 py-1">
                  {new Date(u.createdAt).toLocaleString()}
                </td>
                <td className="border px-2 py-1">
                  <form
                    action={`/api/admin/users/${u.id}/approve`}
                    method="post"
                  >
                    <button className="rounded bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-700">
                      อนุมัติ
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
