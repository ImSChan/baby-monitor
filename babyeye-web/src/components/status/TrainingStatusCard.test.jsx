import React from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TrainingStatusCard from './TrainingStatusCard'
const mock = vi.hoisted(() => ({ state: {} }))
vi.mock('../../hooks/useAccountStatus', () => ({ default: () => mock.state }))
afterEach(cleanup)
beforeEach(() => { mock.state = { data: { stage: 'review_ready', feedback: { total: 6, excluded: 1, lastSavedAt: null }, jobs: { queued: 0, running: 0 }, latestJob: null, activation: { availability: 'available', models: [] } }, error: '', retry: vi.fn() } })
it('distinguishes completed training from applied models and explains bulk counts', () => {
  render(<TrainingStatusCard />)
  expect(screen.getByText('학습 완료 · 검토 대기')).toBeTruthy()
  expect(screen.queryByText('개인화 모델 적용 등록됨')).toBeNull()
  fireEvent.click(screen.getByText('저장 및 적용 내역'))
  expect(screen.getByText('피드백을 적용한 분석 6개 · 학습 제외 1개')).toBeTruthy()
})
it('shows registered modalities alongside a newer running job', () => {
  mock.state.data.stage = 'training'
  mock.state.data.activation.models = [{ modality: 'audio', jobId: 7, activatedAt: '2026-11-18T01:00:00+00:00' }]
  render(<TrainingStatusCard />)
  expect(screen.getByText('개인화 학습 중이에요')).toBeTruthy()
  expect(screen.getByText(/음성 모델 적용 등록:/)).toBeTruthy()
})
it('does not claim an activation when the server cannot observe it', () => {
  mock.state.data.stage = 'completed_unknown'; mock.state.data.activation.availability = 'unavailable'
  render(<TrainingStatusCard />)
  expect(screen.getByText('학습 완료 · 적용 확인 필요')).toBeTruthy()
  expect(screen.queryByText('개인화 모델 적용 등록됨')).toBeNull()
})
it('marks stale data and offers retry on API failure', () => {
  mock.state.error = '상태를 갱신하지 못했어요.'
  render(<TrainingStatusCard />)
  fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
  expect(mock.state.retry).toHaveBeenCalledOnce()
})
