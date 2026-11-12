import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PushNotifications } from '@capacitor/push-notifications'
import { useAuth } from './AuthContext'
import { apiGet, apiPost } from '../api/client'
import { isAndroid, registerToken, resumePush } from '../services/pushService'
import { notificationPath } from '../utils/pushRoute'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nativeStatus, setNativeStatus] = useState('')
  const [received, setReceived] = useState(null)
  const [ready, setReady] = useState(!isAndroid())
  const current = useRef({ user, enabled })
  current.current = { user, enabled }

  const refresh = useCallback(async () => {
    if (!user) return
    const account = user.id
    setError('')
    setLoading(true)
    try {
      const data = await apiGet('/api/push/preferences')
      if (current.current.user?.id === account) setEnabled(data.enabled)
    } catch (err) {
      setError(err.status === 404 ? '서버에 새 알림 기능이 아직 적용되지 않았습니다.' : '알림 설정을 불러오지 못했습니다. 다시 시도해주세요.')
    } finally { setLoading(false) }
  }, [user?.id])

  useEffect(() => {
    let active = true
    setEnabled(false)
    setReceived(null)
    setNativeStatus('')
    setError('')
    if (!user) { setLoading(false); return }
    setLoading(true)
    apiGet('/api/push/preferences').then(data => {
      if (active) setEnabled(data.enabled)
    }).catch(err => {
      if (active) setError(err.status === 404 ? '서버에 새 알림 기능이 아직 적용되지 않았습니다.' : '알림 설정을 불러오지 못했습니다. 다시 시도해주세요.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (!isAndroid()) return
    let cancelled = false
    const handles = []
    async function listen(name, callback) {
      const handle = await PushNotifications.addListener(name, callback)
      if (cancelled) await handle.remove()
      else handles.push(handle)
    }
    async function start() {
      await listen('registration', ({ value }) => {
        if (!current.current.user || !current.current.enabled) return
        const account = current.current.user.id
        registerToken(value).then(() => {
          if (!cancelled && current.current.user?.id === account && current.current.enabled) setNativeStatus('푸시 알림 연결 완료')
        }).catch(() => { if (!cancelled && current.current.user?.id === account) setNativeStatus('푸시 연결 실패 · 재연결을 눌러주세요.') })
      })
      await listen('registrationError', () => {
        if (!cancelled) setNativeStatus('푸시 연결 실패 · Firebase 설정과 네트워크를 확인해주세요.')
      })
      await listen('pushNotificationReceived', notification => {
        if (current.current.user && current.current.enabled) {
          setReceived(notification)
          window.dispatchEvent(new Event('babyeye:notifications'))
        }
      })
      await listen('pushNotificationActionPerformed', ({ notification }) => {
        const path = notificationPath(notification.data)
        if (path) navigate(path)
      })
      if (!cancelled) setReady(true)
    }
    start().catch(() => { if (!cancelled) setNativeStatus('푸시 초기화 실패 · 앱을 다시 실행해주세요.') })
    return () => { cancelled = true; handles.forEach(handle => handle.remove()) }
  }, [navigate])

  async function connect() {
    resumePush()
    setNativeStatus('푸시 연결 중…')
    await PushNotifications.createChannel({ id: 'babyeye-analysis', name: '아기 상태 알림', importance: 4 })
    await PushNotifications.register()
  }

  useEffect(() => {
    if (!user || loading || !enabled || !ready || !isAndroid()) return
    let active = true
    PushNotifications.checkPermissions().then(async permission => {
      if (!active) return
      if (permission.receive === 'granted') await connect()
      else setNativeStatus('Android 알림 권한이 필요합니다. 푸시 재연결을 눌러주세요.')
    }).catch(() => { if (active) setNativeStatus('푸시 연결 실패 · 재연결을 눌러주세요.') })
    return () => { active = false }
  }, [user?.id, loading, enabled, ready])

  async function changeEnabled(next) {
    setBusy(true)
    setError('')
    try {
      if (next && isAndroid()) {
        if (!ready) throw new Error('푸시 초기화 중입니다. 잠시 후 다시 시도해주세요.')
        let permission = await PushNotifications.checkPermissions()
        if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions()
        if (permission.receive !== 'granted') throw new Error('Android 알림 권한이 꺼져 있습니다. 기기 설정에서 허용해주세요.')
      }
      const data = await apiPost('/api/push/preferences', { enabled: next })
      current.current.enabled = data.enabled
      setEnabled(data.enabled)
      if (!data.enabled) {
        setReceived(null)
        setNativeStatus('')
        if (isAndroid()) await PushNotifications.removeAllDeliveredNotifications().catch(() => {})
      }
    } catch (err) {
      setError(err.status === 404 ? '서버에 새 알림 기능을 먼저 적용해주세요.' : (err.message || '알림 설정을 저장하지 못했습니다.'))
    } finally { setBusy(false) }
  }
  async function reconnect() {
    setBusy(true)
    try {
      let permission = await PushNotifications.checkPermissions()
      if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions()
      if (permission.receive !== 'granted') throw new Error('기기 설정에서 알림 권한을 허용해주세요.')
      await connect()
    } catch (err) { setNativeStatus(err.message || '푸시 재연결에 실패했습니다.') }
    finally { setBusy(false) }
  }
  return <NotificationContext.Provider value={{ enabled, loading, busy, error, nativeStatus,
    ready, changeEnabled, reconnect, refresh, received, dismiss: () => setReceived(null) }}>
    {children}
  </NotificationContext.Provider>
}

export const useNotifications = () => useContext(NotificationContext)
