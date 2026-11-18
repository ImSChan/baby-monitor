import { act, renderHook, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useVideoFreshness from './useVideoFreshness'
let callbacks, video, ref, serial
beforeEach(() => {
  vi.useFakeTimers(); callbacks = new Map(); serial = 0
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  video = { requestVideoFrameCallback: vi.fn(fn => { callbacks.set(++serial, fn); return serial }),
    cancelVideoFrameCallback: vi.fn(id => callbacks.delete(id)) }
  ref = { current: video }
})
afterEach(() => { cleanup(); vi.useRealTimers() })
function frame() { const entry = callbacks.entries().next().value; callbacks.delete(entry[0]); entry[1]() }
it('requires an actual frame, detects freeze, and recovers without reconnecting', () => {
  const { result } = renderHook(() => useVideoFreshness(ref, 'room', true))
  expect(result.current.phase).toBe('waiting')
  act(() => { frame(); vi.advanceTimersByTime(1000) })
  expect(result.current.phase).toBe('live')
  const received = result.current.lastFrameAt
  act(() => vi.advanceTimersByTime(11000))
  expect(result.current.phase).toBe('stalled'); expect(result.current.lastFrameAt).toBe(received)
  act(() => { frame(); vi.advanceTimersByTime(1000) })
  expect(result.current.phase).toBe('live')
})
it('warns when a connected stream never produces its first frame', () => {
  const { result } = renderHook(() => useVideoFreshness(ref, 'room', true))
  act(() => vi.advanceTimersByTime(11000))
  expect(result.current.phase).toBe('stalled'); expect(result.current.lastFrameAt).toBeNull()
})
it('clears old session state and cancels callbacks on stop and unmount', () => {
  const { result, rerender, unmount } = renderHook(({ key, enabled }) => useVideoFreshness(ref, key, enabled), { initialProps: { key: 'one', enabled: true } })
  act(() => { frame(); vi.advanceTimersByTime(1000) })
  rerender({ key: 'two', enabled: true })
  expect(result.current.lastFrameAt).toBeNull(); expect(result.current.phase).toBe('waiting')
  rerender({ key: null, enabled: false })
  expect(result.current.phase).toBe('idle'); expect(callbacks.size).toBe(0)
  unmount(); expect(vi.getTimerCount()).toBe(0)
})
it('does not label background throttling as a freeze', () => {
  const { result } = renderHook(() => useVideoFreshness(ref, 'room', true))
  act(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(11000) })
  expect(result.current.phase).toBe('hidden')
})
it('uses decoded frame progress, never currentTime alone, on older engines', () => {
  let count = 10
  ref.current = { currentTime: 100, getVideoPlaybackQuality: () => ({ totalVideoFrames: count }) }
  const { result } = renderHook(() => useVideoFreshness(ref, 'room', true))
  expect(result.current.phase).toBe('waiting')
  act(() => { count++; vi.advanceTimersByTime(1000) })
  expect(result.current.phase).toBe('live')
  act(() => { ref.current.currentTime = 900; vi.advanceTimersByTime(11000) })
  expect(result.current.phase).toBe('stalled')
})
it('reports unsupported frame monitoring honestly', () => {
  ref.current = { currentTime: 100 }
  const { result } = renderHook(() => useVideoFreshness(ref, 'room', true))
  expect(result.current.phase).toBe('unknown')
})
