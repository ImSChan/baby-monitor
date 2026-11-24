import React from 'react'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import LivePage from './LivePage'
const mock=vi.hoisted(()=>({sessions:[],start:vi.fn()}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:{id:1}})}))
vi.mock('../api/authToken',()=>({getAccessToken:()=> 'token'}))
vi.mock('../api/cameraApi',()=>({getCameras:vi.fn(async()=>[]),createCamera:vi.fn()}))
vi.mock('../api/liveApi',()=>({getLiveSessions:vi.fn(async()=>mock.sessions)}))
vi.mock('../hooks/useLiveConnection',()=>({useLiveViewer:()=>({start:mock.start,stop:vi.fn(),selectedSession:null,connecting:false,status:'대기'})}))
vi.mock('../hooks/useVideoFreshness',()=>({default:()=>({phase:'idle'})}))
vi.mock('../hooks/useAccountStatus',()=>({default:()=>({data:null,error:null})}))
beforeEach(()=>{mock.sessions=[{sessionId:'mine',cameraName:'아기방 홈캠'}];mock.start.mockReset()})
afterEach(cleanup)
it('connects the camera selected from home exactly once after the owned session list loads',async()=>{
 const view=()=> <MemoryRouter initialEntries={['/live?session=mine']}><LivePage/></MemoryRouter>
 const page=render(view());await waitFor(()=>expect(mock.start).toHaveBeenCalledExactlyOnceWith(mock.sessions[0]))
 page.rerender(view());expect(mock.start).toHaveBeenCalledTimes(1)
})
it('does not connect an unknown or other-account session supplied in the URL',async()=>{
 render(<MemoryRouter initialEntries={['/live?session=not-mine']}><LivePage/></MemoryRouter>)
 await screen.findByText('아기방 홈캠');expect(mock.start).not.toHaveBeenCalled()
})
