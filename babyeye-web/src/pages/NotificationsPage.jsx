import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, RefreshCw } from 'lucide-react'
import { apiGet } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import NotificationSettings from '../components/common/NotificationSettings'

export default function NotificationsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const generation = useRef(0)
  const load = useCallback(async (offset = 0) => {
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const data = await apiGet(`/api/push/events?limit=20&offset=${offset}`)
      if (request !== generation.current) return
      setItems(current => offset ? [...current, ...data.items.filter(row => !current.some(item => item.id === row.id))] : data.items)
      setUnread(data.unreadCount)
      setMore(data.items.length === 20)
    } catch (err) {
      if (request === generation.current) setError(err.status === 404 ? '서버에 새 알림 목록 기능을 먼저 적용해주세요.' : '알림을 불러오지 못했습니다. 다시 시도해주세요.')
    } finally { if (request === generation.current) setLoading(false) }
  }, [user?.id])
  useEffect(() => {
    setItems([])
    load()
    const refresh = () => load()
    const timer = setInterval(() => { if (!document.hidden) load() }, 30000)
    window.addEventListener('babyeye:notifications', refresh)
    return () => { generation.current++; clearInterval(timer); window.removeEventListener('babyeye:notifications', refresh) }
  }, [load])
  return <main className="space-y-5 px-5 py-6">
    <header className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">알림</h1><p className="mt-1 text-sm text-slate-400">아기의 상태 변화를 확인하세요.</p></div><Bell className="text-blue-300" /></header>
    <NotificationSettings />
    <Link to="/reviews" className="block rounded-2xl border border-blue-400/30 bg-blue-500/10 p-4"><strong>지난 12시간 돌아보기 →</strong><p className="mt-1 text-sm text-slate-300">상황을 모아 보고 실제 상태를 알려주세요. 정기 알림도 설정할 수 있어요.</p></Link>
    <section aria-label="알림 목록" className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-bold">최근 알림 <span className="ml-2 text-sm text-blue-300">미확인 {unread}</span></h2>
        <button aria-label="알림 새로고침" disabled={loading} onClick={() => load()} className="rounded-lg bg-slate-800 p-2 disabled:opacity-50"><RefreshCw size={18} /></button></div>
      {error && <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-300">{error}</p>}
      {loading && items.length === 0 && <p role="status" className="py-8 text-center text-slate-400">알림을 불러오는 중…</p>}
      {!loading && !error && items.length === 0 && <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center"><Bell className="mx-auto mb-3 text-slate-500" /><p>아직 도착한 알림이 없어요.</p><p className="mt-2 text-sm text-slate-400">알림을 켜면 동일 상태 3회 연속 감지 시 여기에 표시돼요.</p></div>}
      {items.map(item => <Link key={item.id} to={`/notifications/${item.id}`} className={`block rounded-2xl border p-4 ${item.readAt ? 'border-slate-800 bg-slate-900' : 'border-blue-400/30 bg-blue-500/10'}`}>
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{item.result.kind === 'review' ? '지난 12시간 돌아보기' : `${item.result.emotion || '상태 변화'} 감지`}</h3><span className={`text-xs ${item.readAt ? 'text-slate-500' : 'text-blue-300'}`}>{item.readAt ? '확인 완료' : '미확인'}</span></div>
        <p className="mt-2 text-sm text-slate-300">{item.result.message || (item.result.consecutiveCount === 3 ? '동일 상태가 3번 연속 감지되었어요.' : '분석 결과를 확인해주세요.')}</p>
        <p className="mt-3 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString('ko-KR')}</p>
      </Link>)}
      {more && <button disabled={loading} onClick={() => load(items.length)} className="w-full rounded-xl bg-slate-800 py-3">{loading ? '불러오는 중…' : '이전 알림 더 보기'}</button>}
    </section>
  </main>
}
