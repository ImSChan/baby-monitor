import { AlertCircle, Camera, Droplets, Lightbulb, Moon, Thermometer } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { getDashboard } from '../api/dashboardApi'
import { useApi } from '../hooks/api/useApi'

function HomePage() {
  const { data, loading, error } = useApi(getDashboard, [])

  if (loading) {
    return (
      <main className='px-5 py-6'>
        <Header />
        <Card>
          <p className='text-sm text-slate-300'>대시보드 정보를 불러오는 중입니다...</p>
        </Card>
      </main>
    )
  }

  if (error) {
    return (
      <main className='px-5 py-6'>
        <Header />
        <Card>
          <p className='font-semibold text-rose-300'>데이터를 불러오지 못했습니다.</p>
          <p className='mt-2 text-sm text-slate-400'>{error.message}</p>
        </Card>
      </main>
    )
  }

  const currentEmotion = data?.currentEmotion
  const environment = data?.environment
  const cameras = data?.cameras
  const alerts = data?.alerts || []
  const confidencePercent = Math.round((currentEmotion?.confidence || 0) * 100)

  return (
    <main className='px-5 py-6'>
      <Header />

      <section className='mb-5 overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-900 shadow-card'>
        <div className='relative flex h-56 items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950'>
          <div className='absolute left-4 top-4'>
            <StatusBadge type={cameras?.onlineCount > 0 ? 'normal' : 'warning'}>
              {cameras?.onlineCount > 0 ? 'LIVE' : 'OFFLINE'}
            </StatusBadge>
          </div>

          <div className='text-center'>
            <div className='mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/10'>
              <Camera size={32} className='text-blue-200' />
            </div>
            <p className='text-lg font-semibold'>아기 방 카메라</p>
            <p className='mt-1 text-sm text-slate-400'>
              등록 카메라 {cameras?.totalCount || 0}대 · 온라인 {cameras?.onlineCount || 0}대
            </p>
          </div>
        </div>

        <div className='p-5'>
          <div className='mb-3 flex items-center justify-between'>
            <div>
              <p className='text-sm text-slate-400'>현재 감정 상태</p>
              <h2 className='mt-1 text-2xl font-bold'>
                {currentEmotion?.emotion || '분석 대기'}
              </h2>
            </div>
            <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-400/15 text-indigo-200'>
              <Moon size={28} />
            </div>
          </div>

          <p className='text-sm leading-6 text-slate-300'>
            {currentEmotion?.message || '아직 분석된 감정 데이터가 없습니다.'}
          </p>

          <div className='mt-4'>
            <div className='mb-2 flex justify-between text-xs text-slate-400'>
              <span>AI 분석 신뢰도</span>
              <span>{confidencePercent}%</span>
            </div>
            <div className='h-2 rounded-full bg-slate-800'>
              <div
                className='h-2 rounded-full bg-blue-400'
                style={{ width: confidencePercent + '%' }}
              />
            </div>
          </div>
        </div>
      </section>

      <div className='mb-5 grid grid-cols-3 gap-3'>
        <Card className='p-4'>
          <Thermometer size={22} className='mb-3 text-rose-300' />
          <p className='text-xs text-slate-400'>온도</p>
          <p className='mt-1 text-lg font-bold'>
            {environment?.temperature ?? '-'}°C
          </p>
        </Card>

        <Card className='p-4'>
          <Droplets size={22} className='mb-3 text-blue-300' />
          <p className='text-xs text-slate-400'>습도</p>
          <p className='mt-1 text-lg font-bold'>
            {environment?.humidity ?? '-'}%
          </p>
        </Card>

        <Card className='p-4'>
          <Lightbulb size={22} className='mb-3 text-amber-300' />
          <p className='text-xs text-slate-400'>조명</p>
          <p className='mt-1 text-lg font-bold'>
            {environment?.light || '-'}
          </p>
        </Card>
      </div>

      <Card>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>최근 알림</h2>
          <AlertCircle size={20} className='text-slate-400' />
        </div>

        {alerts.length === 0 ? (
          <p className='text-sm text-slate-400'>최근 알림이 없습니다.</p>
        ) : (
          <div className='space-y-3'>
            {alerts.map((alert) => (
              <div key={alert.id} className='rounded-2xl bg-slate-800/70 p-4'>
                <div className='mb-1 flex items-center justify-between'>
                  <p className='font-semibold'>{alert.title}</p>
                  <span className='text-xs text-slate-500'>
                    {formatTime(alert.created_at)}
                  </span>
                </div>
                <p className='text-sm leading-5 text-slate-400'>
                  {alert.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  )
}

function formatTime(value) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default HomePage
