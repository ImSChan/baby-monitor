import React from 'react'
import {afterEach,it,expect} from 'vitest'
import {cleanup,render,screen,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import BabyStatusOverview from './BabyStatusOverview'
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
