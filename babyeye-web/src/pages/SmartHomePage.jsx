import { Droplets, Lightbulb, Power, Thermometer, Wind } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { getLatestEnvironment } from '../api/environmentApi'
import { getSmartHomeDevices } from '../api/smartHomeApi'
import { useApi } from '../hooks/api/useApi'

const iconMap = {
  light: Lightbulb,
  humidifier: Droplets,
  air: Wind,
}

function SmartHomePage() {
  const environment = useApi(getLatestEnvironment, [])
  const devices = useApi(getSmartHomeDevices, [])

  const loading = environment.loading || devices.loading
  const error = environment.error || devices.error

  if (loading) {
    return (
      <main className='px-5 py-6'>
        <Header title='스마트홈' subtitle='아이 상태 기반 자동 환경 제어' />
        <Card>
          <p className='text-sm text-slate-300'>스마트홈 정보를 불러오는 중입니다...</p>
        </Card>
      </main>
    )
  }

  if (error) {
    return (
      <main className='px-5 py-6'>
        <Header title='스마트홈' subtitle='아이 상태 기반 자동 환경 제어' />
        <Card>
          <p className='font-semibold text-rose-300'>스마트홈 정보를 불러오지 못했습니다.</p>
          <p className='mt-2 text-sm text-slate-400'>{error.message}</p>
        </Card>
      </main>
    )
  }

  const environmentStatus = environment.data
  const smartHomeDevices = devices.data || []

  return (
    <main className='px-5 py-6'>
      <Header title='스마트홈' subtitle='아이 상태 기반 자동 환경 제어' />

      <Card className='mb-5'>
        <h2 className='mb-4 text-lg font-bold'>현재 환경</h2>

        <div className='grid grid-cols-2 gap-3'>
          <div className='rounded-2xl bg-slate-800/70 p-4'>
            <Thermometer size={24} className='mb-3 text-rose-300' />
            <p className='text-sm text-slate-400'>온도</p>
            <p className='mt-1 text-xl font-bold'>
              {environmentStatus?.temperature ?? '-'}°C
            </p>
          </div>

          <div className='rounded-2xl bg-slate-800/70 p-4'>
            <Droplets size={24} className='mb-3 text-blue-300' />
            <p className='text-sm text-slate-400'>습도</p>
            <p className='mt-1 text-xl font-bold'>
              {environmentStatus?.humidity ?? '-'}%
            </p>
          </div>
        </div>
      </Card>

      <Card className='mb-5'>
        <h2 className='mb-4 text-lg font-bold'>장면 모드</h2>

        <div className='space-y-3'>
          <div className='flex items-center justify-between rounded-2xl bg-slate-800/70 p-4'>
            <div>
              <p className='font-semibold'>수면 모드</p>
              <p className='mt-1 text-sm text-slate-400'>조명 낮춤 · 소음 최소화</p>
            </div>
            <StatusBadge type='info'>활성</StatusBadge>
          </div>

          <div className='flex items-center justify-between rounded-2xl bg-slate-800/70 p-4'>
            <div>
              <p className='font-semibold'>수유 모드</p>
              <p className='mt-1 text-sm text-slate-400'>조명 밝기 증가</p>
            </div>
            <span className='text-xs text-slate-500'>비활성</span>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className='mb-4 text-lg font-bold'>기기 제어</h2>

        {smartHomeDevices.length === 0 ? (
          <p className='text-sm text-slate-400'>등록된 스마트홈 기기가 없습니다.</p>
        ) : (
          <div className='space-y-3'>
            {smartHomeDevices.map((device) => {
              const Icon = iconMap[device.type] || Power
              const isOn = device.status === 'on'

              return (
                <div
                  key={device.id}
                  className='flex items-center justify-between rounded-2xl bg-slate-800/70 p-4'
                >
                  <div className='flex items-center gap-3'>
                    <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-700/80'>
                      <Icon size={22} className={isOn ? 'text-blue-300' : 'text-slate-500'} />
                    </div>

                    <div>
                      <p className='font-semibold'>{device.name}</p>
                      <p className='mt-1 text-sm text-slate-400'>
                        {device.description || '상태 설명이 없습니다.'}
                      </p>
                    </div>
                  </div>

                  <button
                    type='button'
                    className={
                      'h-8 w-14 rounded-full p-1 transition ' +
                      (isOn ? 'bg-blue-500' : 'bg-slate-700')
                    }
                  >
                    <span
                      className={
                        'block h-6 w-6 rounded-full bg-white transition ' +
                        (isOn ? 'translate-x-6' : 'translate-x-0')
                      }
                    />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </main>
  )
}

export default SmartHomePage
