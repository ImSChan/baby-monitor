import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from './HomePage'
const mock = vi.hoisted(() => ({ notification: vi.fn(), history: vi.fn(), live: vi.fn(), user: { id: 1 }, token: 'one' }))
vi.mock('../api/notificationApi', () => ({ getLatestStateNotification: mock.notification }))
vi.mock('../api/emotionApi', () => ({ getEmotionHistory: mock.history }))
vi.mock('../api/liveApi', () => ({ getLiveSessions: mock.live }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
vi.mock('../api/authToken', () => ({ getAccessToken: () => mock.token }))
const result = () => ({ id: 1, emotion: '배고픔', need: 'feeding', confidence: .82, created_at: new Date().toISOString(), topPredictions: [
  { emotion: '배고픔', need: 'feeding', confidence: .82 }, { emotion: '졸림', need: 'sleep', confidence: .12 },
] })
const view = () => <MemoryRouter><HomePage /></MemoryRouter>
afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => {
  vi.clearAllMocks(); mock.user = { id: 1 }; mock.token = 'one'
  mock.notification.mockResolvedValue(result())
  mock.history.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ ...result(), id: i + 1 })))
  mock.live.mockResolvedValue([])
})

it('places the live hub after the baby summary and before history without the training card', async () => {
  render(view())
  await screen.findByRole('heading',{name:'배고픔',exact:true})
  expect(screen.getByRole('link',{name:'설정',exact:true}).getAttribute('href')).toBe('/settings')
  expect(screen.getByRole('button',{name:'알림',exact:true}).disabled).toBe(false)
  const overview = screen.getByRole('region', { name: '최근 아기 상태' })
  const flow = screen.getByRole('region', { name: '최근 분석 흐름' })
  const live = screen.getByRole('region', { name: '라이브 확인' })
  expect(overview.compareDocumentPosition(flow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(overview.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(live.compareDocumentPosition(flow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByText('개인화 학습 상태')).toBeNull()
  expect(screen.getAllByRole('region',{name:'라이브 확인'})).toHaveLength(1)
  expect(within(overview).getByText('82%')).toBeTruthy()
  expect(screen.getByText('12%')).toBeTruthy()
  expect(screen.getByText('최근 6건 기준 · 분석 횟수')).toBeTruthy()
  expect(screen.queryByText('현재 아기가 우는 이유')).toBeNull()
  expect(document.querySelector('video')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '분석 기록 6건 모두 보기' }))
  expect(screen.getByRole('list').children.length).toBe(6)
})

it('shows an honest empty state with working analysis entry points', async () => {
  mock.notification.mockResolvedValue(null); mock.history.mockResolvedValue([])
  render(view())
  await screen.findByText('아직 상태 알림이 없어요')
  expect(screen.getByRole('link', { name: '홈캠 분석 시작' }).getAttribute('href')).toBe('/camera-host')
  expect(screen.queryByRole('region',{name:'영상으로 분석하기'})).toBeNull()
  expect(screen.queryByRole('link',{name:/지난 12시간 돌아보기/})).toBeNull()
  expect(screen.queryByLabelText('분석할 영상 선택')).toBeNull()
  expect(screen.getByRole('link', { name: '라이브 보기' }).getAttribute('href')).toBe('/live')
})

it('keeps the primary analysis visible when history and live status fail', async () => {
  mock.history.mockRejectedValue(new Error('offline')); mock.live.mockRejectedValue(new Error('offline'))
  render(view())
  await screen.findByRole('heading',{name:'배고픔',exact:true})
  expect(screen.getByText('최근 기록을 갱신하지 못했어요.')).toBeTruthy()
  expect(screen.getByText(/연결 상태를 확인하지 못했어요/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '분석 새로고침' })).toBeTruthy()
})

it('does not wait for a hanging live server to show the analysis', async () => {
  mock.live.mockImplementationOnce(() => new Promise(() => {}))
  render(view())
  await screen.findByRole('heading',{name:'배고픔',exact:true})
  await waitFor(() => expect(screen.getByRole('button', { name: '분석 새로고침' }).disabled).toBe(false))
})

it('distinguishes an unavailable server from an account with no analyses', async () => {
  mock.notification.mockRejectedValue(new Error('offline')); mock.history.mockRejectedValue(new Error('offline'))
  render(view())
  await screen.findByText('대표 상태를 불러오지 못했어요')
  expect(screen.queryByText('아직 상태 알림이 없어요')).toBeNull()
})

it('refreshes analysis even when no live viewer is connected', async () => {
  const timer = vi.spyOn(window, 'setInterval')
  render(view())
  await screen.findByRole('heading',{name:'배고픔',exact:true})
  mock.notification.mockResolvedValue({ ...result(), need: 'stable', emotion: '안정', created_at: new Date(Date.now() + 1000).toISOString() })
  const callback = timer.mock.calls.find(([, ms]) => ms === 15000)[0]
  await act(async () => callback())
  await screen.findByRole('heading',{name:'안정',exact:true})
  expect(mock.notification).toHaveBeenCalledTimes(2)
})

it('does not restore the old account after a slow response', async () => {
  let resolve
  mock.notification.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const page = render(view())
  mock.user = { id: 2 }; mock.token = 'two'
  mock.notification.mockResolvedValue({ ...result(), need: 'stable', emotion: '안정' })
  mock.history.mockResolvedValue([])
  page.rerender(view())
  await screen.findByRole('heading',{name:'안정',exact:true})
  await act(async () => resolve(result()))
  expect(screen.queryByRole('heading',{name:'배고픔',exact:true})).toBeNull()
})

it('offers a direct link for a camera returned by this account',async()=>{
  mock.live.mockResolvedValue([{sessionId:'session-one',cameraName:'아기방 홈캠'}])
  render(view());await screen.findByText('아기방 홈캠')
  expect(screen.getByRole('link',{name:'라이브 보기'}).getAttribute('href')).toBe('/live?session=session-one')
  expect(screen.getByRole('link',{name:'홈캠 시작'}).getAttribute('href')).toBe('/camera-host')
})

it('uses an old read notification instead of newer single analysis history',async()=>{
  mock.notification.mockResolvedValue({...result(),need:'care',emotion:'불편함',notificationId:42,created_at:'2025-01-01T10:00:00'})
  render(view());await screen.findByRole('heading',{name:'불편함',exact:true})
  expect(screen.getByRole('link',{name:'알림에서 실제 상태 알려주기'}).getAttribute('href')).toBe('/notifications/42')
  expect(screen.queryByText('아기 상태')).toBeNull();expect(screen.queryByText('돌봄이 필요한 것 같아요')).toBeNull()
})
it('does not replace a missing notification with single analysis history',async()=>{
  mock.notification.mockResolvedValue(null)
  render(view());await screen.findByText('아직 상태 알림이 없어요')
  expect(screen.queryByRole('heading',{name:'배고픔',exact:true})).toBeNull()
})
it('shows an existing alert without needing the new dashboard API',async()=>{
  mock.notification.mockResolvedValue({...result(),notificationId:1});render(view())
  await screen.findByRole('heading',{name:'배고픔',exact:true})
  expect(screen.queryByText('대표 상태를 불러오지 못했어요')).toBeNull()
})
