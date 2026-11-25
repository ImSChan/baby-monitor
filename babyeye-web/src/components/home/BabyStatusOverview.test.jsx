import React from 'react'
import {afterEach,beforeAll,afterAll,it,expect,vi} from 'vitest'
import {cleanup,render,screen,within,fireEvent} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import BabyStatusOverview from './BabyStatusOverview'
beforeAll(()=>{
 vi.stubGlobal('HTMLDialogElement',HTMLDialogElement)
 HTMLDialogElement.prototype.showModal=vi.fn(function(){this.setAttribute('open','')})
 HTMLDialogElement.prototype.close=vi.fn(function(){this.removeAttribute('open')})
})
afterAll(()=>{delete HTMLDialogElement.prototype.showModal;delete HTMLDialogElement.prototype.close;vi.unstubAllGlobals()})
afterEach(cleanup)
const show=result=>render(<MemoryRouter><BabyStatusOverview result={result}/></MemoryRouter>)
it('shows classification, small primary score and two ranked alternatives from one confirmed snapshot',()=>{
 show({need:'care',emotion:'불편함',confidence:.87,created_at:'2026-11-24T10:22:00',message:'돌봄이 필요한 것 같아요',topPredictions:[{need:'care',confidence:.87},{need:'feeding',confidence:.2},{need:'sleep',confidence:.12}]})
 const heading=screen.getByRole('heading',{name:'불편함',exact:true})
 expect(screen.getByText('87%')).toBeTruthy();expect(screen.getByText('20%')).toBeTruthy();expect(screen.getByText('12%')).toBeTruthy()
 expect(screen.getByText('2순위')).toBeTruthy();expect(screen.getByText('3순위')).toBeTruthy()
 const time=screen.getByText(/11.*24.*10:22.*분석/)
 expect(time.compareDocumentPosition(heading)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 expect(screen.queryByText('돌봄 필요')).toBeNull();expect(screen.queryByText('돌봄이 필요한 것 같아요')).toBeNull()
})
it('shows missing third-place data honestly for legacy two-candidate records',()=>{
 show({need:'feeding',confidence:.8,topPredictions:[{need:'feeding',confidence:.8},{need:'sleep',confidence:.1}]})
 expect(screen.getByText('기록 없음')).toBeTruthy();expect(screen.queryByText('0%')).toBeNull()
})
it('does not repeat the stable winner or invent alternative scores for a quiet override',()=>{
 show({need:'stable',confidence:1,topPredictions:[{need:'stable',confidence:1}]})
 expect(screen.getByRole('heading',{name:'안정'})).toBeTruthy();expect(screen.getAllByText('기록 없음')).toHaveLength(2)
})

it('never presents an old alert score as an average before samples are available',()=>{
 show({need:'care',confidence:null,aggregationPending:true,topPredictions:[]})
 expect(screen.getByRole('heading',{name:'불편함'})).toBeTruthy()
 expect(screen.getByText('평균 확인 중')).toBeTruthy();expect(screen.queryByText('87%')).toBeNull()
})

it('fills the gauge with the bound probability and hides the explanation until requested',()=>{
 show({need:'stable',confidence:.67})
 const gauge=screen.getByRole('img',{name:'예측 점수 67%'})
 expect(gauge.querySelector('[stroke-dasharray]').getAttribute('stroke-dasharray')).toBe('67 100')
 expect(gauge.querySelector('[stroke-dasharray]').getAttribute('stroke')).toBe('#34D399')
 expect(screen.queryByText('AI 예측 점수 · 같은 상태로 연속 감지된 3건의 평균')).toBeNull()
 const help=screen.getByRole('button',{name:'AI 예측 점수 설명'})
 fireEvent.click(help)
 expect(help.getAttribute('aria-expanded')).toBe('true')
 expect(screen.getByText('AI 예측 점수 · 같은 상태로 연속 감지된 3건의 평균')).toBeTruthy()
 fireEvent(screen.getByRole('dialog'),new Event('cancel',{cancelable:true}))
 expect(help.getAttribute('aria-expanded')).toBe('false')
 fireEvent.click(help);fireEvent.pointerDown(document.body)
 expect(help.getAttribute('aria-expanded')).toBe('false')
})
it('uses a warm attention color and never draws a percentage for an unknown average',()=>{
 const view=show({need:'feeding',confidence:.82})
 expect(screen.getByRole('img',{name:'예측 점수 82%'}).querySelector('[stroke-dasharray]').getAttribute('stroke')).toBe('#FBBF24')
 view.unmount();show({need:'feeding',confidence:.82,aggregationPending:true})
 expect(screen.getByRole('img',{name:'예측 점수 확인 중'}).querySelector('[stroke-dasharray]')).toBeNull()
 expect(screen.queryByText('82%')).toBeNull()
})

it('portals the help outside the card and dismisses it with the close button or backdrop',()=>{
 show({need:'stable',confidence:.67})
 const trigger=screen.getByRole('button',{name:'AI 예측 점수 설명'})
 fireEvent.click(trigger)
 const dialog=screen.getByRole('dialog',{name:'AI 예측 점수'})
 expect(screen.getByRole('region',{name:'최근 아기 상태'}).contains(dialog)).toBe(false)
 expect(dialog.parentElement).toBe(document.body)
 fireEvent.click(screen.getByText('AI 예측 점수 · 같은 상태로 연속 감지된 3건의 평균'))
 expect(screen.getByRole('dialog')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'도움말 닫기'}))
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(document.activeElement).toBe(trigger)
 fireEvent.click(trigger)
 fireEvent.click(screen.getByRole('dialog'),{clientX:-10,clientY:-10})
 expect(screen.queryByRole('dialog')).toBeNull()
})
