'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './products.module.css';

type Category = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';
type Product = { id:number; category:Category; number:string; createdAt:string };

const CAT_TH: Record<Category,string> = {
  TOP3:'3 ตัวบน', TOD3:'3 โต๊ด', TOP2:'2 ตัวบน', BOTTOM2:'2 ตัวล่าง', RUN_TOP:'วิ่งบน', RUN_BOTTOM:'วิ่งล่าง'
};

export default function ProductsPage(){
  const [data,setData]=useState<Product[]>([]);
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(10);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);

  async function load(){
    setLoading(true);
    setError(null);
    try{
      const r=await fetch(`/api/products?page=${page}&pageSize=${pageSize}`,{cache:'no-store'});
      if(!r.ok){
        const t = await r.text();
        throw new Error(t || `โหลดข้อมูลไม่สำเร็จ (${r.status})`);
      }
      const json = await r.json();
      const items: Product[] = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : []);
      const totalCount: number = typeof json?.total === 'number' ? json.total : items.length;
      setData(items);
      setTotal(totalCount);
    }catch(e:any){
      setError(e?.message || 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
      setData([]);
      setTotal(0);
    }finally{
      setLoading(false);
    }
  }
  useEffect(()=>{ load(); },[page,pageSize]);

  const maxPage = Math.max(1, Math.ceil(total/pageSize));

  return(
    <div className={styles.container}>
      {/* ปุ่ม Home ด้านบน */}
      <div className={styles.row} style={{marginBottom:8}}>
        <Link href="/home" className={styles.btnSmall}>กลับหน้า Home</Link>
        <div className={styles.flexGrow}/>
      </div>

      <h2 className={styles.title}>รายการสินค้า (Products)</h2>

      <div className={styles.row}>
        <label>แสดงต่อหน้า</label>
        <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value)); setPage(1);}}>
          {[10,20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
        </select>
        <div className={styles.flexGrow}/>
        <div>ทั้งหมด {total} รายการ</div>
      </div>

      {error && <div className={styles.bannerErr}>{error}</div>}

      <table className={styles.table}>
        <thead>
          <tr><th>ID</th><th>หมวด</th><th>เลข</th><th>สร้างเมื่อ</th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={4} className={styles.actionsCell}>กำลังโหลด...</td></tr>
          ) : data.length > 0 ? (
            data.map(p=>(
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{CAT_TH[p.category]}</td>
                <td>{p.number}</td>
                <td>{new Date(p.createdAt).toLocaleString('th-TH',{hour12:false,timeZone:'Asia/Bangkok'})}</td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={4} className={styles.actionsCell} style={{textAlign:'center',opacity:.7}}>ไม่มีข้อมูลสินค้า</td></tr>
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
