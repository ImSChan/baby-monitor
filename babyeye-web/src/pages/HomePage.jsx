import HomeLiveCard from '../components/home/HomeLiveCard'
import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '../components/common/Header'
import BabyStatusOverview from '../components/home/BabyStatusOverview'
import { getRepresentativeState } from '../api/representativeApi'
import { getLiveSessions } from '../api/liveApi'
import { getAccessToken } from '../api/authToken'
import { useAuth } from '../contexts/AuthContext'
import { registerLiveCleanup } from '../services/liveResources'

export default function HomePage() {
  const { user } = useAuth()
  return <HomeContent key={user?.id} />
}

function HomeContent() {
  const pageEpochRef = useRef(0)
  const requestRef = useRef(0)
  const overviewAbortRef = useRef(null)
  const [representativeData, setRepresentativeData] = useState(null)
  const [liveSessions, setLiveSessions] = useState([])
  const [liveLoading,setLiveLoading]=useState(true),[liveCheckedAt,setLiveCheckedAt]=useState(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [errors, setErrors] = useState({})

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    overviewAbortRef.current?.abort()
    const controller = new AbortController(), request = ++requestRef.current
    overviewAbortRef.current = controller
    const epoch = pageEpochRef.current, token = getAccessToken()
    if (!silent) setLiveLoading(true)
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
    await loadPart('notification', getRepresentativeState(options), setRepresentativeData)
    if (active()) setInitialLoading(false)
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

  const representative=representativeData

  return <main className="space-y-5 px-5 py-6">
    <Header actionsOnly showSettings />
    <BabyStatusOverview result={representative} loading={initialLoading} unavailable={errors.notification} />
    {errors.notification && <p role="alert" className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">대표 상태를 갱신하지 못했어요. 표시된 시각을 확인해 주세요.<button onClick={() => loadOverview()} className="ml-2 underline">다시 시도</button></p>}

    <HomeLiveCard sessions={liveSessions} loading={liveLoading} error={errors.live} checkedAt={liveCheckedAt} onRefresh={()=>loadOverview()}/>


  </main>
}
