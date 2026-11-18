import { useEffect, useState } from 'react'
import { apiGet } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

export default function useAccountStatus(path) {
  const { user } = useAuth()
  const [state, setState] = useState({ owner: null, data: null, error: '', refreshedAt: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, inFlight = false, controller, timeout
    setState({ owner: user?.id, data: null, error: '', refreshedAt: null })
    async function load() {
      if (!active || inFlight || !user?.id || document.hidden) return
      inFlight = true; controller = new AbortController()
      timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const data = await apiGet(path, { signal: controller.signal })
        if (active) setState({ owner: user.id, data, error: '', refreshedAt: Date.now() })
      } catch {
        if (active) setState(old => ({ ...old, owner: user.id, error: '상태를 갱신하지 못했어요. 마지막 확인 정보입니다.' }))
      } finally { clearTimeout(timeout); inFlight = false }
    }
    void load()
    const timer = setInterval(load, 15000)
    document.addEventListener('visibilitychange', load)
    window.addEventListener('babyeye:notifications', load)
    return () => { active = false; clearInterval(timer); clearTimeout(timeout); controller?.abort();
      document.removeEventListener('visibilitychange', load); window.removeEventListener('babyeye:notifications', load) }
  }, [path, user?.id, attempt])
  const visible = state.owner === user?.id ? state : { data: null, error: '', refreshedAt: null }
  return { ...visible, retry: () => setAttempt(value => value + 1) }
}
