import React from 'react'
import {it,expect,afterEach} from 'vitest'
import {render,screen,cleanup} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import BottomNav from './BottomNav'
afterEach(cleanup)
it('shows only home, live and notification tabs',()=>{
 render(<MemoryRouter><BottomNav/></MemoryRouter>)
 expect(screen.getAllByRole('link').map(item=>item.textContent)).toEqual(['홈','라이브','알림'])
 expect(screen.queryByRole('link',{name:'육아 기록'})).toBeNull()
 expect(screen.queryByRole('link',{name:'설정'})).toBeNull()
})
