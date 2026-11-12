import { useEffect, useRef, useState } from 'react'
import { apiGet, apiPost, getApiBaseUrl } from '../../api/client'
import { getAccessToken } from '../../api/authToken'
import { useAuth } from '../../contexts/AuthContext'

export const STATES = [['feeding', '배고팠어요'], ['sleep', '졸렸어요'], ['care', '돌봄이 필요했어요'], ['stable', '편안했어요'], ['uncertain', '잘 모르겠어요']]
export const timeText = value => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const button = 'rounded-xl border border-slate-600 px-3 py-3 text-sm disabled:opacity-40'

function RecordedMedia({ item }) {
  const [media, setMedia] = useState({})
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const urls = []
    setMedia({}); setError('')
    const token = getAccessToken()
    async function load(kind, endpoint) {
      try {
        const response = await fetch(`${getApiBaseUrl()}/api/inference/requests/${item.requestId}/${endpoint}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        })
        if (!response.ok) throw new Error()
        const blob = await response.blob()
        if (controller.signal.aborted) return
        const url = URL.createObjectURL(blob); urls.push(url)
        setMedia(current => ({ ...current, [kind]: url }))
      } catch { if (!controller.signal.aborted) setError('당시 자료를 불러오지 못했어요.') }
    }
    if (item.hasFrame) load('frame', 'last-frame')
    if (item.hasAudio) load('audio', 'audio')
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [item.requestId, item.hasFrame, item.hasAudio])
  return <div className="space-y-2">
    {media.frame && <img src={media.frame} alt="선택한 분석 시점의 아기 모습" className="max-h-56 w-full rounded-xl object-contain" />}
    {media.audio && <audio controls src={media.audio} className="w-full" aria-label="선택한 분석 시점의 소리" />}
    {!item.hasFrame && !item.hasAudio && <p className="text-sm text-slate-400">당시 장면·소리 자료가 없습니다.</p>}
    {error && <p role="status" className="text-sm text-amber-200">{error}</p>}
  </div>
}

export default function ReviewEditor({ eventId, onSaved }) {
  const { user } = useAuth()
  const [context, setContext] = useState(null)
  const [selected, setSelected] = useState(0)
  const [range, setRange] = useState(false)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [undo, setUndo] = useState(null)
  const [reload, setReload] = useState(0)
  const epoch = useRef(0)
  const timeline = useRef(null)
  useEffect(() => {
    const rail = timeline.current, tile = rail?.children[selected]
    if (tile) rail.scrollTo?.({ left: rail.scrollLeft + tile.getBoundingClientRect().left - rail.getBoundingClientRect().left - (rail.clientWidth - tile.clientWidth) / 2, behavior: 'smooth' })
  }, [selected, context?.items.length])
  useEffect(() => {
    const generation = ++epoch.current
    const controller = new AbortController()
    setContext(null); setError(''); setBusy(false); setLabel(''); setRange(false)
    setUndo(null); setSuccess('')
    apiGet(`/api/reviews/events/${eventId}/context`, { signal: controller.signal }).then(data => {
      if (generation !== epoch.current) return
      const index = data.items.findIndex(item => item.requestId === data.anchorRequestId)
      setContext(data); setSelected(index); setStart(index); setEnd(index)
    }).catch(err => { if (generation === epoch.current) setError(err.message) })
    return () => { epoch.current++; controller.abort() }
  }, [eventId, user?.id, reload])

  async function refresh(generation) {
    const data = await apiGet(`/api/reviews/events/${eventId}/context`)
    if (generation === epoch.current) setContext(data)
  }
  async function save(value) {
    if (busy || !context) return
    const generation = epoch.current
    const rows = range ? context.items.slice(Math.min(start, end), Math.max(start, end) + 1) : [context.items[selected]]
    setBusy(true); setError(''); setSuccess('')
    try {
      const result = await apiPost('/api/reviews/feedback', {
        action_id: crypto.randomUUID(), event_id: Number(eventId),
        request_ids: rows.map(row => row.requestId), label: value,
        expected_versions: Object.fromEntries(rows.map(row => [row.requestId, row.feedback?.updated_at || null])),
      })
      if (generation !== epoch.current) return
      setUndo(result.actionId); setSuccess(`${result.count}개 분석에 반영했어요.`); setLabel('')
      onSaved?.(); window.dispatchEvent(new Event('babyeye:notifications'))
      await refresh(generation)
    } catch (err) { if (generation === epoch.current) setError(err.message || '저장하지 못했어요. 다시 시도해주세요.') }
    finally { if (generation === epoch.current) setBusy(false) }
  }
  async function undoLast() {
    const generation = epoch.current
    setBusy(true); setError('')
    try {
      await apiPost(`/api/reviews/feedback/${undo}/undo`, {})
      if (generation !== epoch.current) return
      setUndo(null); setSuccess('이전 응답으로 되돌렸어요.'); onSaved?.()
      await refresh(generation)
    } catch (err) { if (generation === epoch.current) setError(err.message) }
    finally { if (generation === epoch.current) setBusy(false) }
  }
  const item = context?.items[selected]
  const rows = context ? (range ? context.items.slice(Math.min(start, end), Math.max(start, end) + 1) : [item]) : []
  const locked = rows.some(row => !row.available || (row.feedback && !['pending', 'excluded'].includes(row.feedback.training_status)))
  const overwrite = rows.filter(row => row.feedback).length
  return <section aria-label="당시 상태 피드백" className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-4">
    <h2 className="font-bold">당시 아기는 어떤 상태였나요?</h2>
    <p className="text-sm text-slate-400">기억나는 상황만 알려주세요. 알림 확인만으로는 학습에 반영되지 않아요.</p>
    {error && <div role="alert" className="text-sm text-red-300">{error}<button className="ml-3 underline" onClick={() => setReload(v => v + 1)}>새로고침</button></div>}
    {!context && !error && <p role="status">앞뒤 분석을 불러오는 중…</p>}
    {item && <>
      <p className="text-xs text-slate-400">알림 앞뒤 최대 10개씩 · 같은 카메라의 기록</p>
      <div ref={timeline} className="flex snap-x gap-2 overflow-x-auto pb-3" aria-label="분석 타임라인">
        {context.items.map((row, i) => <button key={row.requestId} disabled={busy} aria-pressed={selected === i}
          onClick={event => { setSelected(i); setLabel(''); event.currentTarget.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' }) }}
          className={`min-w-28 snap-center rounded-xl border p-3 text-xs ${selected === i ? 'border-blue-300 bg-blue-500/20' : range && i >= Math.min(start, end) && i <= Math.max(start, end) ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-700'}`}>
          <span className="block">{timeText(row.capturedAt)}</span><span className="mt-1 block">{row.result.emotion}</span>
          {row.requestId === context.anchorRequestId && <span className="block text-blue-300">알림 시점</span>}
          {row.feedback && <span className="block text-emerald-300">응답 완료</span>}
        </button>)}
      </div>
      <input aria-label="분석 시점 이동" type="range" min="0" max={context.items.length - 1} value={selected} disabled={busy}
        onChange={e => { setSelected(Number(e.target.value)); setLabel('') }} className="w-full accent-blue-400" />
      <p className="text-sm">{timeText(item.capturedAt)} · AI 판단: <strong>{item.result.emotion}</strong></p>
      <RecordedMedia key={item.requestId} item={item} />
      <button className={button} disabled={busy} aria-pressed={range} onClick={() => { setRange(v => !v); setStart(selected); setEnd(selected); setLabel('') }}>{range ? '한 시점만 선택' : '구간 선택하여 일괄 응답'}</button>
      {range && <div className="space-y-2 rounded-xl bg-slate-800 p-3">
        <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => setStart(selected)}>여기부터</button><button className={button} disabled={busy} onClick={() => setEnd(selected)}>여기까지</button></div>
        <p className="text-sm">{timeText(rows[0].capturedAt)} ~ {timeText(rows.at(-1).capturedAt)} · {rows.length}개 선택</p>
        {overwrite > 0 && <p className="text-sm text-amber-200">기존 응답 {overwrite}개를 변경합니다.</p>}
      </div>}
      {item.feedback && <p className="text-sm text-emerald-300">기존 응답: {item.feedback.feedback_type === 'uncertain' ? '잘 모르겠어요' : STATES.find(([key]) => key === item.feedback.corrected_label)?.[1] || item.feedback.corrected_label}</p>}
      {locked && <p className="text-sm text-amber-200">선택 구간에 자료가 없거나 학습 중·반영 완료인 응답이 있어 수정할 수 없어요.</p>}
      <div className="grid grid-cols-2 gap-2">{STATES.map(([value, text]) => <button key={value} disabled={busy || locked} aria-pressed={label === value}
        className={`${button} ${label === value ? 'bg-blue-600' : 'bg-slate-800'}`} onClick={() => range ? setLabel(value) : save(value)}>{text}</button>)}</div>
      {range && <button disabled={busy || locked || !label} onClick={() => save(label)} className="w-full rounded-xl bg-blue-600 py-3 font-semibold disabled:opacity-40">선택한 {rows.length}개에 적용</button>}
      {busy && <p role="status">저장 중…</p>}
    </>}
    {success && <div role="status" className="text-sm text-emerald-300">{success} {undo && <button disabled={busy} onClick={undoLast} className="ml-2 underline">실행 취소</button>}</div>}
  </section>
}
