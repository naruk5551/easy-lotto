// lib/tz.ts
// มาตรฐาน: เก็บ UTC, แสดงผล Bangkok 24 ชม.

export const BKK_TZ = 'Asia/Bangkok' as const

// รับสตริงโลคอล (เช่น "2025-11-06 19:30" หรือ "2025-11-06T19:30"),
// ตีความตาม timezone ที่ส่งมา แล้วคืน Date เป็น UTC
export function parseLocalToUTC(input?: string | null, tz: string = BKK_TZ): Date | undefined {
  if (!input) return undefined
  const s = input.trim().replace(' ', 'T')
  // แยกเป็นองค์ประกอบ
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) {
    // ถ้าเป็น ISO ที่มี Z/offset เดิมๆ ก็ปล่อย Date แปลงตามปกติ
    const d = new Date(input)
    return isNaN(d.getTime()) ? undefined : d
  }
  const [_, Y, M, D, h, mnt, sec] = m
  // ใช้ Intl.DateTimeFormat เพื่อคำนวณ offset ของ tz
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  // สร้าง date “เสมือน” ในโซน tz แล้วหา epoch UTC
  const parts = dtf.formatToParts(new Date(Date.UTC(+Y, +M - 1, +D, +h, +mnt, +(sec ?? 0))))
  const get = (t: Intl.DateTimeFormatPartTypes) => +((parts.find(p => p.type === t)?.value) ?? '0')
  // dtf ในโซนเป้าหมายจะคืนค่ากลับมาเป็นปี/เดือน/วัน/ชั่วโมงของโซนนั้น
  const utc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return new Date(utc)
}

// แปลง Date เป็นสตริงสำหรับ <input type="datetime-local"> ของโซน tz
export function toInputLocalValue(d?: Date | string | null, tz: string = BKK_TZ) {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  const fmt = new Intl.DateTimeFormat('sv-SE', { // sv-SE = yyyy-MM-ddTHH:mm:ss
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  // ตัดวินาทีทิ้งเพื่อเข้ากับ datetime-local
  return fmt.format(date).slice(0, 16)
}

// แสดงผล 24 ชม. โซนกรุงเทพ
export function fmtBKK(d?: Date | string | number | null) {
  if (d == null) return '—'
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: BKK_TZ, hour12: false,
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}
