import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useAccountStatus from './useAccountStatus'
const mock = vi.hoisted(() => ({ get: vi.fn(), user: { id: 1 } }))
vi.mock('../api/client', () => ({ apiGet: mock.get }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
const flush = async () => { for (let i=0;i<10;i++) await Promise.resolve() }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mock.user = { id: 1 }; Object.defineProperty(document, 'hidden', { configurable: true, value: false }) })
afterEach(() => { cleanup(); vi.useRealTimers() })
it('never shows a late result from the previous account', async () => {
  let resolveOld
  mock.get.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockResolvedValueOnce({ stage: 'empty' })
  const { result, rerender } = renderHook(() => useAccountStatus('/api/training/status'))
  mock.user = { id: 2 }; rerender()
  await act(flush)
  expect(result.current.data.stage).toBe('empty')
  await act(async () => { resolveOld({ stage: 'registered', private: 'account one' }); await flush() })
  expect(result.current.data).toEqual({ stage: 'empty' })
})
it('retains the last result with an error when polling fails', async () => {
  mock.get.mockResolvedValueOnce({ stage: 'training' }).mockRejectedValueOnce(new Error('network'))
  const { result } = renderHook(() => useAccountStatus('/api/training/status'))
  await act(flush)
  await act(async () => vi.advanceTimersByTimeAsync(15000))
  expect(result.current.data.stage).toBe('training'); expect(result.current.error).toContain('마지막 확인')
})
it('cancels pending requests and timers on leaving the page', async () => {
  mock.get.mockReturnValue(new Promise(() => {}))
  const { unmount } = renderHook(() => useAccountStatus('/api/training/status'))
  const signal = mock.get.mock.calls[0][1].signal
  unmount()
  expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
})
