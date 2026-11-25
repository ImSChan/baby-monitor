import React from 'react'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import LiveAnalysisHistory from './LiveAnalysisHistory'
const mock=vi.hoisted(()=>({state:{},status:vi.fn(),retry:vi.fn(),user:{id:1}}))
vi.mock('../../hooks/useAccountStatus',()=>({default:mock.status}))
vi.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:mock.user})}))
beforeEach(()=>{vi.clearAllMocks();mock.user={id:1};mock.state={data:[],error:'',retry:mock.retry};mock.status.mockImplementation(()=>mock.state)})
afterEach(cleanup)
it('shows the latest 20 counts and expandable records in the live panel',()=>{
 mock.state.data=Array.from({length:25},(_,i)=>({id:i,need:i%2?'feeding':'care',confidence:.8,created_at:'2026-11-25T10:00:00'}))
 render(<LiveAnalysisHistory/>);expect(screen.getByText('최근 20건 기준 · 분석 횟수')).toBeTruthy()
 expect(screen.getAllByRole('listitem')).toHaveLength(4)
 fireEvent.click(screen.getByRole('button',{name:'분석 기록 20건 모두 보기'}));expect(screen.getAllByRole('listitem')).toHaveLength(20)
 expect(mock.status).toHaveBeenCalledWith('/api/emotions/history',{intervalMs:5000})
})
it('supports retry and preserves known records during refresh errors',()=>{
 mock.state={data:[{id:1,need:'feeding',confidence:.9}],error:'offline',retry:mock.retry}
 render(<LiveAnalysisHistory/>);expect(screen.getByText('90%')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'분석 새로고침'}));expect(mock.retry).toHaveBeenCalledOnce()
})
it('separates empty and initial loading states',()=>{
 const page=render(<LiveAnalysisHistory/>);expect(screen.getByText('아직 분석 기록이 없어요.')).toBeTruthy()
 mock.state.data=null;page.rerender(<LiveAnalysisHistory/>);expect(screen.getByText('기록을 불러오는 중…')).toBeTruthy()
})
it('resets expanded rows on an account change',()=>{
 mock.state.data=Array.from({length:8},(_,i)=>({id:i,need:'feeding',confidence:.9}))
 const page=render(<LiveAnalysisHistory/>);fireEvent.click(screen.getByRole('button',{name:'분석 기록 8건 모두 보기'}))
 mock.user={id:2};page.rerender(<LiveAnalysisHistory/>);expect(screen.getAllByRole('listitem')).toHaveLength(4)
})
