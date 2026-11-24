import { Link, useNavigate } from 'react-router-dom'
import { Bell, Settings } from 'lucide-react'
import { useNotifications } from '../../contexts/NotificationContext'

function Header({ title = 'Baby Monitor', subtitle = '실시간 영아 상태 모니터링', showSettings = false }) {
  const unreadCount=useNotifications()?.unreadCount || 0
  const navigate=useNavigate()
  return <header className="mb-5 flex items-center justify-between gap-3">
    <div className="min-w-0"><p className="text-sm text-slate-400">{subtitle}</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-white">{title}</h1></div>
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" onClick={()=>navigate('/notifications')} aria-label={unreadCount>0?'알림 (새 알림 있음)':'알림'} className="flex h-11 touch-manipulation items-center justify-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-900 px-3 text-slate-200">
        <span className="pointer-events-none relative"><Bell size={20}/>{unreadCount>0&&<span aria-hidden="true" data-testid="notification-unread-dot" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-slate-900"/>}</span>
        <span className="pointer-events-none text-xs font-medium">알림</span>
      </button>
      {showSettings&&<Link to="/settings" aria-label="설정" className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-200"><Settings size={20}/></Link>}
    </div>
  </header>
}
export default Header
