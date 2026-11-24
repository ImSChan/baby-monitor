import HomeLiveCard from '../components/home/HomeLiveCard'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import Header from '../components/common/Header'
import BabyStatusOverview from '../components/home/BabyStatusOverview'
import { getDashboard } from '../api/dashboardApi'
import { getEmotionHistory } from '../api/emotionApi'
import { getLiveSessions } from '../api/liveApi'
import { getAccessToken } from '../api/authToken'
import { useAuth } from '../contexts/AuthContext'
import { registerLiveCleanup } from '../services/liveResources'
import { analysisTime, babyStatus, distribution, formatAnalysisTime, score } from '../utils/babyStatus'

export default function HomePage() {
  const { user } = useAuth()
  return <HomeContent key={user?.id} />
}

function HomeContent() {
  const pageEpochRef = useRef(0)
  const requestRef = useRef(0)
  const overviewAbortRef = useRef(null)
  const [dashboardData, setDashboardData] = useState(null)
  const [history, setHistory] = useState([])
  const [liveSessions, setLiveSessions] = useState([])
  const [liveLoading,setLiveLoading]=useState(true),[liveCheckedAt,setLiveCheckedAt]=useState(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errors, setErrors] = useState({})
  const [expanded, setExpanded] = useState(false)

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    overviewAbortRef.current?.abort()
    const controller = new AbortController(), request = ++requestRef.current
    overviewAbortRef.current = controller
    const epoch = pageEpochRef.current, token = getAccessToken()
    if (!silent) {setRefreshing(true);setLiveLoading(true)}
    const options = { signal: controller.signal }
    const active = () => !controller.signal.aborted && request === requestRef.current && epoch === pageEpochRef.current && token === getAccessToken()
    async function loadPart(key, task, apply) {
      let timer, cancel
      try {
        const value = await Promise.race([task, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('응답 시간이 초과됐어요.')), 10000)
        }), new Promise((_, reject) => {
          cancel = () => reject(new DOMException('화면을 떠났어요.', 'AbortError'))
          controller.signal.addEventListener('abort', cancel, { once: true })
        })])
        if (active()) { apply(value); setErrors(current => ({ ...current, [key]: false })) }
      } catch {
        if (active()) setErrors(current => ({ ...current, [key]: true }))
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancel) }
    }
    // Live availability must never hold up the baby's analysis summary.
    loadPart('live', getLiveSessions(options), value => {setLiveSessions(Array.isArray(value) ? value : []);setLiveCheckedAt(Date.now())})
      .finally(()=>{if(active())setLiveLoading(false)})
    await Promise.all([
      loadPart('dashboard', getDashboard(options), setDashboardData),
      loadPart('history', getEmotionHistory(options), value => setHistory(Array.isArray(value) ? value : [])),
    ])
    if (active()) { setInitialLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => {
    pageEpochRef.current++
    loadOverview()
    const refresh = () => { if (!document.hidden) loadOverview({ silent: true }) }
    const timer = window.setInterval(refresh, 15000)
    const unregister = registerLiveCleanup(() => { overviewAbortRef.current?.abort() })
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('babyeye:notifications', refresh)
    return () => {
      pageEpochRef.current++; overviewAbortRef.current?.abort()
      unregister(); window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('babyeye:notifications', refresh)
    }
  }, [loadOverview])

  const confirmed=dashboardData?.confirmedEmotion || null
  const confirmedUnavailable=errors.dashboard || Boolean(dashboardData&&!Object.prototype.hasOwnProperty.call(dashboardData,'confirmedEmotion'))
  const breakdown = distribution(history)
  const shown = expanded ? history : history.slice(0, 4)

  return <main className="space-y-5 px-5 py-6">
    <Header actionsOnly showSettings />
    <BabyStatusOverview result={confirmed} loading={initialLoading} unavailable={confirmedUnavailable} />
    {errors.dashboard && <p role="alert" className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">최신 상태를 갱신하지 못했어요. 표시된 분석 시각을 확인해 주세요.<button onClick={() => loadOverview()} className="ml-2 underline">다시 시도</button></p>}

    <HomeLiveCard sessions={liveSessions} loading={liveLoading} error={errors.live} checkedAt={liveCheckedAt} onRefresh={()=>loadOverview()}/>
    <section aria-label="최근 분석 흐름" className="rounded-3xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between gap-2"><div><h2 className="font-bold">최근 분석 흐름</h2><p className="mt-1 text-xs text-slate-400">{history.length ? `최근 ${history.length}건 기준 · 분석 횟수` : '분석 기록이 쌓이면 흐름을 보여드려요'}</p></div>
        <button aria-label="분석 새로고침" disabled={refreshing} onClick={() => loadOverview()} className="rounded-xl bg-slate-800 p-2.5 text-slate-300 disabled:opacity-40"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button></div>
      {errors.history && <p role="alert" className="mt-3 text-sm text-amber-200">최근 기록을 갱신하지 못했어요.<button className="ml-2 underline" onClick={() => loadOverview()}>다시 시도</button></p>}
      {breakdown.length > 0 && <>
        <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">{breakdown.map(item => <div key={item.key} className={item.color} style={{ width: `${item.count / history.length * 100}%` }} />)}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{breakdown.map(item => <span key={item.key} className="flex items-center gap-1.5 text-xs text-slate-300"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${item.color}`} />{item.label}<strong className="tabular-nums text-white">{item.count}</strong></span>)}</div>
      </>}
      <div id="analysis-history" className="mt-5 border-t border-slate-800 pt-4"><h3 className="mb-3 text-sm font-semibold">분석 기록</h3>
        {initialLoading && <p role="status" className="text-sm text-slate-400">기록을 불러오는 중…</p>}
        {!initialLoading && !errors.history && history.length === 0 && <p className="text-sm text-slate-400">아직 분석 기록이 없어요.</p>}
        <ol className="space-y-3">{shown.map(item => {
          const status = babyStatus(item), value = score(item.confidence)
          return <li key={item.id} className="flex items-start gap-3"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-lg">{status.icon}</span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><p className="text-sm font-semibold">{status.label}</p><span className="text-xs tabular-nums text-slate-400">{value === null ? '점수 없음' : `${value}%`}</span></div><p className="mt-1 text-[11px] text-slate-500">{formatAnalysisTime(analysisTime(item))}</p></div></li>
        })}</ol>
        {history.length > 4 && <button onClick={() => setExpanded(v => !v)} className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl bg-slate-800/80 py-2.5 text-xs text-slate-300">{expanded ? '기록 접기' : `분석 기록 ${history.length}건 모두 보기`}<ChevronDown size={14} className={expanded ? 'rotate-180' : ''} /></button>}
      </div>
    </section>

  </main>
}
