import { apiGet, apiPost } from './client'

export function getCurrentEmotion() {
  return apiGet('/api/emotions/current')
}

export function getEmotionHistory() {
  return apiGet('/api/emotions/history')
}

export function createEmotionEvent(eventData) {
  return apiPost('/api/emotions', eventData)
}
