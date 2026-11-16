import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CarePage from './CarePage'
const mock=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),user:{id:1}}))
vi.mock('../api/client',()=>({apiGet:mock.get,apiPost:mock.post}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:mock.user})}))
const info={ageMonths:10,contextEnabled:true,context:{lastMealAt:null,recordedSleepMinutes24h:0}}
const view=()=> <MemoryRouter><CarePage/></MemoryRouter>
beforeEach(()=>{
  vi.clearAllMocks();mock.user={id:1}
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
  mock.get.mockImplementation(async path=>path.includes('/summary')?info:{items:[]})
  mock.post.mockResolvedValue({})
})
afterEach(cleanup)

it('saves feeding with a simple time picker and one explicit submit',async()=>{
  render(view());await screen.findByText('아직 기록이 없어요. 방금 먹거나 잔 시간부터 남겨보세요.')
  fireEvent.click(screen.getByRole('button',{name:/식사 기록/}))
  const dialog=screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button',{name:'수유'}))
  expect(mock.post).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button',{name:'기록 저장'}))
  await waitFor(()=>expect(mock.post).toHaveBeenCalledTimes(1))
  expect(mock.post.mock.calls[0][1]).toMatchObject({kind:'feeding',meal_type:'milk',ended_at:null})
  expect(new Date(mock.post.mock.calls[0][1].started_at).getTime()).toBeLessThanOrEqual(Date.now())
})

it('provides drag and accessible sliders for the sleep interval',async()=>{
  render(view());await screen.findByText('아직 기록이 없어요. 방금 먹거나 잔 시간부터 남겨보세요.')
  fireEvent.click(screen.getByRole('button',{name:/수면 기록/}))
  expect(screen.getByTestId('sleep-drag-track')).toBeTruthy()
  expect(screen.getByRole('slider',{name:'잠든 시각 조절'})).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'기록 저장'}))
  await waitFor(()=>expect(mock.post).toHaveBeenCalledTimes(1))
  const payload=mock.post.mock.calls[0][1]
  expect(payload.kind).toBe('sleep');expect(new Date(payload.ended_at)>new Date(payload.started_at)).toBe(true)
})

it('cancels a form without creating a record',async()=>{
  render(view());await screen.findByText('아직 기록이 없어요. 방금 먹거나 잔 시간부터 남겨보세요.')
  fireEvent.click(screen.getByRole('button',{name:/식사 기록/}));fireEvent.click(screen.getByRole('button',{name:'기록 창 닫기'}))
  expect(mock.post).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull()
})

it('disables context prospectively and preserves recorded sleep display',async()=>{
  render(view());const toggle=await screen.findByRole('checkbox',{name:'AI 판단에 육아 기록 참고'})
  fireEvent.click(toggle)
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/api/care/preferences',{context_enabled:false}))
  await screen.findByText('다음 분석부터 설정을 적용해요.')
  expect(screen.getByText('24시간에 기록된 수면: 0시간')).toBeTruthy()
})

it('requires explicit deletion and sends the record revision',async()=>{
  mock.get.mockImplementation(async path=>path.includes('/summary')?info:{items:[{id:'record',kind:'feeding',mealType:'meal',startedAt:new Date().toISOString(),revision:3}]})
  render(view());fireEvent.click(await screen.findByRole('button',{name:'삭제'}))
  expect(mock.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'삭제하기'}))
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/api/care/records/record/delete?expected_revision=3',{}))
})

it('ignores the previous account while loading records',async()=>{
  let resolve;mock.get.mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
  const page=render(view());mock.user={id:2};page.rerender(view())
  await screen.findByText('아직 기록이 없어요. 방금 먹거나 잔 시간부터 남겨보세요.')
  await act(async()=>resolve({items:[{id:'old',kind:'feeding',mealType:'snack',startedAt:new Date().toISOString(),revision:1}]}))
  expect(screen.queryByText('🍌 간식')).toBeNull()
})
