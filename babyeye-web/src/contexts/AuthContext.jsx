
import {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react'

import { apiGet, apiPost } from '../api/client'
import {
  getAccessToken,
  setAccessToken,
  clearAccessToken,
} from '../api/authToken'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function restoreSession() {
      if (!getAccessToken()) {
        setLoading(false)
        return
      }

      try {
        const currentUser = await apiGet('/api/auth/me')

        if (active) {
          setUser(currentUser)
        }
      } catch (error) {
        if (active) {
          if (error.status === 401 || error.status === 403) {
            clearAccessToken()
          }
          setUser(null)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    restoreSession()

    return () => {
      active = false
    }
  }, [])

  async function login(email, password) {
    const result = await apiPost('/api/auth/login', {
      email,
      password,
    })

    setAccessToken(result.access_token)

    try {
      const currentUser = await apiGet('/api/auth/me')
      setUser(currentUser)
      return currentUser
    } catch (error) {
      clearAccessToken()
      setUser(null)
      throw error
    }
  }

  function logout() {
    clearAccessToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout }}
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
