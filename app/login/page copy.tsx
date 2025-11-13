'use client';

import { useState } from 'react';
import styles from './login.module.css';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(
        data?.error === 'not_approved'
          ? 'ผู้ใช้นี้ยังไม่ถูกอนุมัติจากผู้ดูแล'
          : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      );
      return;
    }
    router.replace('/home');
  }

  return (
    <main className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <h1>เข้าสู่ระบบ</h1>

        <label>ชื่อผู้ใช้</label>
        <input value={username} onChange={e => setU(e.target.value)} />

        <label>รหัสผ่าน</label>
        <input type="password" value={password} onChange={e => setP(e.target.value)} />

        {error && <div className={styles.alert}>{error}</div>}

        <button className={styles.btn} type="submit">เข้าสู่ระบบ</button>

        <div className={styles.meta}>
          ยังไม่มีบัญชี? <a href="/register">สมัครสมาชิก</a>
        </div>
      </form>
    </main>
  );
}
