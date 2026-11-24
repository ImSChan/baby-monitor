import React from 'react'
import { beforeEach,afterEach,it,expect,vi } from 'vitest'
import { render,screen,fireEvent,cleanup } from '@testing-library/react'
import { MemoryRouter,Routes,Route } from 'react-router-dom'
import Header from './Header'
const mock=vi.hoisted(()=>({notification:null}))
vi.mock('../../contexts/NotificationContext',()=>({useNotifications:()=>mock.notification}))
beforeEach(()=>{mock.notification=null})
afterEach(cleanup)
it.each([
 ['no unread notifications',{unreadCount:0}],
 ['notifications disabled',{unreadCount:0,enabled:false}],
 ['preferences loading',{unreadCount:0,loading:true}],
 ['preferences unavailable',{unreadCount:0,error:'offline'}],
 ['all notifications read',{unreadCount:0,received:null}],
 ['unread notifications',{unreadCount:2}],
 ['provider not yet available',null],
])('always opens the notification list with %s',(_,notification)=>{
 mock.notification=notification
 render(<MemoryRouter><Routes><Route path="/" element={<Header/>}/><Route path="/notifications" element={<p>알림 목록 도착</p>}/></Routes></MemoryRouter>)
 const button=screen.getByRole('button',{name:/^알림/})
 expect(button.disabled).toBe(false)
 expect(Boolean(screen.queryByTestId('notification-unread-dot'))).toBe(Boolean(notification?.unreadCount))
 fireEvent.click(button)
 expect(screen.getByText('알림 목록 도착')).toBeTruthy()
})
