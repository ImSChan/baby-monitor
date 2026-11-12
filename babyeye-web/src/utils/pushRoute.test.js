import { describe, it, expect } from 'vitest'
import { notificationPath, safeReturnPath } from './pushRoute'
describe('notification routing', () => {
  it('opens a valid digest window and preserves its destination after login', () => {
    const path = notificationPath({ eventId: '12', kind: 'review', windowEnd: '2026-11-12T10:00:00+09:00' })
    expect(path).toBe('/reviews?end=2026-11-12T10%3A00%3A00%2B09%3A00&eventId=12')
    expect(safeReturnPath(path)).toBe(path)
    expect(notificationPath({ eventId: '12', kind: 'review', windowEnd: '//evil.test' })).toBe('/notifications/12')
  })
  it('accepts only a numeric event identifier', () => {
    expect(notificationPath({ eventId: '12' })).toBe('/notifications/12')
    for (const eventId of ['', '../2', 'https://evil.test', '0', '-1', '1?x=2']) {
      expect(notificationPath({ eventId })).toBe(null)
    }
    expect(notificationPath(null)).toBe(null)
  })
  it('preserves internal return destinations and rejects external URLs', () => {
    expect(safeReturnPath('/notifications/12')).toBe('/notifications/12')
    for (const value of ['//evil.test', 'https://evil.test', '/\\evil.test', undefined]) {
      expect(safeReturnPath(value)).toBe('/')
    }
  })
})
