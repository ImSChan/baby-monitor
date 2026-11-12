import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { NotificationProvider } from '../../contexts/NotificationContext'
import NotificationSettings from './NotificationSettings'
import PushCenter from './PushCenter'

const mocks = vi.hoisted(() => ({
  listeners: {}, user: { id: 1 }, android: true, enabled: false, permission: 'granted',
  registerToken: vi.fn().mockResolvedValue(), register: vi.fn().mockResolvedValue(),
  post: vi.fn(), get: vi.fn(), remove: vi.fn().mockResolvedValue(),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../../api/client', () => ({ apiGet: mocks.get, apiPost: mocks.post }))
vi.mock('../../services/pushService', () => ({ isAndroid: () => mocks.android, registerToken: mocks.registerToken, resumePush: vi.fn() }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: vi.fn(async (name, fn) => { mocks.listeners[name] = fn; return { remove: vi.fn() } }),
  checkPermissions: vi.fn(async () => ({ receive: mocks.permission })),
  requestPermissions: vi.fn(async () => ({ receive: mocks.permission })),
  register: mocks.register, createChannel: vi.fn().mockResolvedValue(), removeAllDeliveredNotifications: mocks.remove,
} }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks(); mocks.listeners = {}; mocks.user = { id: 1 }; mocks.enabled = false; mocks.android = true; mocks.permission = 'granted'
  mocks.get.mockImplementation(async () => ({ enabled: mocks.enabled }))
  mocks.post.mockImplementation(async (_, body) => { mocks.enabled = body.enabled; return { enabled: mocks.enabled } })
})
function mount() {
  return render(<MemoryRouter><NotificationProvider><PushCenter /><NotificationSettings /><Routes>
    <Route path="/" element={null} />
    <Route path="/notifications/:id" element={<p>알림 목적지</p>} />
  </Routes></NotificationProvider></MemoryRouter>)
}
it('shows an explicit off state and enables through the real preference contract', async () => {
  mount()
  await screen.findByText('비활성화됨')
  fireEvent.click(screen.getByRole('switch', { name: '상태 알림 활성화' }))
  await screen.findByText('활성화됨')
  expect(mocks.post).toHaveBeenCalledWith('/api/push/preferences', { enabled: true })
  await waitFor(() => expect(mocks.register).toHaveBeenCalled())
  act(() => mocks.listeners.registration({ value: 'fcm-token' }))
  await screen.findByText('푸시 알림 연결 완료')
  expect(mocks.registerToken).toHaveBeenCalledWith('fcm-token')
})
it('denied Android permission leaves server preferences unchanged', async () => {
  mocks.permission = 'denied'; mount()
  await screen.findByText('비활성화됨')
  fireEvent.click(screen.getByRole('switch'))
  await screen.findByText('Android 알림 권한이 꺼져 있습니다. 기기 설정에서 허용해주세요.')
  expect(mocks.post).not.toHaveBeenCalled()
  expect(mocks.register).not.toHaveBeenCalled()
})
it('disables account notifications and removes delivered Android alerts', async () => {
  mocks.enabled = true; mount()
  await screen.findByText('활성화됨')
  fireEvent.click(screen.getByRole('switch'))
  await screen.findByText('비활성화됨')
  expect(mocks.post).toHaveBeenCalledWith('/api/push/preferences', { enabled: false })
  expect(mocks.remove).toHaveBeenCalled()
  act(() => mocks.listeners.registration({ value: 'late-token' }))
  expect(mocks.registerToken).not.toHaveBeenCalled()
})
it('supports an account toggle on the web without calling native permissions', async () => {
  mocks.android = false; mount()
  await screen.findByText('비활성화됨')
  fireEvent.click(screen.getByRole('switch'))
  await screen.findByText('활성화됨')
  await screen.findByText('앱 안에서 알림을 확인할 수 있어요. 푸시는 Android 앱에서 받을 수 있어요.')
  expect(mocks.register).not.toHaveBeenCalled()
})
it('reports backend save failure instead of claiming the switch is on', async () => {
  mocks.post.mockRejectedValueOnce(new Error('저장 실패')); mount()
  await screen.findByText('비활성화됨')
  fireEvent.click(screen.getByRole('switch'))
  await screen.findByRole('alert')
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
})
it('handles foreground receipt and click navigation before authentication', async () => {
  mocks.enabled = true; mount()
  await screen.findByText('활성화됨')
  await waitFor(() => expect(mocks.listeners.pushNotificationReceived).toBeTypeOf('function'))
  act(() => mocks.listeners.pushNotificationReceived({ data: { eventId: '7' } }))
  fireEvent.click(await screen.findByText('알림 확인'))
  await screen.findByText('알림 목적지')
})
it('retains notification click navigation when signed out', async () => {
  mocks.user = null; mount()
  await waitFor(() => expect(mocks.listeners.pushNotificationActionPerformed).toBeTypeOf('function'))
  act(() => mocks.listeners.pushNotificationActionPerformed({ notification: { data: { eventId: '7' } } }))
  await screen.findByText('알림 목적지')
})
