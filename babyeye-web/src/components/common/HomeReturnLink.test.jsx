import React from 'react'
import {afterEach,it,expect} from 'vitest'
import {cleanup,render,screen,fireEvent} from '@testing-library/react'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import HomeReturnLink from './HomeReturnLink'
afterEach(cleanup)
it.each(['/live','/camera-host','/settings','/notifications','/notifications/42','/reviews'])('returns home from %s without bottom tabs',path=>{
 render(<MemoryRouter initialEntries={[path]}><HomeReturnLink/><Routes><Route path="/" element={<p>홈 도착</p>}/><Route path="*" element={<p>상세 화면</p>}/></Routes></MemoryRouter>)
 fireEvent.click(screen.getByRole('link',{name:'홈으로'}));expect(screen.getByText('홈 도착')).toBeTruthy();expect(screen.queryByRole('link',{name:'홈으로'})).toBeNull()
})
it('does not show a redundant return button on home',()=>{
 render(<MemoryRouter><HomeReturnLink/></MemoryRouter>);expect(screen.queryByRole('link')).toBeNull()
})
