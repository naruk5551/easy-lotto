'use client';

import { useState } from 'react';
import styles from './register.module.css';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data?.error ?? 'สมัครไม่สำเร็จ');
      return;
    }
    setMsg('สมัครสำเร็จ! รอผู้ดูแลอนุมัติก่อนเข้าสู่ระบบ');
    setTimeout(() => router.replace('/login'), 1000);
  }

  return (
    <main className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <h1>สมัครสมาชิก</h1>

        <label>ชื่อผู้ใช้</label>
        <input value={username} onChange={e => setU(e.target.value)} />

        <label>รหัสผ่าน</label>
        <input type="password" value={password} onChange={e => setP(e.target.value)} />

        {msg && <div className={styles.alert}>{msg}</div>}

        <button className={styles.btn} type="submit">สมัคร</button>
        <div className={styles.meta}>
          มีบัญชีแล้ว? <a href="/login">เข้าสู่ระบบ</a>
        </div>
      </form>
    </main>
  );
}
