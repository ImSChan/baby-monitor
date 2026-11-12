import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiGet, apiPost } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import ReviewEditor, { timeText } from '../components/review/ReviewEditor'

export function ReviewScheduleSettings() {
  const { user } = useAuth()
  const [schedule, setSchedule] = useState(null)
  const [first, setFirst] = useState('10:00')
  const [zone, setZone] = useState('Asia/Seoul')
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    setSchedule(null)
    apiGet('/api/reviews/schedule').then(data => {
      if (!active) return
      setSchedule(data); setFirst(data.firstTime); setZone(data.timezone); setEnabled(data.enabled)
    }).catch(() => { if (active) setError('돌아보기 설정은 서버 업데이트 후 사용할 수 있어요.') })
    return () => { active = false }
  }, [user?.id])
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const data = await apiPost('/api/reviews/schedule', { enabled, first_time: first, timezone: zone })
      setSchedule(data); setMessage('돌아보기 알림 설정을 저장했어요.')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const second = first ? `${String((Number(first.split(':')[0]) + 12) % 24).padStart(2, '0')}:${first.split(':')[1]}` : '--:--'
  return <form onSubmit={save} aria-label="돌아보기 알림 설정" className="space-y-3 rounded-2xl border border-slate-700 p-4">
    <h2 className="font-bold">하루 두 번 돌아보기 알림</h2>
    <p className="text-sm text-slate-400">상태 알림과 기기 푸시를 켠 경우에만 보내요. 확인할 상황이 없으면 보내지 않아요.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {schedule && <>
      <label className="flex items-center gap-3"><input type="checkbox" checked={enabled} disabled={busy} onChange={e => setEnabled(e.target.checked)} />돌아보기 알림 받기</label>
      <label className="block text-sm">첫 알림 시간 <input aria-label="첫 알림 시간" type="time" required value={first} disabled={busy} onChange={e => setFirst(e.target.value)} className="ml-2 rounded bg-slate-800 p-2" /></label>
      <p className="text-sm text-slate-300">두 번째 알림: {second} · 각 알림은 직전 12시간을 정리해요.</p>
      <label className="block text-sm">시간대 <input aria-label="알림 시간대" required value={zone} disabled={busy} onChange={e => setZone(e.target.value)} className="mt-1 w-full rounded bg-slate-800 p-2" /></label>
      <button type="button" disabled={busy} onClick={() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)} className="text-sm text-blue-300">현재 기기 시간대 사용</button>
      <button disabled={busy} className="block w-full rounded-xl bg-slate-800 py-3">{busy ? '저장 중…' : '알림 설정 저장'}</button>
    </>}
    {message && <p role="status" className="text-sm text-emerald-300">{message}</p>}
  </form>
}

export default function ReviewPage() {
  const { user } = useAuth()
  return <ReviewContent key={user?.id} />
}

function ReviewContent() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const end = params.get('end') || ''
  const reminder = params.get('eventId') || ''
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    if (!/^[1-9]\d{0,14}$/.test(reminder)) return
    const controller = new AbortController()
    apiPost(`/api/push/events/${reminder}/read`, {}, { signal: controller.signal })
      .then(() => window.dispatchEvent(new Event('babyeye:notifications'))).catch(() => {})
    return () => controller.abort()
  }, [reminder, user?.id])
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setError(''); setOpen(null)
    apiGet(`/api/reviews?limit=100${end ? `&end=${encodeURIComponent(end)}` : ''}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [end, user?.id, attempt])
  function previous() { setParams({ end: data.windowStart }) }
  return <main className="space-y-5 px-5 py-6">
    <Link to="/notifications" className="text-sm text-blue-300">← 알림 목록</Link>
    <h1 className="text-2xl font-bold">지난 12시간 돌아보기</h1>
    {error && <p role="alert" className="text-red-300">{error}<button className="ml-2 underline" onClick={() => setAttempt(v => v + 1)}>다시 시도</button></p>}
    {!data && !error && <p role="status">상황을 모으는 중…</p>}
    {data && <>
      <p className="text-sm text-slate-300">{timeText(data.windowStart)} ~ {timeText(data.windowEnd)} · 알림이 발생한 상황 {data.total}개</p>
      <p className="text-xs text-slate-400">안정 상태는 제외했어요. 같은 상태가 이어진 알림은 한 사건으로 보여요.</p>
      {data.total === 0 && <p className="rounded-xl bg-slate-900 p-6">이 시간에는 돌아볼 상태 알림이 없어요.</p>}
      {data.items.map(item => <article key={item.id} className="space-y-3 rounded-2xl border border-slate-700 p-4">
        <p className="text-sm text-slate-400">{timeText(item.createdAt)}</p>
        <h2 className="font-bold">{item.result.emotion} 감지</h2>
        <p className="text-sm text-slate-300">{item.result.message || '동일 상태가 3회 연속 감지됐어요.'}</p>
        <button className="rounded-xl bg-blue-600 px-4 py-3 text-sm" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? '접기' : item.feedback ? '응답 완료 · 확인/수정' : '당시 상태 알려주기'}</button>
        {open === item.id && <ReviewEditor eventId={item.id} onSaved={() => {
          apiGet(`/api/push/events/${item.id}`).then(updated => setData(current => current && ({ ...current, items: current.items.map(row => row.id === item.id ? { ...row, feedback: updated.feedback } : row) }))).catch(() => {})
        }} />}
      </article>)}
      {data.total > data.items.length && <p className="text-sm text-amber-200">최근 100개 상황을 표시했어요. 나머지는 알림 목록에서 확인할 수 있어요.</p>}
      <div className="flex justify-between text-sm text-blue-300"><button onClick={previous}>이전 12시간</button><button onClick={() => { setParams({}); setAttempt(v => v + 1) }}>최근 12시간</button></div>
    </>}
    <details className="rounded-2xl border border-slate-700 p-4"><summary className="cursor-pointer font-semibold">정기 돌아보기 알림 설정</summary><div className="mt-4"><ReviewScheduleSettings key={user?.id} /></div></details>
  </main>
}
