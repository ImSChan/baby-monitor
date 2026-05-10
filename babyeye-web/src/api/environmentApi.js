import { apiGet, apiPost } from './client'

export function getLatestEnvironment() {
  return apiGet('/api/environment/latest')
}

export function createEnvironmentState(environmentData) {
  return apiPost('/api/environment', environmentData)
}
