
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from 'react'

import { apiGet, apiPost } from '../api/client'
import {
  AUTH_TOKEN_KEY,
  getAccessToken,
  setAccessToken,
  clearAccessToken,
} from '../api/authToken'

import { stopAllLiveResources } from '../services/liveResources'
import { revokePush } from '../services/pushService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const authEpoch = useRef(0)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function restoreSession() {
      const epoch = authEpoch.current, token = getAccessToken()
      if (!token) {
        setUser(null)
        setLoading(false)
        return
      }

      try {
        const currentUser = await apiGet('/api/auth/me')

        if (active && epoch === authEpoch.current && token === getAccessToken()) {
          setUser(currentUser)
        }
      } catch (error) {
        if (active && epoch === authEpoch.current && token === getAccessToken()) {
          if (error.status === 401 || error.status === 403) {
            clearAccessToken()
          }
          setUser(null)
        }
      } finally {
        if (active && epoch === authEpoch.current) {
          setLoading(false)
        }
      }
    }

    function synchronizeSession(event){
      if(event.key!==AUTH_TOKEN_KEY && event.key!==null)return
      if(event.storageArea && event.storageArea!==localStorage)return
      // Drop legacy tab storage before reading a shared logout, so it cannot
      // resurrect the previous account's credential.
      sessionStorage.removeItem(AUTH_TOKEN_KEY)
      stopAllLiveResources()
      authEpoch.current++
      setUser(null);setLoading(true)
      restoreSession()
    }
    restoreSession()
    window.addEventListener('storage',synchronizeSession)

    return () => {
      window.removeEventListener('storage',synchronizeSession)
      active = false
    }
  }, [])

  useEffect(() => {
    const expire = () => expireSession()
    window.addEventListener('babyeye:unauthorized', expire)
    return () => window.removeEventListener('babyeye:unauthorized', expire)
  }, [])

  async function login(email, password) {
    const epoch = ++authEpoch.current
    const result = await apiPost('/api/auth/login', {
      email,
      password,
    })

    if (epoch !== authEpoch.current) throw new DOMException('Login superseded', 'AbortError')
    setAccessToken(result.access_token)

    try {
      const currentUser = await apiGet('/api/auth/me')
      if (epoch !== authEpoch.current || getAccessToken() !== result.access_token) throw new DOMException('Login superseded', 'AbortError')
      setUser(currentUser)
      return currentUser
    } catch (error) {
      if (epoch === authEpoch.current && getAccessToken() === result.access_token) {
        clearAccessToken()
        setUser(null)
      }
      throw error
    }
  }

  function expireSession() {
    authEpoch.current++
    clearAccessToken()
    setUser(null)
  }

  async function logout() {
    const epoch = ++authEpoch.current, token = getAccessToken()
    stopAllLiveResources()
    await revokePush()
    if (epoch === authEpoch.current && getAccessToken() === token) {
      clearAccessToken()
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, expireSession }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
