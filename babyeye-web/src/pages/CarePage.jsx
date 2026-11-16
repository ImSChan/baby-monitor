import { useCallback, useEffect, useRef, useState } from 'react'
import { Milk, Moon, Plus, X } from 'lucide-react'
import Header from '../components/common/Header'
import SleepRangePicker from '../components/care/SleepRangePicker'
import { apiGet, apiPost } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { careTime, durationText, localInput, sleepWindow } from '../utils/careTime'

function CareForm({ item, kind, close, saved }) {
  const dialog = useRef(null)
  const [day, setDay] = useState(localInput(item?.endedAt || new Date(Date.now()-30*60000)).slice(0,10))
  const [meal, setMeal] = useState(item?.mealType || 'meal')
  const [mealAt, setMealAt] = useState(localInput(item?.startedAt || new Date()))
  const [start, setStart] = useState(new Date(item?.startedAt || Math.floor((Date.now()-90*60000)/300000)*300000).getTime())
  const [end, setEnd] = useState(new Date(item?.endedAt || Math.floor((Date.now()-30*60000)/300000)*300000).getTime())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useRef(item?.id || crypto.randomUUID())
  const bounds = sleepWindow(day)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const payload = { id:id.current, kind, meal_type:kind==='feeding'?meal:null,
        started_at:new Date(kind==='feeding'?mealAt:start).toISOString(), ended_at:kind==='sleep'?new Date(end).toISOString():null,
        ...(item?{expected_revision:item.revision}:{}) }
      await apiPost(item?`/api/care/records/${item.id}`:'/api/care/records',payload)
      saved(); close()
    } catch(err) {setError(err.message || '기록을 저장하지 못했어요.')}
    finally {setBusy(false)}
  }
  return <dialog ref={dialog} onCancel={event=>{event.preventDefault();if(!busy)close()}} className="m-auto max-h-[90dvh] w-[calc(100%-24px)] max-w-[406px] overflow-y-auto rounded-3xl border border-slate-700 bg-[#101a2d] p-5 text-white backdrop:bg-black/70">
    <form onSubmit={submit}><fieldset disabled={busy} className="min-w-0 space-y-5"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">{kind==='sleep'?'수면 기록':'식사 기록'}{item?' 수정':''}</h2><button type="button" disabled={busy} onClick={close} aria-label="기록 창 닫기"><X size={22}/></button></div>
      {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
      {kind==='feeding'?<>
        <div className="grid grid-cols-3 gap-2">{[['meal','이유식'],['milk','수유'],['snack','간식']].map(([value,label])=><button key={value} type="button" aria-pressed={meal===value} onClick={()=>setMeal(value)} className={`rounded-xl border py-3 text-sm ${meal===value?'border-blue-300 bg-blue-500/20':'border-slate-700'}`}>{label}</button>)}</div>
        <label className="block text-sm">먹은 날짜와 시각<input autoFocus required type="datetime-local" value={mealAt} max={localInput()} onChange={e=>setMealAt(e.target.value)} className="mt-2 w-full min-w-0 rounded-xl bg-slate-800 p-3"/></label>
        <button type="button" onClick={()=>setMealAt(localInput())} className="text-sm text-blue-300">방금 먹었어요 · 현재 시각</button>
      </>:<>
        <label className="block text-sm">깬 날짜<input required type="date" value={day} max={localInput().slice(0,10)} onChange={e=>{
          if(!e.target.value)return;setDay(e.target.value);const next=sleepWindow(e.target.value);const finish=Math.floor(next.end/300000)*300000;setEnd(finish);setStart(finish-90*60000)
        }} className="mt-2 w-full min-w-0 rounded-xl bg-slate-800 p-3"/></label>
        <SleepRangePicker bounds={bounds} start={start} end={end} onChange={(a,b)=>{setStart(a);setEnd(b)}}/>
        <details className="text-xs text-slate-400"><summary>정확한 시각 직접 입력</summary><div className="mt-3 space-y-3"><label className="block">잠든 시각<input aria-label="잠든 시각 직접 입력" type="datetime-local" value={localInput(start)} min={localInput(bounds.start)} max={localInput(end)} onChange={e=>{if(e.target.value)setStart(new Date(e.target.value).getTime())}} className="mt-1 w-full min-w-0 rounded-lg bg-slate-800 p-2"/></label><label className="block">깬 시각<input aria-label="깬 시각 직접 입력" type="datetime-local" value={localInput(end)} min={localInput(start)} max={localInput(bounds.end)} onChange={e=>{if(e.target.value)setEnd(new Date(e.target.value).getTime())}} className="mt-1 w-full min-w-0 rounded-lg bg-slate-800 p-2"/></label></div></details>
        {end-start>86400000&&<p role="alert" className="text-xs text-amber-200">한 번에 최대 24시간의 수면을 기록할 수 있어요. 구간을 줄여주세요.</p>}
      </>}
      <p className="text-xs leading-5 text-slate-400">저장한 기록은 다음 분석부터 보조 정보로 참고해요. 기존 분석 결과는 바꾸지 않아요.</p>
      <button disabled={busy || (kind==='sleep'&&(!(start<end)||end-start>86400000))} className="w-full rounded-xl bg-blue-600 py-3 font-semibold disabled:opacity-40">{busy?'저장 중…':'기록 저장'}</button>
    </fieldset></form>
  </dialog>
}

export default function CarePage() {
  const {user}=useAuth()
  return <CareContent key={user?.id}/>
}
function CareContent() {
  const [rows,setRows]=useState([]),[summary,setSummary]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [loading,setLoading]=useState(true),[form,setForm]=useState(null),[deleting,setDeleting]=useState(null),[busy,setBusy]=useState(false),[more,setMore]=useState(false)
  const epoch=useRef(0)
  const load=useCallback(async()=>{
    const generation=++epoch.current
    setError('');setLoading(true)
    try{const [records,info]=await Promise.all([apiGet('/api/care/records?limit=200'),apiGet('/api/care/summary')]);if(generation!==epoch.current)return;setRows(records.items);setMore(records.items.length===200);setSummary(info)}
    catch(err){if(generation===epoch.current)setError(err.status===404?'서버에 육아 기록 기능을 먼저 적용해주세요.':err.message)}
    finally{if(generation===epoch.current)setLoading(false)}
  },[])
  useEffect(()=>{load();return()=>{epoch.current++}},[load])
  const context=summary?.context
  async function toggle(enabled){setBusy(true);try{await apiPost('/api/care/preferences',{context_enabled:enabled});setSummary(current=>({...current,contextEnabled:enabled}));setNotice('다음 분석부터 설정을 적용해요.')}catch(err){setError(err.message)}finally{setBusy(false)}}
  async function remove(row){setBusy(true);try{await apiPost(`/api/care/records/${row.id}/delete?expected_revision=${row.revision}`,{});setDeleting(null);setNotice('기록을 삭제했어요. 이후 분석에서는 참고하지 않아요.');await load()}catch(err){setError(err.message)}finally{setBusy(false)}}
  return <main className="space-y-5 px-5 py-6"><Header title="육아 기록" subtitle="먹고 잔 시간을 간편하게"/>
    <div className="rounded-2xl border border-blue-300/15 bg-blue-400/5 p-4"><p className="text-sm font-semibold text-blue-200">10개월 아이 기준으로 참고해요</p><p className="mt-2 text-xs leading-5 text-slate-400">시간만으로 배고픔·졸림을 단정하지 않고 영상·소리 분석을 보조해요.</p></div>
    {error&&<p role="alert" className="text-sm text-red-300">{error}<button onClick={load} className="ml-2 underline">새로고침</button></p>}
    {notice&&<p role="status" className="text-sm text-emerald-300">{notice}</p>}
    <div className="grid grid-cols-2 gap-3"><button onClick={()=>setForm({kind:'feeding'})} className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-left"><Milk size={25} className="text-amber-200"/><p className="mt-3 font-bold">식사 기록 <Plus size={14} className="inline"/></p><p className="mt-1 text-xs text-slate-400">먹은 시각 선택</p></button><button onClick={()=>setForm({kind:'sleep'})} className="rounded-2xl border border-indigo-300/20 bg-indigo-300/5 p-4 text-left"><Moon size={25} className="text-indigo-200"/><p className="mt-3 font-bold">수면 기록 <Plus size={14} className="inline"/></p><p className="mt-1 text-xs text-slate-400">드래그로 구간 선택</p></button></div>
    {summary&&<section className="space-y-3 rounded-2xl bg-slate-900 p-4"><h2 className="font-semibold">최근 기록 요약</h2><p className="text-sm text-slate-300">최근 식사: {context?.lastMealAt?careTime(context.lastMealAt):'기록 없음'}</p><p className="text-sm text-slate-300">최근 깬 시각: {context?.lastSleepEndedAt?careTime(context.lastSleepEndedAt):'기록 없음'}</p><p className="text-sm text-slate-300">24시간에 기록된 수면: {context?.recordedSleepMinutes24h!=null?durationText(context.recordedSleepMinutes24h):'기록 없음'}</p><p className="text-xs text-slate-500">기록이 빠져 있을 수 있어 수면 부족 여부는 판단하지 않아요.</p><label className="flex items-center gap-3 border-t border-slate-800 pt-3 text-sm"><input type="checkbox" checked={summary.contextEnabled} disabled={busy} onChange={e=>toggle(e.target.checked)}/>AI 판단에 육아 기록 참고</label></section>}
    <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-bold">최근 7일 기록</h2><button onClick={load} disabled={loading} className="text-xs text-blue-300">새로고침</button></div>{loading&&<p role="status" className="text-sm text-slate-400">기록을 불러오는 중…</p>}{!loading&&!rows.length&&!error&&<p className="rounded-2xl bg-slate-900 p-5 text-sm text-slate-400">아직 기록이 없어요. 방금 먹거나 잔 시간부터 남겨보세요.</p>}
      {rows.map(row=><article key={row.id} className="rounded-2xl border border-slate-700/60 p-4"><p className="font-semibold">{row.kind==='sleep'?'🌙 수면':row.mealType==='meal'?'🥣 이유식':row.mealType==='milk'?'🍼 수유':'🍌 간식'}</p><p className="mt-2 text-xs leading-6 text-slate-300">{careTime(row.startedAt)}{row.endedAt?` → ${careTime(row.endedAt)}`:''}</p>{row.endedAt&&<p className="text-xs text-indigo-200">{durationText((new Date(row.endedAt)-new Date(row.startedAt))/60000)}</p>}<div className="mt-3 flex gap-4 text-xs"><button onClick={()=>setForm({kind:row.kind,item:row})} className="text-blue-300">수정</button><button onClick={()=>setDeleting(row.id)} className="text-slate-400">삭제</button></div>{deleting===row.id&&<div className="mt-3 rounded-lg bg-slate-800 p-3 text-sm"><p>이 기록을 삭제할까요?</p><div className="mt-3 flex gap-4"><button disabled={busy} onClick={()=>remove(row)} className="text-red-300">삭제하기</button><button disabled={busy} onClick={()=>setDeleting(null)}>취소</button></div></div>}</article>)}
      {more&&<p className="text-xs text-slate-400">최근 기록 200개를 표시했어요.</p>}
    </section>
    <details className="rounded-2xl border border-slate-700 p-4 text-sm"><summary className="cursor-pointer font-semibold">10개월 참고 기준과 출처</summary><div className="mt-3 space-y-3 text-xs leading-6 text-slate-400"><p>아이사랑의 10~12개월 안내는 이유식 하루 3회와 아이의 배고픔·포만 신호 관찰을 설명해요. 모든 아이에게 적용할 고정 식사 간격은 정하지 않아요.</p><p>CDC의 4~12개월 수면 안내는 낮잠을 포함한 하루 12~16시간이에요. 기록된 시간이 이보다 짧다는 이유만으로 수면 부족이나 졸림으로 판단하지 않아요.</p><p>AI 보정에 쓰는 간격은 기록이 충분할 때 아이의 기록에서 계산해요. 의료 기준으로 정해진 시간이 아니에요.</p><a href="https://www.childcare.go.kr/?menuno=449" target="_blank" rel="noreferrer" className="block text-blue-300 underline">아이사랑 · 10~12개월 수유·영양</a><a href="https://www.cdc.gov/sleep/about/" target="_blank" rel="noreferrer" className="block text-blue-300 underline">CDC · 연령별 수면 안내</a></div></details>
    {form&&<CareForm {...form} close={()=>setForm(null)} saved={()=>{setNotice('기록했어요. 다음 분석부터 참고해요.');load()}}/>}
  </main>
}
