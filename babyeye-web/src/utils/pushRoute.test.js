import { describe, it, expect } from 'vitest'
import { notificationPath, safeReturnPath } from './pushRoute'
describe('notification routing', () => {
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
