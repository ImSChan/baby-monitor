import { useState } from 'react'
import { ChevronDown, ChevronRight, MoonStar } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import QuickCareDialog from './QuickCareDialog'
export default function CareContextNote({ context }) {
  const [open,setOpen]=useState(null),[notice,setNotice]=useState('')
  const [params,setParams]=useSearchParams()
  const requested=params.get('care')
  const panel=['input','history','settings'].includes(requested)?requested:open
  function close(){setOpen(null);if(requested){const next=new URLSearchParams(params);next.delete('care');setParams(next,{replace:true})}}
  const showContext=context && context.reason !== 'snapshot_missing'
  const reasons = { child_age_missing:'아이 월령을 입력하면 육아 기록을 판단에 참고할 수 있어요.', age_timing_not_supported:'현재 월령은 시간 기록으로 AI 점수를 보정하지 않아요.', parent_disabled:'육아 기록 참고가 꺼져 있어요.', no_records:'참고할 육아 기록이 아직 없어요.',
    capture_time_unknown:'촬영 시각을 확인하지 못해 육아 기록은 참고하지 않았어요.', capture_time_out_of_range:'촬영 시각에 맞는 기록을 참고하지 않았어요.' }
  return <div className="mt-3">
    <button type="button" onClick={()=>{setNotice('');setOpen('input')}} className="group flex min-h-20 w-full items-center gap-3 rounded-2xl border border-[var(--status-border,#465780)] bg-[var(--status-tint,#25304A)] px-3 py-4 text-left text-sm font-semibold text-slate-100 shadow-sm transition hover:brightness-110 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[var(--status-accent,#A5B4FC)]"><MoonStar size={22}/></span><span className="min-w-0 flex-1 break-keep">육아기록으로 더 정확하게 판단하기<span className="mt-1 block text-xs font-normal text-slate-300">마지막 수면 · 마지막 식사 시간 입력</span></span><ChevronRight aria-hidden="true" size={18} className="shrink-0 text-[var(--status-accent,#A5B4FC)] transition-transform group-hover:translate-x-0.5"/></button>
    {notice&&<p role="status" className="mt-2 text-xs text-emerald-300">{notice}</p>}
    {showContext&&<details className="group mt-3 rounded-2xl border border-slate-600/70 bg-slate-900/40 text-xs text-slate-300">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-3 font-medium text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 [&::-webkit-details-marker]:hidden">이번 분석에 참고한 기록<ChevronDown aria-hidden="true" size={16} className="shrink-0 transition-transform motion-reduce:transition-none group-open:rotate-180"/></summary>
    <div className="space-y-2 border-t border-slate-700/60 px-4 py-3 leading-5">
      {context.ageMonths!=null&&<p>분석 시점 추정 월령: 약 {context.ageMonths}개월</p>}
      {context.applied ? <>{context.adjustments?.map(row => <p key={row.need}>{row.reason}</p>)}<p>영상·소리 결과에 시간 기록을 더해 점수를 최대 6%p 범위에서 조정했어요.</p></>
        : <p>{reasons[context.reason] || '기록을 확인했지만 시간만으로 판단을 바꾸지 않았어요.'}</p>}
      {context.recordedSleepMinutes24h != null && <p>지난 24시간에 기록된 수면: {Math.round(context.recordedSleepMinutes24h/60*10)/10}시간. 누락된 기록이 있을 수 있어요.</p>}
      <button type="button" onClick={()=>setOpen('history')} className="inline-block text-indigo-200 underline">육아 기록 확인</button>
    </div>
  </details>}
    {panel&&<QuickCareDialog initialPanel={panel} close={close} saved={()=>setNotice('기록했어요. 다음 분석부터 참고해요.')}/>}
  </div>
}
