'use client';

import { useState } from 'react';
import styles from './login.module.css';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function safeParseJSON(res: Response) {
    // พยายามอ่าน JSON อย่างปลอดภัย รองรับทั้งกรณี body ว่าง/ไม่ใช่ JSON
    const ct = res.headers.get('content-type') || '';
    try {
      if (ct.includes('application/json')) {
        return await res.json();
      }
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return { message: text };
      }
    } catch {
      return null;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // สำคัญ: ให้เบราว์เซอร์ส่ง/รับคุกกี้จาก API
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const code = (data as any)?.error;
        const msg =
          code === 'not_approved'
            ? 'ผู้ใช้นี้ยังไม่ถูกอนุมัติจากผู้ดูแล'
            : (data as any)?.message ||
            'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
        setErr(msg);
        return;
      }
      // เคลียร์ uid เก่าให้หมด แล้วตั้งค่าใหม่จากการตอบกลับ
      try {
        localStorage.removeItem('x-user-id');
        if (typeof data?.uid === 'number') {
          localStorage.setItem('x-user-id', String(data.uid));
        }
      } catch { }

      window.location.replace('/home');
      // สำเร็จ: ไปหน้า Home
      //router.replace('/home');
    } catch (err) {
      setErr('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <h1>เข้าสู่ระบบ</h1>

        <label>ชื่อผู้ใช้</label>
        <input
          value={username}
          onChange={(e) => setU(e.target.value)}
          autoComplete="username"
        />

        <label>รหัสผ่าน</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setP(e.target.value)}
          autoComplete="current-password"
        />

        {error && <div className={styles.alert}>{error}</div>}

        <button className={styles.btn} type="submit" disabled={busy}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>

        <div className={styles.meta}>
          ยังไม่มีบัญชี? <a href="/register">สมัครสมาชิก</a>
        </div>
      </form>
    </main>
  );
}
