export function notificationPath(data) {
  const id = String(data?.eventId || '')
  return /^[1-9]\d{0,14}$/.test(id) ? `/notifications/${id}` : null
}

export function safeReturnPath(value) {
  return typeof value === 'string' && /^\/(?!\/)[^\\]*$/.test(value)
    ? value : '/'
}
