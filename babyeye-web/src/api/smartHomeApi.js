import { apiGet } from './client'

export function getSmartHomeDevices() {
  return apiGet('/api/smart-home/devices')
}
