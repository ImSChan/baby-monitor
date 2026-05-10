import { apiGet } from './client'

export function getDashboard() {
  return apiGet('/api/dashboard')
}
