import { apiGet, apiPost } from './client'

export function getAlerts() {
  return apiGet('/api/alerts')
}

export function createAlert(alertData) {
  return apiPost('/api/alerts', alertData)
}
