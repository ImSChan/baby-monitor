import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NotificationProvider } from './NotificationContext'
import PushCenter from '../components/common/PushCenter'
import Header from '../components/common/Header'
const mock = vi.hoisted(() => ({ listeners: {}, user: { id: 1 }, count:0, get:vi.fn() }))
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
vi.mock('../api/client', () => ({ apiGet: mock.get, apiPost: vi.fn() }))
vi.mock('../services/pushService', () => ({ isAndroid: () => true, registerToken: vi.fn(), resumePush: vi.fn() }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: vi.fn(async (name, callback) => { mock.listeners[name] = callback; return { remove: vi.fn() } }),
  checkPermissions: vi.fn(async () => ({ receive: 'granted' })), createChannel: vi.fn(), register: vi.fn(),
} }))
beforeEach(()=>{vi.clearAllMocks();mock.user={id:1};mock.count=0;mock.listeners={}
  mock.get.mockImplementation(async path=>path.includes('/events?')?{items:[],unreadCount:mock.count}:{enabled:true})
})
afterEach(()=>{cleanup();vi.useRealTimers()})
const view=()=> <MemoryRouter><NotificationProvider><Header/></NotificationProvider></MemoryRouter>

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

it('shows the server unread dot and clears it after the last notification is confirmed',async()=>{
  mock.count=2;render(view())
  await screen.findByRole('button',{name:'알림 (새 알림 있음)'})
  expect(screen.getByTestId('notification-unread-dot')).toBeTruthy()
  mock.count=0;await act(async()=>window.dispatchEvent(new Event('babyeye:notifications')))
  await waitFor(()=>expect(screen.queryByTestId('notification-unread-dot')).toBeNull())
})
it('refreshes the dot on foreground push receipt',async()=>{
  render(view());await waitFor(()=>expect(mock.listeners.pushNotificationReceived).toBeTypeOf('function'))
  await waitFor(()=>expect(mock.get).toHaveBeenCalledWith('/api/push/events?limit=1&offset=0',expect.anything()))
  mock.count=1;await act(async()=>mock.listeners.pushNotificationReceived({data:{eventId:'42'}}))
  await screen.findByRole('button',{name:'알림 (새 알림 있음)'})
})
it('discards an old account count and hides the dot on logout',async()=>{
  let resolveOld
  mock.get.mockImplementation(async path=>path.includes('/events?')?new Promise(resolve=>{resolveOld=resolve}):{enabled:true})
  const page=render(view());await waitFor(()=>expect(resolveOld).toBeTypeOf('function'))
  mock.user={id:2};mock.get.mockImplementation(async path=>path.includes('/events?')?{items:[],unreadCount:1}:{enabled:true})
  page.rerender(view());await screen.findByRole('button',{name:'알림 (새 알림 있음)'})
  mock.user=null;page.rerender(view())
  expect(screen.queryByTestId('notification-unread-dot')).toBeNull()
  await act(async()=>resolveOld({items:[],unreadCount:9}))
  expect(screen.queryByTestId('notification-unread-dot')).toBeNull()
})
it('polls every 30 seconds even without native push delivery',async()=>{
  vi.useFakeTimers();render(view());await act(async()=>{})
  mock.count=1;await act(async()=>vi.advanceTimersByTimeAsync(30000))
  expect(screen.getByTestId('notification-unread-dot')).toBeTruthy()
})
it('keeps the last known dot on refresh failure and retries on focus',async()=>{
  mock.count=1;render(view());await screen.findByRole('button',{name:'알림 (새 알림 있음)'})
  mock.get.mockRejectedValueOnce(new Error('offline'))
  await act(async()=>window.dispatchEvent(new Event('babyeye:notifications')))
  expect(screen.getByTestId('notification-unread-dot')).toBeTruthy()
  mock.count=0;await act(async()=>window.dispatchEvent(new Event('focus')))
  await waitFor(()=>expect(screen.queryByTestId('notification-unread-dot')).toBeNull())
})
