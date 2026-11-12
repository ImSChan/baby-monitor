import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { apiPost } from '../api/client'

export const isAndroid = () => Capacitor.getPlatform() === 'android'
let suspended = false
let queue = Promise.resolve()
const serial = (task) => {
  const next = queue.then(task)
  queue = next.catch(() => {})
  return next
}
export function installationId() {
  let id = localStorage.getItem('babyeye.push.installation')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('babyeye.push.installation', id)
  }
  return id
}
export function resumePush() { suspended = false }
export function registerToken(token) {
  return serial(() => suspended ? undefined : apiPost('/api/push/devices', {
    installation_id: installationId(), token,
  }))
}
export async function revokePush() {
  if (!isAndroid()) return
  suspended = true
  try {
    await serial(() => apiPost(`/api/push/devices/${installationId()}/revoke`, {}))
    await PushNotifications.removeAllDeliveredNotifications()
  } catch (error) {
    suspended = false
    throw error
  }
}
