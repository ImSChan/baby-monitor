const TOKEN_KEY = 'babyeye_access_token'

export function getAccessToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setAccessToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearAccessToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}