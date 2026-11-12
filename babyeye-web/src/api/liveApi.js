import { apiGet, apiPost, getApiBaseUrl } from './client'
import { getAccessToken } from './authToken'

export async function getLiveConfig(options = {}) {
  let config
  try { config = await apiGet('/api/live/config', options) }
  catch (error) {
    if (error.status === 404) throw new Error('서버의 새 스트리밍 기능 적용이 필요합니다.')
    throw error
  }
  if (config.protocolVersion !== 2 || !Array.isArray(config.iceServers)) {
    throw new Error('서버의 스트리밍 인증 버전이 맞지 않습니다.')
  }
  return config
}
export function createLiveSession(payload, options = {}) {
  return apiPost('/api/live/sessions', payload, options)
}
export async function getLiveSessions(options = {}) {
  await getLiveConfig(options)
  return apiGet('/api/live/sessions', options)
}
export function getLiveSession(sessionId, options = {}) {
  return apiGet('/api/live/sessions/' + encodeURIComponent(sessionId), options)
}
export async function endLiveSession(sessionId, token = getAccessToken()) {
  if (!sessionId || !token) return
  // Capture the original account's token before logout/account switch.
  // Never expire a new login because an old cleanup request returned 401.
  try {
    await fetch(getApiBaseUrl() + '/api/live/sessions/' + encodeURIComponent(sessionId), {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, keepalive: true,
    })
  } catch { /* Heartbeat/creation expiry handles unload or offline cleanup failure. */ }
}
export function buildLiveWebSocketUrl(sessionId, role) {
  if (!['host', 'viewer'].includes(role)) throw new Error('Invalid live role')
  const base = getApiBaseUrl().replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  return `${base}/api/live/ws/${encodeURIComponent(sessionId)}/${role}`
}
