'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './time-window.module.css';

type TW = { id:number; startAt:string; endAt:string; note?:string|null };

function toISOLocal(d: Date){
  const pad=(n:number)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TimeWindowPage(){
  const [items,setItems]=useState<TW[]>([]);
  const [start,setStart]=useState<string>('');
  const [end,setEnd]=useState<string>('');
  const [note,setNote]=useState<string>('');

  // ✅ รองรับได้ทั้งกรณี API ส่งเป็นอาร์เรย์ หรือ { items: [...] }
  async function load(){
    try{
      const r = await fetch('/api/time-window', { cache:'no-store' });
      if(!r.ok){ setItems([]); return; }
      const data = await r.json().catch(() => []);
      const arr: TW[] =
        Array.isArray(data) ? data :
        (data && Array.isArray((data as any).items) ? (data as any).items : []);
      setItems(arr ?? []);
    }catch{
      setItems([]);
    }
  }
  useEffect(()=>{ load(); },[]);

  async function add(){
    if(!start||!end){ alert('กรุณาเลือกเวลาเริ่มและสิ้นสุด'); return; }
    const res=await fetch('/api/time-window',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({startAt:new Date(start), endAt:new Date(end), note})
    });
    if(res.ok){
      setStart(''); setEnd(''); setNote('');
      load();
    }else{
      alert(await res.text());
    }
  }

  async function del(id:number){
    if(!confirm('ลบช่วงเวลานี้ใช่ไหม?')) return;
    const r=await fetch(`/api/time-window/${id}`,{method:'DELETE'});
    if(r.ok) load(); else alert(await r.text());
  }

  async function edit(item:TW){
    const s = prompt('เริ่ม (yyyy-mm-ddTHH:mm)', toISOLocal(new Date(item.startAt)));
    if(!s) return;
    const e = prompt('สิ้นสุด (yyyy-mm-ddTHH:mm)', toISOLocal(new Date(item.endAt)));
    if(!e) return;
    const n = prompt('บันทึกย่อ', item.note ?? '') ?? '';
    const r=await fetch(`/api/time-window/${item.id}`,{
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({startAt:new Date(s), endAt:new Date(e), note:n})
    });
    if(r.ok) load(); else alert(await r.text());
  }

  return(
    <div className={styles.container}>
      <h2 className={styles.title}>กำหนดช่วงเวลา (Time Window)</h2>

      {/* ฟอร์มบรรทัดเดียว */}
      <div className={styles.inlineForm}>
        <label className={styles.lbl}>เริ่ม</label>
        <input
          type="datetime-local"
          value={start}
          onChange={e=>setStart(e.target.value)}
          className={styles.input}
        />

        <label className={styles.lbl}>สิ้นสุด</label>
        <input
          type="datetime-local"
          value={end}
          onChange={e=>setEnd(e.target.value)}
          className={styles.input}
        />

        <label className={styles.lbl}>บันทึกย่อ</label>
        <input
          value={note}
          onChange={e=>setNote(e.target.value)}
          placeholder="เช่น รอบเช้า"
          className={styles.input}
        />
      </div>

      {/* ปุ่มแยกบรรทัดใหม่ตรงกลาง */}
      <div className={styles.centerButtons}>
        <button onClick={add} className={styles.btnPrimary}>เพิ่มช่วงเวลา</button>
        <Link href="/home" className={styles.btnHome}>กลับหน้า Home</Link>
      </div>

      <table className={styles.table}>
        <thead>
          <tr><th>ID</th><th>เริ่ม</th><th>สิ้นสุด</th><th>บันทึก</th><th></th></tr>
        </thead>
        <tbody>
          {items.map(it=>(
            <tr key={it.id}>
              <td>{it.id}</td>
              <td>{new Date(it.startAt).toLocaleString('th-TH',{hour12:false,timeZone:'Asia/Bangkok'})}</td>
              <td>{new Date(it.endAt).toLocaleString('th-TH',{hour12:false,timeZone:'Asia/Bangkok'})}</td>
              <td>{it.note ?? ''}</td>
              <td className={styles.actionsCell}>
                <button onClick={()=>edit(it)} className={styles.btnSmall}>แก้ไข</button>
                <button onClick={()=>del(it.id)} className={styles.btnSmallDanger}>ลบ</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
