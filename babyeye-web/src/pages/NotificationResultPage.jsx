import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { apiGet, apiPost } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import ReviewEditor from '../components/review/ReviewEditor'

export default function NotificationResultPage() {
  const { eventId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [event, setEvent] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setEvent(null); setError('')
    apiGet(`/api/push/events/${encodeURIComponent(eventId)}`).then(data => {
      if (active) setEvent(data)
    }).catch(err => {
      if (active) setError(err.status === 404 ? '알림이 없거나 현재 계정으로 볼 수 없습니다.' : '알림을 불러오지 못했습니다.')
    })
    return () => { active = false }
  }, [eventId, user?.id, attempt])
  async function confirm() {
    setSaving(true); setError('')
    try {
      await apiPost(`/api/push/events/${encodeURIComponent(eventId)}/read`, {})
      window.dispatchEvent(new Event('babyeye:notifications'))
      navigate('/notifications')
    } catch { setError('확인 상태를 저장하지 못했습니다. 다시 눌러주세요.') }
    finally { setSaving(false) }
  }
  return <main className="space-y-5 px-5 py-6">
    <Link to="/notifications" className="text-sm text-blue-300">← 알림 목록</Link>
    <h1 className="text-2xl font-bold">상태 알림 확인</h1>
    {error && <div><p role="alert" className="text-red-300">{error}</p>{!event && <button onClick={() => setAttempt(value => value + 1)} className="mt-3 text-blue-300">다시 시도</button>}</div>}
    {!error && !event && <p role="status">알림을 불러오는 중…</p>}
    {event && <article className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{new Date(event.createdAt).toLocaleString('ko-KR')}</p>
      <h2 className="mt-3 text-2xl font-bold">{event.result.emotion}</h2>
      {event.result.consecutiveCount === 3 && <p className="mt-2 text-sm text-blue-200">같은 상태가 3번 연속 감지되었어요.</p>}
      <p className="mt-4 leading-7 text-slate-300">{event.result.message || '아기의 상태를 확인해주세요.'}</p>
      {event.readAt && <p className="mt-4 text-sm text-emerald-300">확인한 알림입니다.</p>}
      {event.result.kind === 'review' && <Link to={`/reviews?end=${encodeURIComponent(event.result.windowEnd)}`} className="mt-4 block rounded-xl bg-blue-600 p-3 text-center">이 시간의 상황 돌아보기</Link>}
      <button disabled={saving} onClick={confirm} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 py-3 font-semibold disabled:opacity-50"><CheckCircle2 size={18} />{saving ? '저장 중…' : '알림 확인 완료'}</button>
    </article>}
    {event && event.result.kind !== 'review' && event.result.consecutiveCount === 3 && <ReviewEditor key={`${user?.id}:${eventId}`} eventId={eventId} />}
  </main>
}
