
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Baby, LogIn } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err.status === 401
          ? '이메일 또는 비밀번호를 확인해주세요.'
          : '로그인에 실패했습니다. 잠시 후 다시 시도해주세요.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center px-6">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-500/20">
          <Baby size={40} className="text-blue-300" />
        </div>

        <h1 className="text-3xl font-bold text-white">
          BabyEye
        </h1>

        <p className="mt-3 text-sm text-slate-400">
          AI 기반 영아 상태 모니터링
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="login-email"
            className="mb-2 block text-sm text-slate-300"
          >
            이메일
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-400"
          />
        </div>

        <div>
          <label
            htmlFor="login-password"
            className="mb-2 block text-sm text-slate-300"
          >
            비밀번호
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호 입력"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-white outline-none focus:border-blue-400"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          <LogIn size={18} />
          {submitting ? '로그인 중...' : '로그인'}
        </button>
      </form>

      <p className="mt-8 text-center text-xs text-slate-500">
        계정 등록은 관리자에게 문의해주세요.
      </p>
    </div>
  )
}
