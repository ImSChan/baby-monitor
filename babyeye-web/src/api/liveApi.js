import { apiGet, apiPost, getApiBaseUrl } from './client'

export function createLiveSession(payload) {
  return apiPost('/api/live/sessions', payload)
}

export function getLiveSessions() {
  return apiGet('/api/live/sessions')
}

export function getLiveSession(sessionId) {
  return apiGet('/api/live/sessions/' + sessionId)
}

export function buildLiveWebSocketUrl(sessionId, role) {
  const apiBaseUrl = getApiBaseUrl()
  const wsBaseUrl = apiBaseUrl
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://')

  return wsBaseUrl + '/api/live/ws/' + sessionId + '/' + role
}
