import { apiGet, apiPost } from './client'

export function getCurrentEmotion() {
  return apiGet('/api/emotions/current')
}

export function getEmotionHistory(options = {}) {
  return apiGet('/api/emotions/history', options)
}

export function createEmotionEvent(eventData) {
  return apiPost('/api/emotions', eventData)
}
