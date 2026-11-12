import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import ReviewEditor from './ReviewEditor'
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), user: { id: 1 } }))
vi.mock('../../api/client', () => ({ apiGet: mock.get, apiPost: mock.post, getApiBaseUrl: () => 'http://localhost' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
const data = () => ({ eventId: 3, anchorRequestId: 'b', items: ['a', 'b', 'c'].map(requestId => ({ requestId,
  result: { emotion: '배고픔' }, capturedAt: '2026-11-12T09:00:00+09:00', available: true, feedback: null })) })
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mock.user = { id: 1 }; mock.get.mockResolvedValue(data()); mock.post.mockResolvedValue({ actionId: 'undo-id', count: 1 }) })

it('submits one explicit state in one click, never on view, and supports undo', async () => {
  render(<ReviewEditor eventId={3} />)
  const state = await screen.findByRole('button', { name: '졸렸어요' })
  expect(mock.post).not.toHaveBeenCalled()
  fireEvent.click(state)
  await screen.findByText('1개 분석에 반영했어요.')
  expect(mock.post.mock.calls[0][1]).toMatchObject({ event_id: 3, request_ids: ['b'], label: 'sleep', expected_versions: { b: null } })
  fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
  await screen.findByText('이전 응답으로 되돌렸어요.')
  expect(mock.post.mock.calls[1][0]).toBe('/api/reviews/feedback/undo-id/undo')
})

it('shows the range and overwrite count before explicit bulk apply', async () => {
  const context = data(); context.items[0].feedback = { updated_at: 'v1', training_status: 'pending', corrected_label: 'feeding' }
  mock.get.mockResolvedValue(context)
  render(<ReviewEditor eventId={3} />)
  fireEvent.click(await screen.findByRole('button', { name: '구간 선택하여 일괄 응답' }))
  fireEvent.change(screen.getByLabelText('분석 시점 이동'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '여기부터' }))
  fireEvent.change(screen.getByLabelText('분석 시점 이동'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: '여기까지' }))
  expect(screen.getByText('기존 응답 1개를 변경합니다.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '배고팠어요' }))
  expect(mock.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '선택한 3개에 적용' }))
  await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1))
  expect(mock.post.mock.calls[0][1]).toMatchObject({ request_ids: ['a', 'b', 'c'], label: 'feeding', expected_versions: { a: 'v1', b: null, c: null } })
})

it('blocks editing reserved training feedback', async () => {
  const context = data(); context.items[1].feedback = { training_status: 'reserved', corrected_label: 'feeding' }
  mock.get.mockResolvedValue(context)
  render(<ReviewEditor eventId={3} />)
  expect((await screen.findByRole('button', { name: '졸렸어요' })).disabled).toBe(true)
  expect(mock.post).not.toHaveBeenCalled()
})

it('shows a conflict without claiming it was saved', async () => {
  mock.post.mockRejectedValue(new Error('피드백이 변경되었습니다.'))
  render(<ReviewEditor eventId={3} />)
  fireEvent.click(await screen.findByRole('button', { name: '잘 모르겠어요' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('1개 분석에 반영했어요.')).toBeNull()
})
