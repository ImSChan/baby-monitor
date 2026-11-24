import React from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {cleanup,render,screen,fireEvent} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import HomeLiveCard from './HomeLiveCard'
afterEach(cleanup)
const show=props=>render(<MemoryRouter><HomeLiveCard {...props}/></MemoryRouter>)
it('keeps both entry points available without a camera',()=>{
 show({});expect(screen.getByText('홈캠을 연결해 주세요')).toBeTruthy()
 expect(screen.getByRole('link',{name:'라이브 보기'}).getAttribute('href')).toBe('/live')
 expect(screen.getByRole('link',{name:'홈캠 시작'}).getAttribute('href')).toBe('/camera-host')
})
it('distinguishes initial loading from offline',()=>{
 show({loading:true});expect(screen.getByText('홈캠을 찾고 있어요')).toBeTruthy()
 expect(screen.getByRole('button',{name:'홈캠 연결 새로고침'}).disabled).toBe(true)
})
it('does not claim a cached camera is available after a failed check',()=>{
 const retry=vi.fn();show({sessions:[{sessionId:'stale',cameraName:'이전 홈캠'}],error:true,onRefresh:retry})
 expect(screen.getByText('연결 확인 필요')).toBeTruthy();expect(screen.queryByText('이전 홈캠')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'홈캠 연결 새로고침'}));expect(retry).toHaveBeenCalledOnce()
})
it('lists multiple cameras and encodes direct viewing links',()=>{
 show({sessions:[{sessionId:'room one',cameraName:'아기방'},{sessionId:'two',cameraName:'거실'}]})
 expect(screen.getByText('온라인 홈캠 2대')).toBeTruthy()
 expect(screen.getByRole('link',{name:'아기방 보기'}).getAttribute('href')).toBe('/live?session=room%20one')
 expect(screen.getByRole('link',{name:'라이브 보기'}).getAttribute('href')).toBe('/live')
})
