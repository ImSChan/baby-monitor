import { stopAllLiveResources } from '../services/liveResources'

const TOKEN_KEY = 'babyeye_access_token'

export function getAccessToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setAccessToken(token) {
  if (getAccessToken() !== token) stopAllLiveResources()
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearAccessToken() {
  stopAllLiveResources()
  sessionStorage.removeItem(TOKEN_KEY)
}