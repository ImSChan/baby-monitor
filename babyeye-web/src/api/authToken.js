import { stopAllLiveResources } from '../services/liveResources'

export const AUTH_TOKEN_KEY = 'babyeye_access_token'

export function getAccessToken() {
  const token=localStorage.getItem(AUTH_TOKEN_KEY)
  if(token){sessionStorage.removeItem(AUTH_TOKEN_KEY);return token}
  // Migrate a valid existing session once; server validation still applies.
  const legacy=sessionStorage.getItem(AUTH_TOKEN_KEY)
  if(legacy){localStorage.setItem(AUTH_TOKEN_KEY,legacy);sessionStorage.removeItem(AUTH_TOKEN_KEY)}
  return legacy
}

export function setAccessToken(token) {
  if(getAccessToken()!==token)stopAllLiveResources()
  localStorage.setItem(AUTH_TOKEN_KEY,token)
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
}

export function clearAccessToken() {
  stopAllLiveResources()
  localStorage.removeItem(AUTH_TOKEN_KEY)
  sessionStorage.removeItem(AUTH_TOKEN_KEY)
}
