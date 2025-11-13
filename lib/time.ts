export function fmtTH(dt: Date | string | number) {
  const d = new Date(dt);
  return new Intl.DateTimeFormat('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Bangkok'
  }).format(d);
}
