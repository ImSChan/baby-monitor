import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { apiGet, apiPost } from '../../api/client'
import { getAccessToken } from '../../api/authToken'
import { careTime, localInput } from '../../utils/careTime'

export default function QuickCareDialog({ close, saved }) {
  const dialog=useRef(null),controller=useRef(null),ids=useRef(new Map()),pending=useRef(false),owner=useRef(getAccessToken())
  const [meal,setMeal]=useState(''),[mealType,setMealType]=useState('meal')
  const [start,setStart]=useState(''),[end,setEnd]=useState('')
  const [done,setDone]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[summary,setSummary]=useState(null)
  useEffect(()=>{
    const abort=new AbortController();controller.current=abort;dialog.current?.showModal()
    apiGet('/api/care/summary',{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setSummary(value)}).catch(()=>{})
    return()=>{abort.abort();dialog.current?.close()}
  },[])
  async function submit(event){
    event.preventDefault();if(pending.current)return
    setError('')
    if(getAccessToken()!==owner.current){setError('로그인 계정이 변경됐어요. 다시 열어주세요.');return}
    if(!meal&&!start&&!end){setError('마지막 수면 또는 식사 시간을 입력해주세요.');return}
    if((start&&!end)||(!start&&end)){setError('수면은 잠든 시각과 깬 시각을 모두 입력해주세요.');return}
    const now=Date.now()
    if((meal&&new Date(meal).getTime()>now)||(end&&new Date(end).getTime()>now)){setError('미래 시각은 입력할 수 없어요.');return}
    if(start&&(!(new Date(start)<new Date(end))||new Date(end)-new Date(start)>86400000)){setError('수면 구간은 시작보다 종료가 늦어야 하며 최대 24시간이에요.');return}
    const records=[]
    if(start&&!done.sleep)records.push({kind:'sleep',meal_type:null,started_at:new Date(start).toISOString(),ended_at:new Date(end).toISOString()})
    if(meal&&!done.feeding)records.push({kind:'feeding',meal_type:mealType,started_at:new Date(meal).toISOString(),ended_at:null})
    pending.current=true;setBusy(true)
    const token=getAccessToken()
    try{
      for(const record of records){
        if(controller.current.signal.aborted||getAccessToken()!==token)throw new Error('로그인 계정이 변경됐어요. 다시 열어주세요.')
        const key=JSON.stringify(record)
        if(!ids.current.has(key))ids.current.set(key,crypto.randomUUID())
        await apiPost('/api/care/records',{id:ids.current.get(key),...record},{signal:controller.current.signal})
        if(controller.current.signal.aborted)return
        setDone(current=>({...current,[record.kind]:true}))
      }
      saved();close()
    }catch(err){if(!controller.current.signal.aborted)setError(err.status===409?'이미 기록한 수면과 겹쳐요. 육아 기록에서 기존 구간을 확인해주세요.':(err.message||'저장하지 못했어요. 다시 시도해주세요.'))}
    finally{pending.current=false;if(!controller.current.signal.aborted)setBusy(false)}
  }
  return <dialog ref={dialog} aria-labelledby="quick-care-title" onCancel={event=>{event.preventDefault();if(!busy)close()}} className="m-auto max-h-[90dvh] w-[calc(100%-24px)] max-w-[406px] overflow-y-auto rounded-3xl border border-slate-700 bg-[#101a2d] p-5 text-white backdrop:bg-black/70">
    <div className="flex items-center justify-between gap-3"><h2 id="quick-care-title" className="text-lg font-bold">마지막 수면 · 식사 기록</h2><button type="button" disabled={busy} aria-label="빠른 기록 닫기" onClick={close}><X size={22}/></button></div>
    <p className="mt-2 text-xs leading-5 text-slate-400">기억나는 항목만 입력해주세요. 저장한 기록은 다음 분석부터 참고해요.</p>
    {summary?.contextEnabled===false&&<p className="mt-3 text-xs leading-5 text-amber-200">육아 기록 참고가 꺼져 있어요. 기록 저장 후 <Link to="/care" className="underline">육아 기록</Link>에서 켜주세요.</p>}
    {summary&&summary.ageMonths==null&&<p className="mt-3 text-xs text-amber-200">월령별 판단을 위해 <Link to="/care" className="underline">아이 정보도 입력해주세요.</Link></p>}
    <form onSubmit={submit} className="mt-5 space-y-5">
      <fieldset disabled={busy||done.sleep} className="space-y-3 rounded-2xl border border-indigo-300/15 p-4"><legend className="px-1 font-semibold text-indigo-200">마지막 수면 {done.sleep?'· 저장 완료':''}</legend>
        {summary?.context?.lastSleepEndedAt&&<p className="text-xs text-slate-400">최근 기록: {careTime(summary.context.lastSleepEndedAt)}에 깼어요</p>}
        <label className="block text-sm">잠든 시각<input type="datetime-local" value={start} max={end||localInput()} onChange={e=>setStart(e.target.value)} className="mt-2 w-full min-w-0 rounded-lg bg-slate-800 p-3"/></label>
        <label className="block text-sm">깬 시각<input type="datetime-local" value={end} min={start||undefined} max={localInput()} onChange={e=>setEnd(e.target.value)} className="mt-2 w-full min-w-0 rounded-lg bg-slate-800 p-3"/></label>
      </fieldset>
      <fieldset disabled={busy||done.feeding} className="space-y-3 rounded-2xl border border-amber-300/15 p-4"><legend className="px-1 font-semibold text-amber-200">마지막 식사 {done.feeding?'· 저장 완료':''}</legend>
        {summary?.context?.lastMealAt&&<p className="text-xs text-slate-400">최근 기록: {careTime(summary.context.lastMealAt)}</p>}
        <label className="block text-sm">식사 종류<select value={mealType} onChange={e=>setMealType(e.target.value)} className="mt-2 w-full rounded-lg bg-slate-800 p-3"><option value="meal">이유식 · 식사</option><option value="milk">수유</option><option value="snack">간식</option></select></label>
        <label className="block text-sm">먹은 시각<input type="datetime-local" value={meal} max={localInput()} onChange={e=>setMeal(e.target.value)} className="mt-2 w-full min-w-0 rounded-lg bg-slate-800 p-3"/></label>
        <button type="button" onClick={()=>setMeal(localInput())} className="text-xs text-amber-200">방금 먹었어요</button>
      </fieldset>
      {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
      {(done.sleep||done.feeding)&&<p role="status" className="text-xs text-emerald-300">저장 완료한 항목은 다시 저장하지 않아요. 나머지 항목을 확인해주세요.</p>}
      <button disabled={busy} className="w-full rounded-xl bg-blue-600 py-3 font-semibold disabled:opacity-50">{busy?'저장 중…':'입력한 기록 저장'}</button>
      <Link to="/care" className="block text-center text-xs text-slate-400 underline">전체 육아 기록 보기</Link>
    </form>
  </dialog>
}
