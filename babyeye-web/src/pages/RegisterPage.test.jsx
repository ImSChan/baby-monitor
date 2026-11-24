import React from 'react'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter,Routes,Route,useLocation } from 'react-router-dom'
import RegisterPage from './RegisterPage'
import LoginPage from './LoginPage'
const mock=vi.hoisted(()=>({post:vi.fn(),login:vi.fn(),user:null}))
vi.mock('../api/client',()=>({apiPost:mock.post}))
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:mock.user,login:mock.login})}))
afterEach(cleanup)
beforeEach(()=>{vi.clearAllMocks();mock.user=null;mock.post.mockResolvedValue({id:3});mock.login.mockResolvedValue({id:3})})
function Destination(){const location=useLocation();return <p>destination {location.pathname}{location.search}</p>}
function view(path='/register',from='/notifications/23'){
  return render(<MemoryRouter initialEntries={[{pathname:path,state:{from}}]}><Routes>
    <Route path="/register" element={<RegisterPage/>}/><Route path="/login" element={<LoginPage/>}/>
    <Route path="*" element={<Destination/>}/></Routes></MemoryRouter>)
}
function fill(){
  for(const [label,value] of [['아이디 (이메일)','new@example.com'],['비밀번호','test-password'],['비밀번호 확인','test-password'],['아이 이름 (별명)','별이'],['현재 월령 (개월)','7']])
    fireEvent.change(screen.getByLabelText(label),{target:{value}})
}
it('links from login and registers a profile, preserving the notification return path through login',async()=>{
  view('/login');fireEvent.click(screen.getByRole('link',{name:'회원가입'}));fill()
  fireEvent.click(screen.getByRole('button',{name:'가입하기'}))
  await screen.findByText('가입을 완료했어요. 로그인해주세요.')
  expect(mock.post).toHaveBeenCalledWith('/api/auth/register',{email:'new@example.com',password:'test-password',child_name:'별이',child_age_months:7})
  expect(screen.getByLabelText('아이디 (이메일)').value).toBe('new@example.com')
  fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'test-password'}})
  fireEvent.click(screen.getByRole('button',{name:'로그인'}))
  await screen.findByText('destination /notifications/23')
})
it('rejects mismatched passwords without sending a request',()=>{
  view();fill();fireEvent.change(screen.getByLabelText('비밀번호 확인'),{target:{value:'wrong-password'}})
  fireEvent.click(screen.getByRole('button',{name:'가입하기'}))
  expect(screen.getByRole('alert').textContent).toContain('일치하지');expect(mock.post).not.toHaveBeenCalled()
})
it.each([[409,'이미 가입한'],[403,'현재 회원가입이 꺼져'],[422,'입력 내용을 확인']])('shows useful signup error %s',async(status,message)=>{
  mock.post.mockRejectedValue({status});view();fill();fireEvent.click(screen.getByRole('button',{name:'가입하기'}))
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain(message))
})
it('does not follow external return URLs',async()=>{
  mock.user={id:1};view('/register','//evil.example');await screen.findByText('destination /')
})
