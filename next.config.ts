// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // เดิมอยู่ใน experimental.serverComponentsExternalPackages -> ย้ายขึ้นมา top-level
  serverExternalPackages: ['@resvg/resvg-js'],

  // ระบุดิเรกทอรีรากให้ Turbopack ชัดเจน เมื่อพบหลาย lockfiles
  // แก้เป็นโฟลเดอร์แอปของคุณจริงๆ (ที่มี next.config.ts นี้และ package.json ของแอป)
  turbopack: {
    // ตัวอย่าง: ถ้าโปรเจกต์คุณอยู่ที่ C:\Users\Aungpao\my-app
    root: 'C:\\Users\\Aungpao\\my-app',
  },

  // ไม่ต้องมี experimental.serverComponentsExternalPackages อีกต่อไป
  experimental: {
    // ใส่เฉพาะคีย์ที่ถูกต้องของเวอร์ชันปัจจุบันเท่านั้น ถ้าไม่ใช้ก็ปล่อยว่างได้
  },

  // ตัวเลือกเสริม: ให้บันเดิลแบบ standalone (ช่วยตอน deploy และโหลด native/WASM ง่ายขึ้น)
  // เอาออกได้ถ้าไม่ต้องการ
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,

  // ปรับ fallback ฝั่ง client เผื่อแพ็กเกจฝั่ง server เผลออิมพอร์ตมา
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
