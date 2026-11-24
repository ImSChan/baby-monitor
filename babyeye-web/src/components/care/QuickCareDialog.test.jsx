import React from 'react'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CareContextNote from './CareContextNote'
import { localInput } from '../../utils/careTime'
const mock=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),token:'one'}))
vi.mock('../../api/client',()=>({apiGet:mock.get,apiPost:mock.post}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:{id:1}})}))
vi.mock('../../api/authToken',()=>({getAccessToken:()=>mock.token}))
beforeEach(()=>{
  vi.resetAllMocks();mock.token='one';mock.get.mockResolvedValue({ageMonths:10,contextEnabled:true});mock.post.mockResolvedValue({})
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
})
afterEach(cleanup)
async function open(){
  render(<MemoryRouter><CareContextNote/></MemoryRouter>)
  fireEvent.click(screen.getByRole('button',{name:/육아기록으로 더 정확하게 판단하기/}))
  await screen.findByRole('dialog',{name:'마지막 수면 · 식사 기록'})
}
function fillSleep(){
  fireEvent.change(screen.getByLabelText('잠든 시각'),{target:{value:localInput(Date.now()-3*3600000)}})
  fireEvent.change(screen.getByLabelText('깬 시각'),{target:{value:localInput(Date.now()-3600000)}})
}
function save(){fireEvent.click(screen.getByRole('button',{name:'입력한 기록 저장'}))}
it('opens without an analysis snapshot and saves both records through existing APIs',async()=>{
  await open();fillSleep();fireEvent.click(screen.getByRole('button',{name:'방금 먹었어요'}));save()
  await screen.findByText('기록했어요. 다음 분석부터 참고해요.')
  expect(mock.post).toHaveBeenCalledTimes(2)
  expect(mock.post.mock.calls.map(call=>call[1].kind)).toEqual(['sleep','feeding'])
  expect(mock.post.mock.calls[0][1].ended_at).toBeTruthy()
  expect(mock.post.mock.calls[1][1].ended_at).toBeNull()
  expect(mock.post.mock.calls[0][1].id).not.toBe(mock.post.mock.calls[1][1].id)
})
it('saves only the known feeding time',async()=>{
  await open();fireEvent.click(screen.getByRole('button',{name:'수유'}))
  fireEvent.click(screen.getByRole('button',{name:'방금 먹었어요'}));save()
  await screen.findByText('기록했어요. 다음 분석부터 참고해요.')
  expect(mock.post).toHaveBeenCalledTimes(1);expect(mock.post.mock.calls[0][1]).toMatchObject({kind:'feeding',meal_type:'milk'})
})
it('requires some input and both sleep endpoints',async()=>{
  await open();save();expect(screen.getByRole('alert').textContent).toContain('시간을 입력')
  fireEvent.change(screen.getByLabelText('잠든 시각'),{target:{value:localInput(Date.now()-3600000)}});save()
  expect(screen.getByRole('alert').textContent).toContain('모두 입력');expect(mock.post).not.toHaveBeenCalled()
})
it('keeps successful sleep saved when feeding fails, then retries only feeding with the same id',async()=>{
  mock.post.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
  await open();fillSleep();fireEvent.click(screen.getByRole('button',{name:'방금 먹었어요'}));save()
  await screen.findByText('offline');expect(screen.getByLabelText('잠든 시각').closest('fieldset').disabled).toBe(true)
  save();await screen.findByText('기록했어요. 다음 분석부터 참고해요.')
  expect(mock.post.mock.calls.map(call=>call[1].kind)).toEqual(['sleep','feeding','feeding'])
  expect(mock.post.mock.calls[1][1].id).toBe(mock.post.mock.calls[2][1].id)
})
it('stops a second save if the login account changes during the first request',async()=>{
  mock.post.mockImplementationOnce(async()=>{mock.token='two';return {}})
  await open();fillSleep();fireEvent.click(screen.getByRole('button',{name:'방금 먹었어요'}));save()
  await screen.findByText('로그인 계정이 변경됐어요. 다시 열어주세요.')
  expect(mock.post).toHaveBeenCalledTimes(1)
  save();expect(mock.post).toHaveBeenCalledTimes(1)
})
it('preserves disabled context settings and offers profile guidance instead of changing preferences',async()=>{
  mock.get.mockResolvedValue({contextEnabled:false,ageMonths:null});await open()
  await screen.findByText(/육아 기록 참고가 꺼져/);expect(screen.getByRole('button',{name:'아이 정보도 입력해주세요.'})).toBeTruthy()
  expect(mock.post).not.toHaveBeenCalled()
})

it('uses drag sliders and keeps the preview unselected until the parent chooses it',async()=>{
  await open();expect(screen.getByTestId('sleep-drag-track')).toBeTruthy()
  expect(screen.getByRole('checkbox',{name:'이 수면 구간 기록'}).checked).toBe(false)
  fireEvent.change(screen.getByRole('slider',{name:'잠든 시각 조절'}),{target:{value:'100'}})
  expect(screen.getByRole('checkbox',{name:'이 수면 구간 기록'}).checked).toBe(true)
  fireEvent.click(screen.getByRole('checkbox',{name:'이 수면 구간 기록'}))
  fireEvent.click(screen.getByRole('button',{name:'방금 먹었어요'}));save()
  await screen.findByText('기록했어요. 다음 분석부터 참고해요.')
  expect(mock.post).toHaveBeenCalledTimes(1);expect(mock.post.mock.calls[0][1].kind).toBe('feeding')
})

it('opens the settings panel from a legacy/profile query without a care page',async()=>{
  mock.get.mockImplementation(async path=>path.includes('/summary')?{ageMonths:10,childName:'별이',contextEnabled:true,context:{}}:{items:[]})
  render(<MemoryRouter initialEntries={['/?care=settings']}><CareContextNote/></MemoryRouter>)
  await screen.findByRole('button',{name:'아이 정보 수정'})
  expect(screen.getByRole('tab',{name:'아이·설정'}).getAttribute('aria-selected')).toBe('true')
  fireEvent.click(screen.getByRole('button',{name:'빠른 기록 닫기'}));expect(screen.queryByRole('dialog')).toBeNull()
})
