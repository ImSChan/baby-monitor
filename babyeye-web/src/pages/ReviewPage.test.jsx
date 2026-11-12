import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReviewPage from './ReviewPage'
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../api/client', () => ({ apiGet: mock.get, apiPost: mock.post }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }))
vi.mock('../components/review/ReviewEditor', () => ({ default: () => <p>분석 타임라인</p>, timeText: value => value }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mock.get.mockImplementation(async path => path.includes('/schedule') ? { enabled: false, firstTime: '10:00', secondTime: '22:00', timezone: 'Asia/Seoul' }
    : { windowStart: '2026-11-11T22:00:00+09:00', windowEnd: '2026-11-12T10:00:00+09:00', total: 1, items: [{ id: 3, result: { emotion: '배고픔' }, createdAt: '09:00' }] })
})
it('opens the exact 12-hour window from the reminder and exposes timeline feedback', async () => {
  render(<MemoryRouter initialEntries={['/reviews?end=2026-11-12T10%3A00%3A00%2B09%3A00']}><ReviewPage /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '당시 상태 알려주기' }))
  expect(screen.getByText('분석 타임라인')).toBeTruthy()
  expect(mock.get.mock.calls.some(([path]) => path.includes('end=2026-11-12T10%3A00%3A00%2B09%3A00'))).toBe(true)
})
it('requires opt-in and saves a paired local schedule', async () => {
  mock.post.mockResolvedValue({ enabled: true, firstTime: '08:30', secondTime: '20:30', timezone: 'Asia/Seoul' })
  render(<MemoryRouter><ReviewPage /></MemoryRouter>)
  fireEvent.click(screen.getByText('정기 돌아보기 알림 설정'))
  const toggle = await screen.findByRole('checkbox')
  expect(toggle.checked).toBe(false)
  fireEvent.click(toggle)
  fireEvent.change(screen.getByLabelText('첫 알림 시간'), { target: { value: '08:30' } })
  fireEvent.click(screen.getByRole('button', { name: '알림 설정 저장' }))
  await waitFor(() => expect(mock.post).toHaveBeenCalledWith('/api/reviews/schedule', { enabled: true, first_time: '08:30', timezone: 'Asia/Seoul' }))
  await screen.findByText('돌아보기 알림 설정을 저장했어요.')
})
