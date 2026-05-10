import { Camera, Wifi, WifiOff } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { getCameras } from '../api/cameraApi'
import { useApi } from '../hooks/api/useApi'

function LivePage() {
  const { data: cameras, loading, error } = useApi(getCameras, [])

  if (loading) {
    return (
      <main className='px-5 py-6'>
        <Header title='라이브 피드' subtitle='실시간 카메라 화면 확인' />
        <Card>
          <p className='text-sm text-slate-300'>카메라 정보를 불러오는 중입니다...</p>
        </Card>
      </main>
    )
  }

  if (error) {
    return (
      <main className='px-5 py-6'>
        <Header title='라이브 피드' subtitle='실시간 카메라 화면 확인' />
        <Card>
          <p className='font-semibold text-rose-300'>카메라 정보를 불러오지 못했습니다.</p>
          <p className='mt-2 text-sm text-slate-400'>{error.message}</p>
        </Card>
      </main>
    )
  }

  const cameraList = cameras || []
  const mainCamera = cameraList[0]

  return (
    <main className='px-5 py-6'>
      <Header title='라이브 피드' subtitle='실시간 카메라 화면 확인' />

      <section className='mb-5 overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-900 shadow-card'>
        <div className='relative flex h-72 items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950'>
          <div className='absolute left-4 top-4'>
            <StatusBadge type={mainCamera?.status === 'online' ? 'normal' : 'warning'}>
              {mainCamera?.status === 'online' ? '실시간' : '대기'}
            </StatusBadge>
          </div>

          <div className='absolute right-4 top-4 rounded-full bg-black/30 px-3 py-1 text-xs text-slate-200'>
            {mainCamera?.resolution || '-'} · {mainCamera?.fps || 0}fps
          </div>

          <div className='text-center'>
            <div className='mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/10'>
              <Camera size={38} className='text-blue-200' />
            </div>
            <h2 className='text-xl font-bold'>
              {mainCamera?.name || '등록된 카메라 없음'}
            </h2>
            <p className='mt-2 text-sm text-slate-400'>
              {mainCamera ? '카메라 스트림 영역' : '카메라를 먼저 등록해주세요.'}
            </p>
          </div>
        </div>
      </section>

      <Card>
        <h2 className='mb-4 text-lg font-bold'>카메라 목록</h2>

        {cameraList.length === 0 ? (
          <p className='text-sm text-slate-400'>등록된 카메라가 없습니다.</p>
        ) : (
          <div className='space-y-3'>
            {cameraList.map((camera) => {
              const isOnline = camera.status === 'online'

              return (
                <div
                  key={camera.id}
                  className='flex items-center justify-between rounded-2xl bg-slate-800/70 p-4'
                >
                  <div className='flex items-center gap-3'>
                    <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-700/80'>
                      <Camera size={22} className='text-slate-200' />
                    </div>

                    <div>
                      <p className='font-semibold'>{camera.name}</p>
                      <p className='text-sm text-slate-400'>
                        {camera.location || '-'} · {camera.resolution || '-'}
                      </p>
                    </div>
                  </div>

                  <div className='flex items-center gap-2 text-sm'>
                    {isOnline ? (
                      <>
                        <Wifi size={18} className='text-emerald-300' />
                        <span className='text-emerald-300'>온라인</span>
                      </>
                    ) : (
                      <>
                        <WifiOff size={18} className='text-slate-500' />
                        <span className='text-slate-500'>오프라인</span>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </main>
  )
}

export default LivePage
