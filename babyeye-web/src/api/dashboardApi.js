import { apiGet } from './client'

export function getDashboard(options = {}) {
  return apiGet('/api/dashboard', options)
}
