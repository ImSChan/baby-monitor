import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from './HomePage'
const mock = vi.hoisted(() => ({ dashboard: vi.fn(), history: vi.fn(), live: vi.fn(), preprocess: vi.fn(), upload: vi.fn(), user: { id: 1 }, token: 'one' }))
vi.mock('../api/dashboardApi', () => ({ getDashboard: mock.dashboard }))
vi.mock('../api/emotionApi', () => ({ getEmotionHistory: mock.history }))
vi.mock('../api/liveApi', () => ({ getLiveSessions: mock.live }))
vi.mock('../api/inferenceApi', () => ({ requestMultimodalInference: mock.upload, getInferenceStatus: vi.fn(), getInferenceResult: vi.fn() }))
vi.mock('../utils/videoPreprocess', () => ({ preprocessVideoForInference: mock.preprocess }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
vi.mock('../api/authToken', () => ({ getAccessToken: () => mock.token }))
const result = () => ({ id: 1, emotion: '배고픔', need: 'feeding', confidence: .82, created_at: new Date().toISOString(), topPredictions: [
  { emotion: '배고픔', need: 'feeding', confidence: .82 }, { emotion: '졸림', need: 'sleep', confidence: .12 },
] })
const view = () => <MemoryRouter><HomePage /></MemoryRouter>
afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => {
  vi.clearAllMocks(); mock.user = { id: 1 }; mock.token = 'one'
  mock.dashboard.mockResolvedValue({ currentEmotion: result() })
  mock.history.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ ...result(), id: i + 1 })))
  mock.live.mockResolvedValue([])
})

it('places the live hub after the baby summary and before history without the training card', async () => {
  render(view())
  await screen.findByText('배가 고픈 것 같아요')
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
  mock.dashboard.mockResolvedValue({ currentEmotion: null }); mock.history.mockResolvedValue([])
  render(view())
  await screen.findByText('첫 분석을 기다리고 있어요')
  expect(screen.getByRole('link', { name: '홈캠 분석 시작' }).getAttribute('href')).toBe('/camera-host')
  expect(screen.getByRole('button', { name: '영상 선택하여 분석' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '라이브 보기' }).getAttribute('href')).toBe('/live')
})

it('keeps the primary analysis visible when history and live status fail', async () => {
  mock.history.mockRejectedValue(new Error('offline')); mock.live.mockRejectedValue(new Error('offline'))
  render(view())
  await screen.findByText('배가 고픈 것 같아요')
  expect(screen.getByText('최근 기록을 갱신하지 못했어요.')).toBeTruthy()
  expect(screen.getByText(/연결 상태를 확인하지 못했어요/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '분석 새로고침' })).toBeTruthy()
})

it('does not wait for a hanging live server to show the analysis', async () => {
  mock.live.mockImplementationOnce(() => new Promise(() => {}))
  render(view())
  await screen.findByText('배가 고픈 것 같아요')
  await waitFor(() => expect(screen.getByRole('button', { name: '분석 새로고침' }).disabled).toBe(false))
})

it('distinguishes an unavailable server from an account with no analyses', async () => {
  mock.dashboard.mockRejectedValue(new Error('offline')); mock.history.mockRejectedValue(new Error('offline'))
  render(view())
  await screen.findByText('분석 결과를 불러오지 못했어요')
  expect(screen.queryByText('첫 분석을 기다리고 있어요')).toBeNull()
})

it('refreshes analysis even when no live viewer is connected', async () => {
  const timer = vi.spyOn(window, 'setInterval')
  render(view())
  await screen.findByText('배가 고픈 것 같아요')
  mock.dashboard.mockResolvedValue({ currentEmotion: { ...result(), need: 'stable', emotion: '안정', created_at: new Date(Date.now() + 1000).toISOString() } })
  const callback = timer.mock.calls.find(([, ms]) => ms === 15000)[0]
  await act(async () => callback())
  await screen.findByText('편안한 상태로 보여요')
  expect(mock.dashboard).toHaveBeenCalledTimes(2)
})

it('does not restore the old account after a slow response', async () => {
  let resolve
  mock.dashboard.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const page = render(view())
  mock.user = { id: 2 }; mock.token = 'two'
  mock.dashboard.mockResolvedValue({ currentEmotion: { ...result(), need: 'stable', emotion: '안정' } })
  mock.history.mockResolvedValue([])
  page.rerender(view())
  await screen.findByText('편안한 상태로 보여요')
  await act(async () => resolve({ currentEmotion: result() }))
  expect(screen.queryByText('배가 고픈 것 같아요')).toBeNull()
})

it('cancels a late upload before sending media after leaving home', async () => {
  let resolve
  mock.preprocess.mockImplementation(() => new Promise(done => { resolve = done }))
  const page = render(view())
  await screen.findByText('배가 고픈 것 같아요')
  fireEvent.change(screen.getByLabelText('분석할 영상 선택'), { target: { files: [new File(['video'], 'baby.mp4', { type: 'video/mp4' })] } })
  await waitFor(() => expect(mock.preprocess).toHaveBeenCalledTimes(1))
  page.unmount()
  await act(async () => resolve({ frameFiles: [new File(['frame'], 'frame.jpg')], audioFile: null }))
  expect(mock.upload).not.toHaveBeenCalled()
})

it('offers a direct link for a camera returned by this account',async()=>{
  mock.live.mockResolvedValue([{sessionId:'session-one',cameraName:'아기방 홈캠'}])
  render(view());await screen.findByText('아기방 홈캠')
  expect(screen.getByRole('link',{name:'라이브 보기'}).getAttribute('href')).toBe('/live?session=session-one')
  expect(screen.getByRole('link',{name:'홈캠 시작'}).getAttribute('href')).toBe('/camera-host')
})
