// app/order/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './order.module.css';

type Category = 'TOP3'|'TOD3'|'TOP2'|'BOTTOM2'|'RUN_TOP'|'RUN_BOTTOM';
type Row = { number:string; priceMain:string; priceTod?:string; reverse:boolean; };
type TW = { id:number; startAt:string; endAt:string; note?:string|null };

const onlyDigits = (s:string)=>s.replace(/\D+/g,'');
function requiredLength(cat:Category){
  if(cat==='TOP3'||cat==='TOD3') return 3;
  if(cat==='TOP2'||cat==='BOTTOM2') return 2;
  return 1; // RUN_TOP, RUN_BOTTOM
}
function catLabel(cat:Category){
  switch(cat){
    case 'TOP3': return '3 ตัวบน';
    case 'TOD3': return '3 โต๊ด';
    case 'TOP2': return '2 ตัวบน';
    case 'BOTTOM2': return '2 ตัวล่าง';
    case 'RUN_TOP': return 'วิ่งบน';
    case 'RUN_BOTTOM': return 'วิ่งล่าง';
  }
}
const thFormatter = new Intl.DateTimeFormat('th-TH', {
  year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hour12:false,
  timeZone:'Asia/Bangkok'
});
function fmtTH(dt:any){
  const d=new Date(dt);
  return thFormatter.format(d);
}
function emptyRows(cat:Category){
  const base:Row={number:'',priceMain:'',priceTod:cat==='TOP3'?'':undefined,reverse:false};
  return Array.from({length:10},()=>({...base}));
}

/** กลับเลขแบบไม่ซ้ำตัวเดิม (unique permutations) */
function generateReverseNumbers(num: string){
  if (num.length === 3) {
    const chars = num.split('').sort();
    const used = Array(chars.length).fill(false);
    const path: string[] = [];
    const out: string[] = [];
    const bt = () => {
      if (path.length === chars.length) { out.push(path.join('')); return; }
      for (let i=0;i<chars.length;i++){
        if (used[i]) continue;
        if (i>0 && chars[i]===chars[i-1] && !used[i-1]) continue;
        used[i]=true; path.push(chars[i]); bt(); path.pop(); used[i]=false;
      }
    };
    bt();
    return out;
  }
  if (num.length === 2) {
    const [a,b] = num.split('');
    return a===b ? [num] : [a+b, b+a];
  }
  return [num];
}

export default function OrderPage(){
  const [category,setCategory]=useState<Category>('TOP3');
  const [rows,setRows]=useState<Row[]>(()=>emptyRows('TOP3'));
  const [banner,setBanner]=useState<{type:'success'|'error'|'info';text:string}|null>(null);
  const [tw,setTw]=useState<TW|null>(null);
  const [now,setNow]=useState<number>(Date.now());

  const firstNumberInputRef = useRef<HTMLInputElement|null>(null);

  const showBanner=(type:'success'|'error'|'info',text:string)=>{
    setBanner({type,text});
    window.scrollTo({top:0,behavior:'smooth'});
  };

  async function loadActiveWindow(){
    try{
      const r=await fetch('/api/time-window/latest',{cache:'no-store'});
      setTw(r.ok?await r.json():null);
    }catch{
      setTw(null);
    }
  }

  useEffect(()=>{
    loadActiveWindow();
    const t=setInterval(()=>{
      setNow(Date.now());
      loadActiveWindow();
    },30000);
    return ()=>clearInterval(t);
  },[]);
  const inWindow=useMemo(()=>{
    if(!tw) return false;
    const s=new Date(tw.startAt).getTime();
    const e=new Date(tw.endAt).getTime();
    return now>=s && now<=e;
  },[tw,now]);

  const numLen = requiredLength(category);
  const showTod = category==='TOP3';
  const allowReverse = category==='TOP3'||category==='TOP2'||category==='BOTTOM2';

  function onCategoryChange(cat:Category){
    setCategory(cat);
    setRows(emptyRows(cat));
    setBanner(null);
  }
  function updateRow(idx:number,patch:Partial<Row>){
    setRows(prev=>prev.map((r,i)=>i===idx?{...r,...patch}:r));
  }

  async function onSubmit(e:React.FormEvent){
    e.preventDefault();
    if(!inWindow){
      showBanner('error',tw?'หมดเวลาลงสินค้า':'ยังไม่มีรอบที่เปิดอยู่');
      return;
    }

    // 🔹 Normalize ข้อมูลทุกแถวครั้งเดียว ใช้ทั้ง validate + payload
    const normalized = rows.map(r => {
      const numberDigits = onlyDigits(r.number).slice(0, numLen);
      const mainNum = Number(r.priceMain || 0);
      const todNum  = Number(r.priceTod || 0);
      return {
        raw: r,
        number: numberDigits,
        main: mainNum,
        tod: todNum,
        reverse: r.reverse,
      };
    });

    // 🔹 validate ตาม logic เดิม แต่ใช้ข้อมูล normalize แล้ว
    for(let i=0;i<rows.length;i++){
      const r = rows[i];
      const n = normalized[i];

      // ข้ามแถวว่าง ตามเงื่อนไขเดิม
      if(!r.number && !r.priceMain && !(showTod && r.priceTod)) continue;

      if(n.number.length!==numLen){
        showBanner('error',`แถวที่ ${i+1}: ต้องกรอกเลข ${numLen} หลัก — ${catLabel(category)}`);
        return;
      }
      if(n.main<=0 && !(showTod && n.tod>0)){
        showBanner('error',`แถวที่ ${i+1}: กรุณากรอกราคา`);
        return;
      }
    }

    // ✅ แสดงแบนเนอร์ “กำลังลงข้อมูล…” ทันทีที่เริ่มบันทึก
    showBanner('info','กำลังลงข้อมูล…');

    try{
      if(category==='TOP3'){
        // TOP3 (main) — อาจกลับเลข
        const top3Raw = normalized
          .map(n=>({ number:n.number, priceMain:n.main, reverse:n.reverse }))
          .filter(x=>x.number && x.priceMain>0);

        const top3WithReverse = top3Raw.flatMap(p=>{
          if(!p.reverse) return [p];
          const perms = generateReverseNumbers(p.number).filter(n=>n!==p.number);
          return [p, ...perms.map(n=>({ ...p, number:n, reverse:false }))];
        });

        // TOD3 (ราคาโต๊ด) — ไม่กลับเลข
        const tod3Items = normalized
          .map(n=>({ number:n.number, priceMain:n.tod }))
          .filter(x=>x.number && x.priceMain>0);

        if(top3WithReverse.length===0 && tod3Items.length===0){
          showBanner('info','ไม่มีรายการที่จะบันทึก');
          return;
        }

        if(top3WithReverse.length>0){
          const r1 = await fetch('/api/orders',{
            method:'POST',
            headers:{'content-type':'application/json'},
            body: JSON.stringify({
              category: 'TOP3',
              userId: 1,
              items: top3WithReverse.map(x=>({ number:x.number, priceMain:x.priceMain }))
            })
          });
          if(!r1.ok) throw new Error(await r1.text());
        }
        if(tod3Items.length>0){
          const r2 = await fetch('/api/orders',{
            method:'POST',
            headers:{'content-type':'application/json'},
            body: JSON.stringify({
              category: 'TOD3',
              userId: 1,
              items: tod3Items.map(x=>({ number:x.number, priceMain:x.priceMain }))
            })
          });
          if(!r2.ok) throw new Error(await r2.text());
        }
      }else{
        // หมวดอื่น ๆ ส่งตามหมวดที่เลือก (รองรับกลับเลขสำหรับ 2 ตัวบน/ล่าง)
        const base = normalized
          .map(n=>({ number:n.number, priceMain:n.main, reverse:n.reverse }))
          .filter(x=>x.number && x.priceMain>0);

        const expanded = allowReverse
          ? base.flatMap(p=>{
              if(!p.reverse) return [p];
              const perms = generateReverseNumbers(p.number).filter(n=>n!==p.number);
              return [p, ...perms.map(n=>({ ...p, number:n, reverse:false }))];
            })
          : base;

        if(expanded.length===0){
          showBanner('info','ไม่มีรายการที่จะบันทึก');
          return;
        }

        const r = await fetch('/api/orders',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body: JSON.stringify({
            category,
            userId: 1,
            items: expanded.map(x=>({ number:x.number, priceMain:x.priceMain }))
          })
        });
        if(!r.ok) throw new Error(await r.text());
      }

      // ✅ บันทึกสำเร็จ: รีเซ็ตตาราง และโฟกัสช่องเลขแถวแรก
      showBanner('success','บันทึกเรียบร้อย');
      setRows(emptyRows(category));
      setTimeout(()=>{ firstNumberInputRef.current?.focus(); }, 0);
    }catch(err:any){
      showBanner('error', err?.message || 'เกิดข้อผิดพลาดระหว่างบันทึก');
    }
  }

  const allowReverseForUI = allowReverse;

  return (
    <div className={styles.container}>
      {banner&&(
        <div
          className={`${styles.banner} ${banner.type==='success'?styles.bannerOk:banner.type==='info'?styles.bannerWarn:styles.bannerErr}`}
          style={{marginBottom:12}}
        >
          {banner.text}
        </div>
      )}

      <h2 className={styles.title}>สั่งซื้อ</h2>

      <div className={styles.infoBar}>
        {tw
          ? (<><b>รอบที่เปิดอยู่:</b> {fmtTH(tw.startAt)} – {fmtTH(tw.endAt)} {!inWindow&&<span className={styles.closed}>[หมดเวลาลงสินค้า]</span>}</>)
          : (<span className={styles.closed}>[ยังไม่มีรอบที่เปิดอยู่ในขณะนี้]</span>)
        }
      </div>

      <form onSubmit={onSubmit} className={styles.form}>
        <div className={styles.row}>
          <label className={styles.label}>หมวด</label>
          <select
            value={category}
            onChange={e=>onCategoryChange(e.target.value as Category)}
            className={styles.select}
          >
            <option value="TOP3">3 ตัวบน</option>
            <option value="TOD3">3 โต๊ด</option>
            <option value="TOP2">2 ตัวบน</option>
            <option value="BOTTOM2">2 ตัวล่าง</option>
            <option value="RUN_TOP">วิ่งบน</option>
            <option value="RUN_BOTTOM">วิ่งล่าง</option>
          </select>
          <div className={styles.hint}>ต้องการ {numLen} หลัก — {catLabel(category)}</div>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>ตัวเลข</th>
              <th>ราคา {catLabel(category)}</th>
              {category==='TOP3' && <th>ราคา 3 โต๊ด</th>}
              {allowReverseForUI && <th>กลับเลข</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r,idx)=>(
              <tr key={idx}>
                <td className={styles.center}>{idx+1}</td>
                <td>
                  <input
                    ref={idx===0 ? firstNumberInputRef : undefined}
                    className={styles.input}
                    value={r.number}
                    inputMode="numeric"
                    onChange={e=>updateRow(idx,{number:onlyDigits(e.target.value).slice(0,numLen)})}
                  />
                </td>
                <td>
                  <input
                    className={styles.input}
                    value={r.priceMain}
                    inputMode="numeric"
                    onChange={e=>updateRow(idx,{priceMain:onlyDigits(e.target.value)})}
                  />
                </td>

                {category==='TOP3' && (
                  <td>
                    <input
                      className={styles.input}
                      value={r.reverse ? '' : (r.priceTod||'')}
                      inputMode="numeric"
                      disabled={r.reverse}
                      placeholder={r.reverse?'ปิดเมื่อกลับเลข':''}
                      onChange={e=>{
                        if(r.reverse) return;
                        updateRow(idx,{priceTod:onlyDigits(e.target.value)});
                      }}
                    />
                  </td>
                )}

                {allowReverseForUI && (
                  <td className={styles.center}>
                    <input
                      type="checkbox"
                      checked={r.reverse}
                      disabled={category==='TOP3' ? !!(r.priceTod && Number(r.priceTod)>0) : false}
                      onChange={e=>{
                        const checked=e.target.checked;
                        updateRow(idx, checked ? {reverse:true, priceTod:''} : {reverse:false});
                      }}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.actions}>
          <button type="submit" className={styles.btn} disabled={!inWindow}>บันทึก</button>
          <Link href="/home" className={styles.btnBack}>กลับหน้า Home</Link>
        </div>
      </form>
    </div>
  );
}
