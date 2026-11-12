import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PushCenter from './PushCenter'

const mocks = vi.hoisted(() => ({
  listeners: {}, user: { id: 1 }, registerToken: vi.fn().mockResolvedValue(),
  register: vi.fn().mockResolvedValue(), permission: 'prompt', revoke: vi.fn().mockResolvedValue(),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../../services/pushService', () => ({
  isAndroid: () => true, registerToken: mocks.registerToken, resumePush: vi.fn(), revokePush: mocks.revoke,
}))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: vi.fn(async (name, fn) => { mocks.listeners[name] = fn; return { remove: vi.fn() } }),
  checkPermissions: vi.fn(async () => ({ receive: mocks.permission })),
  requestPermissions: vi.fn(async () => ({ receive: mocks.permission })),
  register: mocks.register, createChannel: vi.fn().mockResolvedValue(),
} }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  const storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  })
  mocks.user = { id: 1 }; mocks.permission = 'prompt'; mocks.listeners = {}
})
function mount() {
  return render(<MemoryRouter><PushCenter /><Routes>
    <Route path="/notifications/:id" element={<p>결과 목적지</p>} />
  </Routes></MemoryRouter>)
}
it('explains denied permission without registering a token', async () => {
  mount()
  const button = screen.getByText('알림 켜기 / 재연결')
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
  await screen.findByText('알림 권한이 꺼져 있습니다. Android 설정에서 허용해주세요.')
  expect(mocks.register).not.toHaveBeenCalled()
})
it('registers after grant, handles foreground reception and result navigation', async () => {
  mocks.permission = 'granted'
  mount()
  await waitFor(() => expect(mocks.register).toHaveBeenCalled())
  act(() => mocks.listeners.registration({ value: 'fcm-token' }))
  await waitFor(() => expect(mocks.registerToken).toHaveBeenCalledWith('fcm-token'))
  act(() => mocks.listeners.pushNotificationReceived({ data: { eventId: '7' } }))
  fireEvent.click(await screen.findByText('새 분석 결과 확인하기'))
  await screen.findByText('결과 목적지')
})
it('retains click navigation even before authentication', async () => {
  mocks.user = null
  mount()
  await waitFor(() => expect(mocks.listeners.pushNotificationActionPerformed).toBeTypeOf('function'))
  act(() => mocks.listeners.pushNotificationActionPerformed({ notification: { data: { eventId: '7' } } }))
  await screen.findByText('결과 목적지')
  expect(mocks.register).not.toHaveBeenCalled()
})
it('revokes the server registration when the user disables alerts', async () => {
  mount()
  await waitFor(() => expect(screen.getByText('알림 켜기 / 재연결').disabled).toBe(false))
  fireEvent.click(screen.getByText('알림 해제'))
  await screen.findByText('이 기기의 푸시 알림을 해제했습니다.')
  expect(mocks.revoke).toHaveBeenCalledOnce()
})
