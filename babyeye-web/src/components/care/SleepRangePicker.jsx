import { useRef } from 'react'
import { careTime, durationText } from '../../utils/careTime'

export default function SleepRangePicker({ bounds, start, end, onChange }) {
  const anchor = useRef(null)
  const step = 5 * 60000
  const max = Math.floor((bounds.end - bounds.start) / step)
  const a = Math.max(0,Math.min(max-1,Math.round((start-bounds.start)/step)))
  const b = Math.max(1,Math.min(max,Math.round((end-bounds.start)/step)))
  const clamp = value => Math.max(0, Math.min(max, value))
  const point = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    return clamp(Math.round((event.clientX - rect.left) / rect.width * max))
  }
  function drag(event) {
    if (anchor.current === null) return
    const target = point(event), from = Math.min(anchor.current, target), to = Math.max(anchor.current, target)
    if (to > from) onChange(bounds.start+from*step, bounds.start+to*step)
  }
  return <div className="space-y-4">
    <p className="text-sm text-slate-300">막대를 손가락으로 쓸어 잠든 구간을 선택해 주세요.</p>
    <div aria-label="드래그로 수면 구간 선택" data-testid="sleep-drag-track" style={{touchAction:'none'}}
      className="relative flex h-16 select-none items-center rounded-xl border border-slate-600 bg-slate-800"
      onPointerDown={event => { event.preventDefault(); anchor.current = point(event); event.currentTarget.setPointerCapture?.(event.pointerId) }}
      onPointerMove={drag} onPointerUp={event => { drag(event); anchor.current = null }} onPointerCancel={() => {anchor.current=null}}>
      <div aria-hidden="true" className="absolute inset-y-2 rounded-lg bg-indigo-400/40" style={{left:`${a/max*100}%`,width:`${Math.max(0,b-a)/max*100}%`}} />
      <span aria-hidden="true" className="absolute left-2 text-[10px] text-slate-400">{careTime(bounds.start)}</span>
      <span aria-hidden="true" className="absolute right-2 text-[10px] text-slate-400">{careTime(bounds.end)}</span>
    </div>
    <div className="rounded-xl bg-indigo-400/10 p-3 text-center"><p className="text-sm font-semibold text-indigo-200">{careTime(start)} → {careTime(end)}</p><p className="mt-1 text-xs text-slate-400">{end>start?`수면 ${durationText((end-start)/60000)}`:'잠든 시각이 깬 시각보다 앞서야 해요.'}</p></div>
    <label className="block text-sm">잠든 시각 <span className="float-right text-xs text-slate-400">{careTime(start)}</span>
      <input aria-label="잠든 시각 조절" type="range" min="0" max={max-1} value={a} onChange={e => {
        const next = Math.min(Number(e.target.value),b-1); onChange(bounds.start+next*step,end)
      }} className="mt-3 h-8 w-full accent-indigo-300" /></label>
    <label className="block text-sm">깬 시각 <span className="float-right text-xs text-slate-400">{careTime(end)}</span>
      <input aria-label="깬 시각 조절" type="range" min="1" max={max} value={b} onChange={e => {
        const next = Math.max(Number(e.target.value),a+1); onChange(start,bounds.start+next*step)
      }} className="mt-3 h-8 w-full accent-indigo-300" /></label>
    <p className="text-xs text-slate-500">5분 단위로 조절할 수 있어요. 자정을 넘긴 수면도 한 번에 기록해요.</p>
  </div>
}
