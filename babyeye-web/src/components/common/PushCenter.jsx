import { Link } from 'react-router-dom'
import { useNotifications } from '../../contexts/NotificationContext'
import { notificationPath } from '../../utils/pushRoute'

export default function PushCenter() {
  const { received, dismiss } = useNotifications()
  if (!received) return null
  return <aside role="status" className="mx-5 mt-4 rounded-2xl border border-blue-400/30 bg-blue-500/15 p-4">
    <p className="font-semibold">새 상태 알림이 도착했어요</p>
    <div className="mt-2 flex justify-between">
      <Link className="text-blue-200" to={notificationPath(received.data) || '/notifications'} onClick={dismiss}>알림 확인</Link>
      <button onClick={dismiss} className="text-slate-400">닫기</button>
    </div>
  </aside>
}
