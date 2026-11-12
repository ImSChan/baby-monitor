export function notificationPath(data) {
  const id = String(data?.eventId || '')
  if (/^[1-9]\d{0,14}$/.test(id) && data?.kind === 'review'
      && typeof data.windowEnd === 'string' && data.windowEnd.length <= 40
      && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(data.windowEnd)
      && Number.isFinite(Date.parse(data.windowEnd))) {
    return `/reviews?end=${encodeURIComponent(data.windowEnd)}&eventId=${id}`
  }
  return /^[1-9]\d{0,14}$/.test(id) ? `/notifications/${id}` : null
}

export function safeReturnPath(value) {
  return typeof value === 'string' && /^\/(?!\/)[^\\]*$/.test(value)
    ? value : '/'
}
