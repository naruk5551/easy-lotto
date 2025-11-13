// prisma/seed.ts
import { PrismaClient, Category, Role } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * ตั้งค่าได้ด้วย env:
 * - SEED_RESET=1  => ล้างข้อมูล Product ทั้งหมด + รีเซ็ตลำดับ id แล้วค่อย insert ตามลำดับหมวด
 *   (เหมาะกับเครื่อง dev ใหม่ หรืออยากให้ id เรียงสวย ๆ: 1-1000 TOP3, 1001-2000 TOD3, ...)
 * - ไม่ตั้ง (ค่าอื่น) => แทรกเพิ่มแบบ skipDuplicates (ไม่กระทบของเดิม)
 */
const DO_RESET = process.env.SEED_RESET === '1';

function pad(n: number, len: number) {
  return n.toString().padStart(len, '0');
}

async function seedUsers() {
  // ผู้ใช้ตัวอย่าง
  await prisma.user.upsert({
    where: { username: 'admin' },
    create: { username: 'admin', password: 'admin123', role: Role.ADMIN },
    update: {},
  });
  await prisma.user.upsert({
    where: { username: 'user' },
    create: { username: 'user', password: 'user123', role: Role.USER },
    update: {},
  });
}

function buildProducts() {
  // TOP3 / TOD3 : 000-999
  const top3 = Array.from({ length: 1000 }, (_, i) => ({ category: Category.TOP3, number: pad(i, 3) }));
  const tod3 = Array.from({ length: 1000 }, (_, i) => ({ category: Category.TOD3, number: pad(i, 3) }));
  // TOP2 / BOTTOM2 : 00-99
  const top2 = Array.from({ length: 100 }, (_, i) => ({ category: Category.TOP2, number: pad(i, 2) }));
  const bottom2 = Array.from({ length: 100 }, (_, i) => ({ category: Category.BOTTOM2, number: pad(i, 2) }));
  // RUN_TOP / RUN_BOTTOM : 0-9
  const runTop = Array.from({ length: 10 }, (_, i) => ({ category: Category.RUN_TOP, number: String(i) }));
  const runBottom = Array.from({ length: 10 }, (_, i) => ({ category: Category.RUN_BOTTOM, number: String(i) }));

  // รวมทั้งหมด = 1000 + 1000 + 100 + 100 + 10 + 10 = 2,220 รายการ
  return { top3, tod3, top2, bottom2, runTop, runBottom };
}

async function insertInOrder() {
  const { top3, tod3, top2, bottom2, runTop, runBottom } = buildProducts();

  // แทรกตามลำดับหมวด เพื่อให้ id ต่อเนื่องตามกลุ่ม เมื่อเริ่มจากตารางว่าง
  await prisma.product.createMany({ data: top3, skipDuplicates: true });
  await prisma.product.createMany({ data: tod3, skipDuplicates: true });
  await prisma.product.createMany({ data: top2, skipDuplicates: true });
  await prisma.product.createMany({ data: bottom2, skipDuplicates: true });
  await prisma.product.createMany({ data: runTop, skipDuplicates: true });
  await prisma.product.createMany({ data: runBottom, skipDuplicates: true });
}

async function main() {
  console.log('🌱 Seeding start. SEED_RESET =', DO_RESET ? '1 (RESET MODE)' : '0 (APPEND MODE)');

  await seedUsers();

  if (DO_RESET) {
    // ⚠️ โหมดรีเซ็ต: ลบเฉพาะตาราง Product และรีเซ็ตลำดับ id
    // (ไม่ไปแตะ Order/OrderItem/Excess/Batch เพื่อไม่กระทบข้อมูลทดสอบอื่น)
    await prisma.$transaction(async (tx) => {
      // ลบด้วย on-delete restriction ของ Prisma ต้องลบผ่าน SQL เพื่อล้างรวดเร็ว
      await tx.$executeRawUnsafe(`TRUNCATE TABLE "Product" RESTART IDENTITY CASCADE`);
    });
    console.log('🧹 Truncated Product and reset identity.');

    await insertInOrder();
  } else {
    // โหมดเพิ่ม/เติมรายการ: ไม่ลบของเดิม แค่เติมให้ครบ
    await insertInOrder();
  }

  // ตรวจนับ
  const byCat = await prisma.product.groupBy({
    by: ['category'],
    _count: { _all: true },
    orderBy: { category: 'asc' },
  });

  console.log('✅ Seed done. Count by category:');
  for (const r of byCat) {
    console.log(` - ${r.category}: ${r._count._all}`);
  }

  const total = await prisma.product.count();
  console.log('🎯 Total products:', total, '(expected 2220 if empty-reset)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
