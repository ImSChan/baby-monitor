import { useNotifications } from '../../contexts/NotificationContext'
import { isAndroid } from '../../services/pushService'

export default function NotificationSettings() {
  const { enabled, loading, busy, error, nativeStatus, changeEnabled, reconnect, refresh, ready } = useNotifications()
  return <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5" aria-label="상태 알림 설정">
    <div className="flex items-center justify-between gap-4">
      <div><h2 className="font-bold">상태 알림</h2>
        <p className="mt-1 text-sm text-slate-400">{loading ? '설정 확인 중…' : enabled ? '활성화됨' : '비활성화됨'}</p></div>
      <button type="button" role="switch" aria-label="상태 알림 활성화" aria-checked={enabled}
        disabled={loading || busy} onClick={() => changeEnabled(!enabled)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${enabled ? 'bg-blue-500' : 'bg-slate-600'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${enabled ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
    <p className="mt-4 text-sm leading-6 text-slate-300">같은 카메라에서 동일한 상태가 3번 연속 감지되면 알려드려요. 안정(stable) 상태는 알림을 보내지 않아요.</p>
    <p className="mt-2 text-xs text-slate-500">이 설정은 로그인한 계정의 모든 기기에 적용돼요.</p>
    {enabled && <p role="status" className="mt-3 text-sm text-blue-200">{isAndroid() ? nativeStatus || '푸시 연결 준비 중…' : '앱 안에서 알림을 확인할 수 있어요. 푸시는 Android 앱에서 받을 수 있어요.'}</p>}
    {enabled && isAndroid() && <button disabled={busy || !ready} onClick={reconnect} className="mt-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-blue-200 disabled:opacity-50">푸시 재연결</button>}
    {error && <div className="mt-3"><p role="alert" className="text-sm text-red-300">{error}</p><button onClick={refresh} disabled={busy || loading} className="mt-2 text-sm text-blue-200">설정 다시 불러오기</button></div>}
  </section>
}
