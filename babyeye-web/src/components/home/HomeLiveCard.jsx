import { Link } from 'react-router-dom'
import { ArrowUpRight, Camera, RefreshCw, Video, Wifi, WifiOff } from 'lucide-react'

export const liveSessionPath=session=>'/live?session='+encodeURIComponent(session.sessionId)

export default function HomeLiveCard({ sessions=[],loading=false,error=false,checkedAt,onRefresh }) {
  const available=error?[]:sessions.filter(session=>session.sessionId)
  const pending=loading&&!checkedAt
  const title=error?'연결 확인 필요':pending?'홈캠을 찾고 있어요':available.length?'온라인 홈캠 '+available.length+'대':'홈캠을 연결해 주세요'
  const iconColor=error?'text-amber-200':available.length?'text-emerald-300':'text-slate-400'
  return <section aria-label="라이브 확인" className="overflow-hidden rounded-3xl border border-slate-700/80 bg-[#131D2D] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Video size={20} className="text-blue-200"/><h2 className="font-bold">홈캠 라이브</h2></div>
      <button type="button" aria-label="홈캠 연결 새로고침" disabled={loading} onClick={onRefresh} className="rounded-xl border border-slate-600/60 bg-slate-800 p-2.5 text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"><RefreshCw size={16} className={loading?'animate-spin':''}/></button></div>
    <div className="mt-4 flex items-start gap-3"><span className={iconColor}>{available.length?<Wifi size={22}/>:<WifiOff size={22}/>}</span><div><p role="status" className={'font-semibold '+iconColor}>{title}</p>
      <p className="mt-2 break-keep text-xs leading-5 text-slate-400">{error?'연결 상태를 확인하지 못했어요. 새로고침해 주세요.':pending?'같은 계정으로 켜 둔 홈캠을 확인하고 있어요.':available.length?'같은 계정의 홈캠을 선택해 주세요.':'촬영할 기기에서 같은 계정으로 홈캠을 시작해 주세요.'}</p></div></div>
    {available.length>0&&<ul className="mt-4 space-y-2">{available.map(session=><li key={session.sessionId}><Link to={liveSessionPath(session)} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-emerald-300/10 bg-black/15 px-3 py-3"><span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-400"/><span className="truncate text-sm">{session.cameraName||'휴대폰 홈캠'}</span></span><span className="flex shrink-0 items-center gap-1 text-xs text-emerald-200">보기<ArrowUpRight size={14}/></span></Link></li>)}</ul>}
    <div className="mt-4 grid grid-cols-2 gap-2"><Link to={available.length===1?liveSessionPath(available[0]):'/live'} className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-300/30 bg-[#294568] px-2 py-3.5 text-sm font-semibold text-blue-100 shadow-[0_2px_0_#14283F] transition hover:bg-[#34577F] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"><Video size={16}/>라이브 보기</Link><Link to="/camera-host" className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-500/70 bg-slate-800 px-2 py-3.5 text-sm font-semibold text-slate-200 shadow-[0_2px_0_#0B1220] transition hover:bg-slate-700 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"><Camera size={16}/>홈캠 시작</Link></div>
    {checkedAt&&<p className="mt-2 text-[10px] text-slate-500">마지막 연결 확인 · {new Date(checkedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</p>}
  </section>
}
