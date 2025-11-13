'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './reports.module.css';

type Row = {
  id:number; category:string; number:string; price:number; sumAmount:number; createdAt:string;
};
const CAT_TH:Record<string,string>={
  TOP3:'3 ตัวบน',TOD3:'3 โต๊ด',TOP2:'2 ตัวบน',BOTTOM2:'2 ตัวล่าง',RUN_TOP:'วิ่งบน',RUN_BOTTOM:'วิ่งล่าง'
};
const thDT=(s?:string)=> s? new Date(s).toLocaleString('th-TH',{hour12:false,timeZone:'Asia/Bangkok'}):'—';

export default function ReportsPage(){
  const [userId,setUserId]=useState<number>(0);
  const [from,setFrom]=useState(''); const [to,setTo]=useState('');
  const [items,setItems]=useState<Row[]>([]);
  const [page,setPage]=useState(1); const [pageSize,setPageSize]=useState(10);
  const [total,setTotal]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    // TODO: เปลี่ยนวิธีอ่าน userId ให้ตรงกับระบบ auth ของคุณ (เช่นอ่านจาก cookie/session)
    const uid = Number(sessionStorage.getItem('userId')||'0');
    setUserId(uid);
  },[]);

  async function load(init=false){
    if(!userId) return;
    setLoading(true); setError(null);
    try{
      const qs = new URLSearchParams({ page:String(page), pageSize:String(pageSize), userId:String(userId) });
      if(from) qs.set('from', new Date(from).toISOString());
      if(to)   qs.set('to',   new Date(to).toISOString());
      const r=await fetch(`/api/reports?${qs}`,{cache:'no-store', credentials:'include'});
      if(!r.ok) throw new Error(await r.text());
      const j=await r.json();
      setItems(j.items||[]); setTotal(j.total||0);
      // ตั้งค่า default TW ล่าสุด (จาก API) → แปลงเป็น datetime-local (Bangkok)
      if(init && (!from || !to) && j.from && j.to){ setFrom(toLocal(j.from)); setTo(toLocal(j.to)); }
    }catch(e:any){ setError(e?.message||'โหลดไม่สำเร็จ'); setItems([]); setTotal(0); }
    finally{ setLoading(false); }
  }
  useEffect(()=>{ if(userId) load(true); },[userId]);
  useEffect(()=>{ if(userId) load(); },[page,pageSize,from,to]);

  const maxPage=Math.max(1,Math.ceil(total/pageSize));

  const onEdit=async (row:Row)=>{
    const v=Number(prompt('ราคาที่ต้องการบันทึกใหม่',String(row.price))||'NaN');
    if(Number.isNaN(v)) return;
    const r=await fetch('/api/reports',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:row.id,price:v})});
    if(r.ok) load(); else alert(await r.text());
  };
  const onDelete=async (id:number)=>{
    if(!confirm('ลบรายการนี้?')) return;
    const r=await fetch(`/api/reports?id=${id}`,{method:'DELETE'});
    if(r.ok) load(); else alert(await r.text());
  };

  return (
    <div className={styles.container}>
      <div className={styles.topbar}>
        <Link href="/home" className={styles.btn}>กลับหน้า Home</Link>
        <div className={styles.grow}/>
      </div>

      <h2 className={styles.title}>รายงานของฉัน</h2>

      <div className={styles.filters}>
        <div className={styles.row}>
          <label>ช่วงเวลา:</label>
          <input type="datetime-local" value={from} onChange={e=>{setPage(1); setFrom(e.target.value);}}/>
          <span>–</span>
          <input type="datetime-local" value={to} onChange={e=>{setPage(1); setTo(e.target.value);}}/>
          <button className={styles.btn} onClick={()=>{setPage(1); load();}}>กรองช่วงเวลา</button>
          <div className={styles.grow}/>
          <label>แสดง/หน้า</label>
          <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value)); setPage(1);}}>
            {[10,20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {error && <div className={styles.bannerErr}>{error}</div>}

      <table className={styles.table}>
        <thead><tr><th>หมวด</th><th>เลข</th><th>ราคา</th><th>เวลาที่ลง (กรุงเทพ)</th><th></th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className={styles.muted}>กำลังโหลด...</td></tr>
          ) : items.length ? items.map(r=>(
            <tr key={r.id}>
              <td>{CAT_TH[r.category]||r.category}</td>
              <td>{r.number}</td>
              <td className={styles.right}>{r.price.toLocaleString('th-TH')}</td>
              <td>{thDT(r.createdAt)}</td>
              <td className={styles.actions}>
                <button onClick={()=>onEdit(r)}>แก้ไข</button>
                <button className={styles.danger} onClick={()=>onDelete(r.id)}>ลบ</button>
              </td>
            </tr>
          )) : (
            <tr><td colSpan={5} className={styles.muted}>— ไม่มีข้อมูล —</td></tr>
          )}
        </tbody>
      </table>

      <div className={styles.pagination}>
        <button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</button>
        <span>หน้า {page}/{maxPage}</span>
        <button disabled={page>=maxPage} onClick={()=>setPage(p=>p+1)}>ถัดไป</button>
      </div>
    </div>
  );
}

function toLocal(s:string){
  const d=new Date(s); const pad=(n:number)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
