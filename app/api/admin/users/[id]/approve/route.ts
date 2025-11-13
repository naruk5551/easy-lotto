import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  await prisma.user.update({
    where: { id },
    data: { approved: true },
  });

  return NextResponse.redirect(new URL("/admin/users", process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"));
}
