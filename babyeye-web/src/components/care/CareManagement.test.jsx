import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CareManagement from './CareManagement'
const mock=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),user:{id:1}}))
vi.mock('../../api/client',()=>({apiGet:mock.get,apiPost:mock.post}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:mock.user})}))
const info={childName:"별이",ageMonths:10,contextEnabled:true,context:{lastMealAt:null,recordedSleepMinutes24h:0}}
const view=(mode='history')=> <MemoryRouter><CareManagement mode={mode}/></MemoryRouter>
beforeEach(()=>{
  vi.clearAllMocks();mock.user={id:1}
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
  mock.get.mockImplementation(async path=>path.includes('/summary')?info:{items:[]})
  mock.post.mockResolvedValue({})
})
afterEach(cleanup)

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

 it('lets existing users save child age and reload the summary',async()=>{
  render(view('settings'));fireEvent.click(await screen.findByRole('button',{name:'아이 정보 수정'}))
  fireEvent.change(screen.getByLabelText('현재 월령 (개월)'),{target:{value:'14'}})
  fireEvent.click(screen.getByRole('button',{name:'아이 정보 저장'}))
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/api/care/profile',{child_name:'별이',child_age_months:14}))
  await screen.findByText('아이 정보를 저장했어요. 다음 분석부터 적용해요.')
})

it('edits a sleep record inline with the original drag picker and revision guard',async()=>{
  mock.get.mockImplementation(async path=>path.includes('/summary')?info:{items:[{id:'sleep',kind:'sleep',startedAt:new Date(Date.now()-7200000).toISOString(),endedAt:new Date(Date.now()-3600000).toISOString(),revision:4}]})
  render(view());fireEvent.click(await screen.findByRole('button',{name:'수정'}))
  expect(screen.getByTestId('sleep-drag-track')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'기록 저장'}))
  await waitFor(()=>expect(mock.post).toHaveBeenCalledWith('/api/care/records/sleep',expect.objectContaining({expected_revision:4,kind:'sleep'})))
})

it('restores the context switch if preference saving fails',async()=>{
  mock.post.mockRejectedValueOnce(new Error('offline'))
  render(view('settings'));const toggle=await screen.findByRole('checkbox',{name:'AI 판단에 육아 기록 참고'})
  fireEvent.click(toggle);expect(toggle.checked).toBe(false)
  await screen.findByText('offline');expect(toggle.checked).toBe(true)
})
