// lib/hash.ts
import bcrypt from 'bcryptjs';

export async function hashPassword(plain: string) {
  // 10 รอบพอสำหรับเว็บทั่วไป (เพิ่มได้ตามต้องการ)
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

export async function comparePassword(plain: string, hashed: string) {
  return bcrypt.compare(plain, hashed);
}
