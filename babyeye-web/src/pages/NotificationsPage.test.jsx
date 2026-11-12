import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import NotificationsPage from './NotificationsPage'
import NotificationResultPage from './NotificationResultPage'
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../api/client', () => ({ apiGet: mocks.get, apiPost: mocks.post }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 } }) }))
vi.mock('../components/common/NotificationSettings', () => ({ default: () => <p>상태 알림 설정</p> }))
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())
it('shows an explicit empty notification list', async () => {
  mocks.get.mockResolvedValue({ items: [], unreadCount: 0 })
  render(<MemoryRouter><NotificationsPage /></MemoryRouter>)
  await screen.findByText('아직 도착한 알림이 없어요.')
  expect(screen.getByText('상태 알림 설정')).toBeTruthy()
})
it('opens an alert and confirms it without submitting feedback', async () => {
  const event = { id: 4, createdAt: '2026-11-12T10:00:00', readAt: null, result: { emotion: '배고픔', message: '상태를 확인해주세요.' } }
  mocks.get.mockImplementation(async path => path.includes('?') ? { items: [event], unreadCount: 1 } : event)
  mocks.post.mockResolvedValue({ ...event, readAt: '2026-11-12T10:01:00' })
  render(<MemoryRouter initialEntries={['/notifications']}><Routes>
    <Route path="/notifications" element={<NotificationsPage />} />
    <Route path="/notifications/:eventId" element={<NotificationResultPage />} />
  </Routes></MemoryRouter>)
  fireEvent.click(await screen.findByText('배고픔 감지'))
  await screen.findByText('상태 알림 확인')
  fireEvent.click(screen.getByRole('button', { name: '확인 완료' }))
  await screen.findByText('최근 알림')
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/api/push/events/4/read', {})
  expect(mocks.post.mock.calls.some(([path]) => path.includes('feedback'))).toBe(false)
})
it('explains an unavailable backend with a visible retry control', async () => {
  mocks.get.mockRejectedValue({ status: 404 })
  render(<MemoryRouter><NotificationsPage /></MemoryRouter>)
  await screen.findByText('서버에 새 알림 목록 기능을 먼저 적용해주세요.')
  expect(screen.getByRole('button', { name: '알림 새로고침' })).toBeTruthy()
})
