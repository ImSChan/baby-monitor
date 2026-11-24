import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import SleepRangePicker from './SleepRangePicker'
import ChildProfileForm from './ChildProfileForm'
import { apiGet, apiPost } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import { careTime, durationText, localInput, sleepWindow } from '../../utils/careTime'

function CareForm({ item, kind, close, saved }) {
  const [day, setDay] = useState(localInput(item?.endedAt || new Date(Date.now()-30*60000)).slice(0,10))
  const [meal, setMeal] = useState(item?.mealType || 'meal')
  const [mealAt, setMealAt] = useState(localInput(item?.startedAt || new Date()))
  const [start, setStart] = useState(new Date(item?.startedAt || Math.floor((Date.now()-90*60000)/300000)*300000).getTime())
  const [end, setEnd] = useState(new Date(item?.endedAt || Math.floor((Date.now()-30*60000)/300000)*300000).getTime())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const id = useRef(item?.id || crypto.randomUUID())
  const bounds = sleepWindow(day)
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
  return <section aria-label="기록 수정" className="rounded-2xl border border-slate-600 bg-slate-900 p-4">
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
  </section>
}

export default function CareManagement({ mode, changed }) {
  const {user}=useAuth()
  return <CareContent key={user?.id} mode={mode} changed={changed}/>
}
function CareContent({ mode, changed }) {
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
  async function toggle(enabled){const previous=summary.contextEnabled;setSummary(current=>({...current,contextEnabled:enabled}));setBusy(true);try{await apiPost('/api/care/preferences',{context_enabled:enabled});setSummary(current=>({...current,contextEnabled:enabled}));setNotice('다음 분석부터 설정을 적용해요.');changed?.()}catch(err){setSummary(current=>({...current,contextEnabled:previous}));setError(err.message)}finally{setBusy(false)}}
  async function remove(row){setBusy(true);try{await apiPost(`/api/care/records/${row.id}/delete?expected_revision=${row.revision}`,{});setDeleting(null);setNotice('기록을 삭제했어요. 이후 분석에서는 참고하지 않아요.');await load();changed?.()}catch(err){setError(err.message)}finally{setBusy(false)}}
  return <div className="mt-5 space-y-5">
    {mode==='settings'&&summary&&<ChildProfileForm profile={summary} saved={()=>{setNotice('아이 정보를 저장했어요. 다음 분석부터 적용해요.');load();changed?.()}}/>}
    {error&&<p role="alert" className="text-sm text-red-300">{error}<button onClick={load} className="ml-2 underline">새로고침</button></p>}
    {notice&&<p role="status" className="text-sm text-emerald-300">{notice}</p>}

    {summary&&<section className="space-y-3 rounded-2xl bg-slate-900 p-4"><h2 className="font-semibold">최근 기록 요약</h2><p className="text-sm text-slate-300">최근 식사: {context?.lastMealAt?careTime(context.lastMealAt):'기록 없음'}</p><p className="text-sm text-slate-300">최근 깬 시각: {context?.lastSleepEndedAt?careTime(context.lastSleepEndedAt):'기록 없음'}</p><p className="text-sm text-slate-300">24시간에 기록된 수면: {context?.recordedSleepMinutes24h!=null?durationText(context.recordedSleepMinutes24h):'기록 없음'}</p><p className="text-xs text-slate-500">기록이 빠져 있을 수 있어 수면 부족 여부는 판단하지 않아요.</p><label className="flex items-center gap-3 border-t border-slate-800 pt-3 text-sm"><input type="checkbox" checked={summary.contextEnabled} disabled={busy} onChange={e=>toggle(e.target.checked)}/>AI 판단에 육아 기록 참고</label></section>}
    {mode==='history'&&<section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-bold">최근 7일 기록</h2><button onClick={load} disabled={loading} className="text-xs text-blue-300">새로고침</button></div>{loading&&<p role="status" className="text-sm text-slate-400">기록을 불러오는 중…</p>}{!loading&&!rows.length&&!error&&<p className="rounded-2xl bg-slate-900 p-5 text-sm text-slate-400">아직 기록이 없어요. 방금 먹거나 잔 시간부터 남겨보세요.</p>}
      {rows.map(row=><article key={row.id} className="rounded-2xl border border-slate-700/60 p-4"><p className="font-semibold">{row.kind==='sleep'?'🌙 수면':row.mealType==='meal'?'🥣 이유식':row.mealType==='milk'?'🍼 수유':'🍌 간식'}</p><p className="mt-2 text-xs leading-6 text-slate-300">{careTime(row.startedAt)}{row.endedAt?` → ${careTime(row.endedAt)}`:''}</p>{row.endedAt&&<p className="text-xs text-indigo-200">{durationText((new Date(row.endedAt)-new Date(row.startedAt))/60000)}</p>}<div className="mt-3 flex gap-4 text-xs"><button onClick={()=>setForm({kind:row.kind,item:row})} className="text-blue-300">수정</button><button onClick={()=>setDeleting(row.id)} className="text-slate-400">삭제</button></div>{deleting===row.id&&<div className="mt-3 rounded-lg bg-slate-800 p-3 text-sm"><p>이 기록을 삭제할까요?</p><div className="mt-3 flex gap-4"><button disabled={busy} onClick={()=>remove(row)} className="text-red-300">삭제하기</button><button disabled={busy} onClick={()=>setDeleting(null)}>취소</button></div></div>}</article>)}
      {more&&<p className="text-xs text-slate-400">최근 기록 200개를 표시했어요.</p>}
    </section>}
    {mode==='settings'&&<details className="rounded-2xl border border-slate-700 p-4 text-sm"><summary className="cursor-pointer font-semibold">월령별 참고 기준과 출처</summary><div className="mt-3 space-y-3 text-xs leading-6 text-slate-400">
      {summary?.agePolicy?.sleepHours&&<p>현재 월령의 하루 수면 참고 범위: 낮잠 포함 {summary.agePolicy.sleepHours.join('~')}시간.</p>}
      {summary?.agePolicy?.mealsPerDay&&<p>보완식 참고 횟수: 하루 {summary.agePolicy.mealsPerDay.join('~')}회. 수유와 아이의 배고픔·포만 신호를 함께 살펴주세요.</p>}
      <p>6개월 미만은 수유 기록만 식사 간격에 참고해요. 간식은 식사 간격에서 제외해요. 같은 성장 단계·같은 식사 종류의 기록이 충분할 때 개인 간격을 계산해요.</p>
      <p>0~3개월과 36개월 이상은 시간에 따른 AI 점수 보정을 하지 않아요. 월령이 없으면 보정하지 않아요.</p>
      <p>일일 권장량을 고정된 식사·깨어 있는 시간 간격으로 환산하지 않아요. 기록 누락이 있을 수 있어 수면 부족을 판단하지 않아요. 기록만으로 학습 정답을 만들지 않아요.</p>
      <a href="https://www.who.int/health-topics/complementary-feeding" target="_blank" rel="noreferrer" className="block text-blue-300 underline">WHO · 월령별 보완식 안내</a>
      <a href="https://www.cdc.gov/sleep/about/" target="_blank" rel="noreferrer" className="block text-blue-300 underline">CDC · 연령별 수면 안내</a>
      <a href="https://www.nichd.nih.gov/health/topics/sleep/conditioninfo/how-much" target="_blank" rel="noreferrer" className="block text-blue-300 underline">NIH · 신생아 포함 연령별 수면 안내</a>
    </div></details>}
    {mode==='history'&&form&&<CareForm key={form.item.id} {...form} close={()=>setForm(null)} saved={()=>{setNotice('기록했어요. 다음 분석부터 참고해요.');load();changed?.()}}/>}
  </div>
}
