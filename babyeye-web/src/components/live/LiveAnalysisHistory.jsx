import {useState} from 'react'
import {ChevronDown,RefreshCw} from 'lucide-react'
import {useAuth} from '../../contexts/AuthContext'
import useAccountStatus from '../../hooks/useAccountStatus'
import {analysisTime,babyStatus,distribution,formatAnalysisTime,score} from '../../utils/babyStatus'

export default function LiveAnalysisHistory(){
 const {user}=useAuth()
 return <HistoryContent key={user?.id}/>
}
function HistoryContent(){
 const {data,error,retry}=useAccountStatus('/api/emotions/history',{intervalMs:5000})
 const history=Array.isArray(data)?data.slice(0,20):[]
 const loading=!data&&!error
 const [expanded,setExpanded]=useState(false)
 const breakdown=distribution(history),shown=expanded?history:history.slice(0,4)
 return (
    <section aria-label="실시간 분석 현황" className="mb-5 rounded-3xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between gap-2"><div><h2 className="font-bold">실시간 분석 현황</h2><p className="mt-1 text-xs text-slate-400">{history.length ? `최근 ${history.length}건 기준 · 분석 횟수` : '분석 기록이 쌓이면 흐름을 보여드려요'}</p></div>
        <button aria-label="분석 새로고침" disabled={loading} onClick={retry} className="rounded-xl bg-slate-800 p-2.5 text-slate-300 disabled:opacity-40"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button></div>
      {error && <p role="alert" className="mt-3 text-sm text-amber-200">최근 기록을 갱신하지 못했어요.<button className="ml-2 underline" onClick={retry}>다시 시도</button></p>}
      {breakdown.length > 0 && <>
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">{breakdown.map(item => <div key={item.key} className={item.color} style={{ width: `${item.count / history.length * 100}%` }} />)}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{breakdown.map(item => <span key={item.key} className="flex items-center gap-1.5 text-xs text-slate-300"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${item.color}`} />{item.label}<strong className="tabular-nums text-white">{item.count}</strong></span>)}</div>
      </>}
      <div id="analysis-history" className="mt-5 border-t border-slate-800 pt-4"><h3 className="mb-3 text-sm font-semibold">분석 기록</h3>
        {loading && <p role="status" className="text-sm text-slate-400">기록을 불러오는 중…</p>}
        {!loading && !error && history.length === 0 && <p className="text-sm text-slate-400">아직 분석 기록이 없어요.</p>}
        <ol className="space-y-3">{shown.map(item => {
          const status = babyStatus(item), value = score(item.confidence)
          return <li key={item.id} className="flex items-start gap-3"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-lg">{status.icon}</span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><p className="text-sm font-semibold">{status.label}</p><span className="text-xs tabular-nums text-slate-400">{value === null ? '점수 없음' : `${value}%`}</span></div><p className="mt-1 text-[11px] text-slate-500">{formatAnalysisTime(analysisTime(item))}</p></div></li>
        })}</ol>
        {history.length > 4 && <button onClick={() => setExpanded(v => !v)} className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl bg-slate-800/80 py-2.5 text-xs text-slate-300">{expanded ? '기록 접기' : `분석 기록 ${history.length}건 모두 보기`}<ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button>}
      </div>
      <p className="mt-3 text-[10px] text-slate-500">5초마다 갱신 · 현재 계정의 최근 최대 20건</p>
    </section>
 )
}
