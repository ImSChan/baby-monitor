import TrainingStatusCard from '../components/status/TrainingStatusCard'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Camera, ChevronDown, RefreshCw, Upload, Video } from 'lucide-react'
import Header from '../components/common/Header'
import BabyStatusOverview from '../components/home/BabyStatusOverview'
import { getDashboard } from '../api/dashboardApi'
import { getEmotionHistory } from '../api/emotionApi'
import { getLiveSessions } from '../api/liveApi'
import { getInferenceResult, getInferenceStatus, requestMultimodalInference } from '../api/inferenceApi'
import { getAccessToken } from '../api/authToken'
import { useAuth } from '../contexts/AuthContext'
import { registerLiveCleanup } from '../services/liveResources'
import { abortableDelay, throwIfAborted } from '../utils/abort'
import { preprocessVideoForInference } from '../utils/videoPreprocess'
import { analysisDate, analysisTime, babyStatus, distribution, formatAnalysisTime, score } from '../utils/babyStatus'
import { localInput } from '../utils/careTime'

export default function HomePage() {
  const { user } = useAuth()
  return <HomeContent key={user?.id} />
}

function HomeContent() {
  const fileInputRef = useRef(null)
  const pageEpochRef = useRef(0)
  const requestRef = useRef(0)
  const overviewAbortRef = useRef(null)
  const uploadAbortRef = useRef(null)
  const [dashboardData, setDashboardData] = useState(null)
  const [history, setHistory] = useState([])
  const [liveSessions, setLiveSessions] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errors, setErrors] = useState({})
  const [expanded, setExpanded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [videoCapturedAt, setVideoCapturedAt] = useState('')

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    overviewAbortRef.current?.abort()
    const controller = new AbortController(), request = ++requestRef.current
    overviewAbortRef.current = controller
    const epoch = pageEpochRef.current, token = getAccessToken()
    if (!silent) setRefreshing(true)
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
    loadPart('live', getLiveSessions(options), value => setLiveSessions(Array.isArray(value) ? value : []))
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
    const unregister = registerLiveCleanup(() => { uploadAbortRef.current?.abort(); overviewAbortRef.current?.abort() })
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('babyeye:notifications', refresh)
    return () => {
      pageEpochRef.current++; overviewAbortRef.current?.abort(); uploadAbortRef.current?.abort()
      unregister(); window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('babyeye:notifications', refresh)
    }
  }, [loadOverview])

  async function handleVideoSelected(event) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    uploadAbortRef.current?.abort()
    const controller = new AbortController(), token = getAccessToken()
    uploadAbortRef.current = controller
    const signal = controller.signal
    try {
      setUploading(true)
      setUploadMessage('분석할 영상을 준비하고 있어요.')
      setUploadError('')
      setAnalysisResult(null)

      const preprocessed = await preprocessVideoForInference(file, {
        framesPerSecond: 1,
        maxFrames: 20,
        maxWidth: 640,
        onProgress: message => { if (!signal.aborted) setUploadMessage('분석할 영상을 준비하고 있어요.') },
      })

      throwIfAborted(signal)
      if (token !== getAccessToken()) return
      if (preprocessed.frameFiles.length === 0 && !preprocessed.audioFile) {
        throw new Error('이 영상에서 분석할 자료를 준비하지 못했어요. 다른 영상으로 시도해주세요.')
      }

      setUploadMessage('준비한 영상을 분석 서버에 보내고 있어요.')

      const queued = await requestMultimodalInference({
        audioFile: preprocessed.audioFile,
        frameFiles: preprocessed.frameFiles,
        capturedAt: videoCapturedAt ? new Date(videoCapturedAt).toISOString() : new Date().toISOString(),
        careContextAllowed: Boolean(videoCapturedAt),
        frameRate: preprocessed.frameRate,
        durationSeconds: preprocessed.durationSeconds,
        audioRmsDbfs: preprocessed.audioMetrics?.rmsDbfs,
        audioPeakDbfs: preprocessed.audioMetrics?.peakDbfs,
        quietAudio: preprocessed.audioMetrics?.quietAudio,
        signal,
      })

      throwIfAborted(signal)
      const requestId = queued.requestId

      if (!requestId) {
        throw new Error('분석 요청을 확인할 수 없어요. 다시 시도해주세요.')
      }

      setUploadMessage('분석을 기다리고 있어요.')

      const completedResult = await waitForInferenceCompleted(requestId, {
        signal,
        onProgress: message => { if (!signal.aborted) setUploadMessage(message) },
      })

      throwIfAborted(signal)
      setAnalysisResult({
        ...completedResult.result,
        analyzedAt: new Date().toISOString(),
        requestId,
        saved: completedResult.saved,
      })

      setUploadMessage('분석이 완료됐어요. 맨 위에서 결과를 확인해 주세요.')
      await loadOverview({ silent: true })
    } catch (err) {
      if (!signal.aborted) { setUploadError(err.message || '영상 분석 요청 중 오류가 발생했습니다.'); setUploadMessage('') }
    } finally {
      if (uploadAbortRef.current === controller) {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
  }

  const latest = [dashboardData?.currentEmotion, history[0], analysisResult].filter(Boolean)
    .sort((a, b) => (analysisDate(analysisTime(b))?.getTime() || 0) - (analysisDate(analysisTime(a))?.getTime() || 0))[0]
  const breakdown = distribution(history)
  const shown = expanded ? history : history.slice(0, 4)

  return <main className="space-y-5 px-5 py-6">
    <Header title="아기 상태" subtitle="아이에게 필요한 것을 한눈에" showSettings />
    <BabyStatusOverview result={latest} loading={initialLoading} unavailable={errors.dashboard && errors.history} />
    {errors.dashboard && <p role="alert" className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">최신 상태를 갱신하지 못했어요. 표시된 분석 시각을 확인해 주세요.<button onClick={() => loadOverview()} className="ml-2 underline">다시 시도</button></p>}

    <TrainingStatusCard />
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

    <Link to="/reviews" className="flex items-center justify-between gap-3 rounded-2xl border border-blue-300/15 bg-blue-400/5 p-4"><div><p className="text-sm font-semibold text-blue-200">지난 12시간 돌아보기</p><p className="mt-1 text-xs leading-5 text-slate-400">알림이 왔던 상황을 모아 보고 실제 상태를 알려주세요.</p></div><ArrowRight size={18} className="shrink-0 text-blue-300" /></Link>

    <section aria-label="라이브 확인" className="rounded-3xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-slate-800 p-3 text-blue-200"><Camera size={21} /></div><div><h2 className="font-bold">직접 모습 확인하기</h2><p className="mt-1 text-xs text-slate-400">{errors.live ? '연결 상태를 확인하지 못했어요' : liveSessions.length ? `연결 가능한 홈캠 ${liveSessions.length}개` : '현재 연결된 홈캠이 없어요'}</p></div></div>
      <div className="mt-4 grid grid-cols-2 gap-2"><Link to="/live" className="rounded-xl bg-slate-800 py-3 text-center text-sm font-semibold">라이브 보기</Link><Link to="/camera-host" className="rounded-xl border border-slate-700 py-3 text-center text-sm text-slate-300">홈캠 시작</Link></div>
    </section>

    <section aria-label="영상으로 분석하기" className="rounded-3xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="flex items-center gap-2"><Video size={18} className="text-blue-300" /><h2 className="font-bold">영상으로 분석하기</h2></div>
      <p className="mt-2 text-sm leading-6 text-slate-400">저장된 영상으로도 아이의 상태를 확인할 수 있어요.</p>
      <label className="mt-3 block text-xs text-slate-300">촬영 날짜와 시각 · 선택<input aria-label="영상 촬영 시각" type="datetime-local" max={localInput()} disabled={uploading} value={videoCapturedAt} onChange={e=>setVideoCapturedAt(e.target.value)} className="mt-2 w-full min-w-0 rounded-xl bg-slate-800 p-3"/></label>
      <p className="mt-2 text-[11px] leading-5 text-slate-500">시각을 입력하면 당시 육아 기록을 참고해요. 모르면 비워두세요.</p>
      <input ref={fileInputRef} type="file" aria-label="분석할 영상 선택" accept="video/*" className="hidden" onChange={handleVideoSelected} />
      <button disabled={uploading} onClick={() => fileInputRef.current?.click()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold disabled:opacity-40"><Upload size={16} />{uploading ? '영상 분석 중…' : '영상 선택하여 분석'}</button>
      {uploadMessage && <p role="status" className="mt-3 text-sm leading-6 text-blue-200">{uploadMessage}</p>}
      {uploadError && <p role="alert" className="mt-3 text-sm text-red-300">{uploadError}</p>}
      {analysisResult && <a href="#baby-status" className="mt-3 block text-sm text-blue-300 underline">맨 위에서 분석 결과 보기 ↑</a>}
    </section>
  </main>
}

async function waitForInferenceCompleted(requestId, options = {}) {
  const onProgress = options.onProgress || (() => {})
  const signal = options.signal
  const maxAttempts = options.maxAttempts || 60
  const intervalMs = options.intervalMs || 2000

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(signal)
    const status = await getInferenceStatus(requestId, { signal })

    if (status.status === 'completed') {
      onProgress('분석 결과를 불러오고 있어요.')
      return getInferenceResult(requestId, { signal })
    }

    if (status.status === 'failed') {
      throw new Error(status.message || '분석 작업이 실패했습니다.')
    }

    if (status.status === 'processing') {
      onProgress('아이의 상태를 분석하고 있어요.')
    } else {
      onProgress('분석을 기다리고 있어요.')
    }

    await abortableDelay(intervalMs, signal)
  }

  throw new Error('분석 작업 시간이 초과되었습니다.')
}
