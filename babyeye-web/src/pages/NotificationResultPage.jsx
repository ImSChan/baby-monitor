import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiGet } from '../api/client'
import { FeedbackCard } from './FeedbackPage'
import { useAuth } from '../contexts/AuthContext'

export default function NotificationResultPage() {
  const { eventId } = useParams()
  const { user, expireSession } = useAuth()
  const navigate = useNavigate()
  const [event, setEvent] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const data = await apiGet(`/api/push/events/${encodeURIComponent(eventId)}`)
    setEvent(data)
  }, [eventId])
  useEffect(() => {
    let active = true
    setEvent(null)
    setError('')
    apiGet(`/api/push/events/${encodeURIComponent(eventId)}`).then(data => {
      if (active) setEvent(data)
    }).catch(err => {
      if (!active) return
      if (err.status === 401) {
        expireSession()
        navigate('/login', { replace: true, state: { from: `/notifications/${eventId}` } })
      } else setError(err.status === 404 ? '분석 결과가 없거나 현재 계정으로 볼 수 없습니다.' : '결과를 불러오지 못했습니다. 다시 시도해주세요.')
    })
    return () => { active = false }
  }, [eventId, user?.id, navigate])
  return <main className="p-5 space-y-4">
    <h1 className="text-xl font-bold">알림 분석 결과</h1>
    <Link to="/feedback" className="text-blue-300">전체 피드백 이력</Link>
    {error && <p role="alert">{error}</p>}
    {!error && !event && <p role="status">결과를 불러오는 중...</p>}
    {event && <FeedbackCard key={event.requestId} item={{ ...event.result, requestId: event.requestId }}
      feedback={event.feedback} onSaved={load} />}
  </main>
}
