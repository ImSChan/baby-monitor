import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Baby } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { apiPost } from '../api/client'
import { safeReturnPath } from '../utils/pushRoute'

export default function RegisterPage() {
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate()
  const returnTo = safeReturnPath(location.state?.from)
  const [form,setForm] = useState({email:'',password:'',confirm:'',child_name:'',child_age_months:''})
  const [busy,setBusy] = useState(false), [error,setError] = useState('')
  const field = key => ({value:form[key],onChange:e=>setForm({...form,[key]:e.target.value})})
  if(user) return <Navigate to={returnTo} replace/>
  async function submit(e) {
    e.preventDefault();setError('')
    if(form.password!==form.confirm){setError('비밀번호가 일치하지 않아요.');return}
    setBusy(true)
    try {
      await apiPost('/api/auth/register',{email:form.email.trim(),password:form.password,
        child_name:form.child_name.trim(),child_age_months:Number(form.child_age_months)})
      navigate('/login',{replace:true,state:{from:returnTo,registered:true,email:form.email.trim()}})
    } catch(err) {
      setError(err.status===409?'이미 가입한 아이디예요. 로그인해주세요.':err.status===403?'현재 회원가입이 꺼져 있어요. 관리자에게 문의해주세요.':err.status===422?'입력 내용을 확인해주세요. 비밀번호는 8자 이상, 월령은 0~71개월이에요.':'가입하지 못했어요. 잠시 후 다시 시도해주세요.')
    } finally {setBusy(false)}
  }
  return <main className="mx-auto min-h-screen w-full max-w-md px-6 py-10 text-white">
    <Baby size={40} className="mb-4 text-blue-300"/><h1 className="text-2xl font-bold">회원가입</h1>
    <p className="mb-6 mt-2 text-sm text-slate-400">계정과 아이 정보를 입력해주세요. 이메일 인증은 하지 않아요.</p>
    <form onSubmit={submit}><fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">아이디 (이메일)<input required type="email" autoComplete="username" maxLength={255} {...field('email')} className="mt-2 w-full rounded-xl bg-slate-800 p-3"/></label>
      <label className="block text-sm">비밀번호<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} {...field('password')} className="mt-2 w-full rounded-xl bg-slate-800 p-3"/></label>
      <p className="text-xs text-slate-400">8~128자로 입력해주세요.</p>
      <label className="block text-sm">비밀번호 확인<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} {...field('confirm')} className="mt-2 w-full rounded-xl bg-slate-800 p-3"/></label>
      <label className="block text-sm">아이 이름 (별명)<input required maxLength={100} {...field('child_name')} className="mt-2 w-full rounded-xl bg-slate-800 p-3"/></label>
      <label className="block text-sm">현재 월령 (개월)<input required type="number" inputMode="numeric" min={0} max={71} step={1} {...field('child_age_months')} className="mt-2 w-full rounded-xl bg-slate-800 p-3"/></label>
      <p className="text-xs leading-5 text-slate-400">태어난 달은 0개월이에요. 입력일을 기준으로 매달 추정 월령이 늘어나요. 홈의 기록 입력 창에서 수정할 수 있어요.</p>
      {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
      <button className="w-full rounded-xl bg-blue-600 p-3 font-semibold disabled:opacity-50">{busy?'가입 중…':'가입하기'}</button>
    </fieldset></form>
    <Link to="/login" state={{from:returnTo}} className="mt-6 block text-center text-sm text-blue-300 underline">로그인으로 돌아가기</Link>
  </main>
}
