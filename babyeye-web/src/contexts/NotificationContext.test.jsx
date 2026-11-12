import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NotificationProvider } from './NotificationContext'
import PushCenter from '../components/common/PushCenter'
const mock = vi.hoisted(() => ({ listeners: {}, user: { id: 1 } }))
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
vi.mock('../api/client', () => ({ apiGet: vi.fn(async () => ({ enabled: true })), apiPost: vi.fn() }))
vi.mock('../services/pushService', () => ({ isAndroid: () => true, registerToken: vi.fn(), resumePush: vi.fn() }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: vi.fn(async (name, callback) => { mock.listeners[name] = callback; return { remove: vi.fn() } }),
  checkPermissions: vi.fn(async () => ({ receive: 'granted' })), createChannel: vi.fn(), register: vi.fn(),
} }))
afterEach(cleanup)

it('receives a mock native push, displays the actual banner and opens its result', async () => {
  render(<MemoryRouter><NotificationProvider><PushCenter /><Routes>
    <Route path="/" element={<p>알림 대기</p>} />
    <Route path="/notifications/:id" element={<p>분석 결과 화면</p>} />
  </Routes></NotificationProvider></MemoryRouter>)
  await waitFor(() => expect(mock.listeners.pushNotificationReceived).toBeTypeOf('function'))
  await act(async () => mock.listeners.pushNotificationReceived({ data: { eventId: '42' } }))
  expect(screen.getByText('새 상태 알림이 도착했어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('link', { name: '알림 확인' }))
  expect(screen.getByText('분석 결과 화면')).toBeTruthy()
  expect(screen.queryByText('새 상태 알림이 도착했어요')).toBeNull()
  await act(async () => mock.listeners.pushNotificationActionPerformed({ notification: { data: { eventId: '43' } } }))
  expect(screen.getByText('분석 결과 화면')).toBeTruthy()
})
