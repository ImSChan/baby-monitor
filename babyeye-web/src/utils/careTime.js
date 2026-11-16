export function localInput(value = new Date()) {
  const d = new Date(value)
  const pad = x => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function sleepWindow(day, now = new Date()) {
  const endDay = new Date(`${day}T00:00`)
  const start = new Date(endDay); start.setDate(start.getDate()-1)
  const end = new Date(endDay); end.setDate(end.getDate()+1)
  return { start: start.getTime(), end: Math.min(end.getTime(), now.getTime()) }
}
export function durationText(minutes) {
  const rounded = Math.round(minutes)
  return `${Math.floor(rounded / 60)}시간${rounded % 60 ? ` ${rounded % 60}분` : ''}`
}
export function careTime(value) {
  return new Date(value).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})
}
