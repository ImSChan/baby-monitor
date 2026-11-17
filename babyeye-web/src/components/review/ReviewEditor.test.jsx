import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import ReviewEditor from './ReviewEditor'
const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), user: { id: 1 } }))
vi.mock('../../api/client', () => ({ apiGet: mock.get, apiPost: mock.post, getApiBaseUrl: () => 'http://localhost' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }))
const data = () => ({ eventId: 3, matchedCount: 6, scopeSignature: 'a'.repeat(64) })
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mock.user = { id: 1 }; mock.get.mockResolvedValue(data()); mock.post.mockResolvedValue({ actionId: 'undo-id', count: 6 }) })

it('submits one explicit state in one click, never on view, and supports undo', async () => {
  render(<ReviewEditor eventId={3} />)
  const state = await screen.findByRole('button', { name: '졸렸어요' })
  expect(mock.post).not.toHaveBeenCalled()
  fireEvent.click(state)
  await screen.findByText('6개 분석에 일괄 반영했어요.')
  expect(mock.post.mock.calls[0][1]).toMatchObject({ event_id: 3, label: 'sleep', scope_signature: 'a'.repeat(64) })
  fireEvent.click(screen.getByRole('button', { name: '실행 취소' }))
  await screen.findByText('이전 응답으로 되돌렸어요.')
  expect(mock.post.mock.calls[1][0]).toBe('/api/reviews/feedback/undo-id/undo')
})

it('exposes no range, frame or individual analysis controls', async () => {
  render(<ReviewEditor eventId={3} />)
  await screen.findByRole('button', { name: '졸렸어요' })
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByText('구간 선택하여 일괄 응답')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '배고팠어요' }))
  await waitFor(() => expect(mock.post).toHaveBeenCalledTimes(1))
  expect(Object.keys(mock.post.mock.calls[0][1]).sort()).toEqual(['action_id', 'event_id', 'label', 'scope_signature'])
})

it('reuses the action id when retrying a lost response', async () => {
  mock.post.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ actionId: 'undo-id', count: 6 })
  render(<ReviewEditor eventId={3} />)
  fireEvent.click(await screen.findByRole('button', { name: '졸렸어요' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '졸렸어요' }))
  await screen.findByText('6개 분석에 일괄 반영했어요.')
  expect(mock.post.mock.calls[0][1]).toEqual(mock.post.mock.calls[1][1])
})

it('shows a conflict without claiming it was saved', async () => {
  mock.post.mockRejectedValue(new Error('피드백이 변경되었습니다.'))
  render(<ReviewEditor eventId={3} />)
  fireEvent.click(await screen.findByRole('button', { name: '잘 모르겠어요' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('6개 분석에 일괄 반영했어요.')).toBeNull()
})
