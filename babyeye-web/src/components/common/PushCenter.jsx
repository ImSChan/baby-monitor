import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PushNotifications } from '@capacitor/push-notifications'
import { useAuth } from '../../contexts/AuthContext'
import { notificationPath } from '../../utils/pushRoute'
import { isAndroid, registerToken, resumePush, revokePush } from '../../services/pushService'

export default function PushCenter() {
  const { user } = useAuth()
  const userRef = useRef(user)
  userRef.current = user
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [received, setReceived] = useState(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(localStorage.getItem('babyeye.push.enabled') !== 'false')
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    if (!isAndroid()) return
    let cancelled = false
    const handles = []
    const listen = async (name, callback) => {
      const handle = await PushNotifications.addListener(name, callback)
      if (cancelled) await handle.remove()
      else handles.push(handle)
    }
    async function start() {
      await listen('registration', ({ value }) => {
        if (userRef.current && enabledRef.current) registerToken(value)
          .then(() => { if (!cancelled) setMessage('푸시 알림이 연결되었습니다.') })
          .catch(() => { if (!cancelled) setMessage('기기 등록에 실패했습니다. 알림 켜기를 다시 눌러주세요.') })
      })
      await listen('registrationError', () => setMessage('푸시 등록에 실패했습니다. Firebase 설정과 네트워크를 확인해주세요.'))
      await listen('pushNotificationReceived', (notification) => {
        if (userRef.current) setReceived(notification)
      })
      await listen('pushNotificationActionPerformed', ({ notification }) => {
        const path = notificationPath(notification.data)
        if (path) navigate(path)
      })
      if (!cancelled) setReady(true)
    }
    start().catch(() => setMessage('푸시 초기화에 실패했습니다. 앱을 다시 시작해주세요.'))
    return () => { cancelled = true; handles.forEach(handle => handle.remove()) }
  }, [navigate])

  useEffect(() => {
    setReceived(null)
    if (!user || !ready || !isAndroid() || !enabled) return
    resumePush()
    // Existing grant restores registration without prompting on each login.
    PushNotifications.checkPermissions().then(async permission => {
      if (permission.receive === 'granted') {
        await PushNotifications.createChannel({ id: 'babyeye-analysis', name: '아기 상태 분석', importance: 4 })
        await PushNotifications.register()
      }
    }).catch(() => setMessage('알림 연결을 다시 시도해주세요.'))
  }, [user, ready, enabled])

  async function enable() {
    setBusy(true)
    try {
      let permission = await PushNotifications.checkPermissions()
      if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions()
      if (permission.receive !== 'granted') {
        setMessage('알림 권한이 꺼져 있습니다. Android 설정에서 허용해주세요.')
        return
      }
      localStorage.setItem('babyeye.push.enabled', 'true')
      enabledRef.current = true
      setEnabled(true)
      resumePush()
      await PushNotifications.createChannel({ id: 'babyeye-analysis', name: '아기 상태 분석', importance: 4 })
      await PushNotifications.register()
    } catch { setMessage('알림 연결에 실패했습니다. 다시 시도해주세요.') }
    finally { setBusy(false) }
  }
  async function disable() {
    setBusy(true)
    try {
      await revokePush()
      enabledRef.current = false
      setEnabled(false)
      localStorage.setItem('babyeye.push.enabled', 'false')
      setMessage('이 기기의 푸시 알림을 해제했습니다.')
    } catch { setMessage('알림 해제에 실패했습니다. 연결 상태를 확인하고 다시 시도해주세요.') }
    finally { setBusy(false) }
  }
  if (!isAndroid() || !user) return null
  return <aside className="p-3 text-sm bg-slate-900" aria-label="푸시 알림">
    <button disabled={!ready || busy} onClick={enable} className="mr-4 text-blue-300">알림 켜기 / 재연결</button>
    {enabled && <button disabled={busy} onClick={disable} className="text-slate-300">알림 해제</button>}
    {message && <p role="status">{message}</p>}
    {received && <button className="block mt-2 text-blue-300" onClick={() => {
      const path = notificationPath(received.data)
      setReceived(null)
      if (path) navigate(path)
    }}>새 분석 결과 확인하기</button>}
  </aside>
}
