import { useState } from 'react'
import { apiPost } from '../../api/client'

export default function ChildProfileForm({ profile, saved }) {
  const [editing,setEditing]=useState(false),[name,setName]=useState(''),[age,setAge]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  async function submit(e){
    e.preventDefault();setBusy(true);setError('')
    try{await apiPost('/api/care/profile',{child_name:name.trim(),child_age_months:Number(age)});setEditing(false);saved()}
    catch(err){setError(err.status===422?'아이 이름과 월령(0~71개월)을 확인해주세요.':err.message)}finally{setBusy(false)}
  }
  return <section className="rounded-2xl border border-blue-300/15 bg-blue-400/5 p-4">
    <div className="flex flex-col items-start gap-3"><div><h2 className="text-sm font-semibold text-blue-200">{profile?.ageMonths!=null?profile.childName+' · 약 '+profile.ageMonths+'개월 기준으로 참고해요':'아이 정보를 입력해주세요'}</h2><p className="mt-2 text-xs leading-5 text-slate-400">{profile?.ageMonths==null?'월령을 입력하면 다음 분석부터 맞는 성장 단계의 기록을 참고해요.':'입력일 기준 추정 월령이에요. 시간만으로 상태를 단정하지 않아요.'}</p></div>
    <button type="button" onClick={()=>{setName(profile?.childName||'');setAge(profile?.ageMonths??'');setError('');setEditing(true)}} className="shrink-0 text-sm text-blue-300">{profile?.ageMonths!=null?'아이 정보 수정':'아이 정보 입력'}</button></div>
    {editing&&<form onSubmit={submit} className="mt-4"><fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm">아이 이름 (별명)<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} className="mt-2 w-full rounded-lg bg-slate-800 p-3"/></label>
      <label className="block text-sm">현재 월령 (개월)<input required type="number" min={0} max={71} step={1} inputMode="numeric" value={age} onChange={e=>setAge(e.target.value)} className="mt-2 w-full rounded-lg bg-slate-800 p-3"/></label>
      <p className="text-xs text-slate-400">입력한 오늘부터 매달 추정 월령이 늘어나요. 기존 분석은 바뀌지 않아요.</p>
      {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-4"><button className="rounded-xl bg-blue-600 px-4 py-2">{busy?'저장 중…':'아이 정보 저장'}</button><button type="button" onClick={()=>setEditing(false)}>취소</button></div>
    </fieldset></form>}
  </section>
}
