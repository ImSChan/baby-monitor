import { Camera, Moon, Thermometer, Droplets, Lightbulb, AlertCircle } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { currentEmotion } from '../data/emotionData'
import { environmentStatus } from '../data/environmentData'
import { recentAlerts } from '../data/alertData'

function HomePage() {
  return (
    <main className='px-5 py-6'>
      <Header />

      <section className='mb-5 overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-900 shadow-card'>
        <div className='relative flex h-56 items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950'>
          <div className='absolute left-4 top-4'>
            <StatusBadge type='normal'>LIVE</StatusBadge>
          </div>

          <div className='text-center'>
            <div className='mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/10'>
              <Camera size={32} className='text-blue-200' />
            </div>
            <p className='text-lg font-semibold'>아기 방 카메라</p>
            <p className='mt-1 text-sm text-slate-400'>실시간 모니터링 중</p>
          </div>
        </div>

        <div className='p-5'>
          <div className='mb-3 flex items-center justify-between'>
            <div>
              <p className='text-sm text-slate-400'>현재 감정 상태</p>
              <h2 className='mt-1 text-2xl font-bold'>{currentEmotion.label}</h2>
            </div>
            <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-400/15 text-indigo-200'>
              <Moon size={28} />
            </div>
          </div>

          <p className='text-sm leading-6 text-slate-300'>
            {currentEmotion.description}
          </p>

          <div className='mt-4'>
            <div className='mb-2 flex justify-between text-xs text-slate-400'>
              <span>AI 분석 신뢰도</span>
              <span>{currentEmotion.confidence}%</span>
            </div>
            <div className='h-2 rounded-full bg-slate-800'>
              <div
                className='h-2 rounded-full bg-blue-400'
                style={{ width: currentEmotion.confidence + '%' }}
              />
            </div>
          </div>
        </div>
      </section>

      <div className='mb-5 grid grid-cols-3 gap-3'>
        <Card className='p-4'>
          <Thermometer size={22} className='mb-3 text-rose-300' />
          <p className='text-xs text-slate-400'>온도</p>
          <p className='mt-1 text-lg font-bold'>{environmentStatus.temperature}°C</p>
        </Card>

        <Card className='p-4'>
          <Droplets size={22} className='mb-3 text-blue-300' />
          <p className='text-xs text-slate-400'>습도</p>
          <p className='mt-1 text-lg font-bold'>{environmentStatus.humidity}%</p>
        </Card>

        <Card className='p-4'>
          <Lightbulb size={22} className='mb-3 text-amber-300' />
          <p className='text-xs text-slate-400'>조명</p>
          <p className='mt-1 text-lg font-bold'>{environmentStatus.light}</p>
        </Card>
      </div>

      <Card>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>최근 알림</h2>
          <AlertCircle size={20} className='text-slate-400' />
        </div>

        <div className='space-y-3'>
          {recentAlerts.map((alert) => (
            <div key={alert.id} className='rounded-2xl bg-slate-800/70 p-4'>
              <div className='mb-1 flex items-center justify-between'>
                <p className='font-semibold'>{alert.title}</p>
                <span className='text-xs text-slate-500'>{alert.time}</span>
              </div>
              <p className='text-sm leading-5 text-slate-400'>
                {alert.description}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </main>
  )
}

export default HomePage
