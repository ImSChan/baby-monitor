import { Camera, Wifi, WifiOff } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { cameras } from '../data/cameraData'

function LivePage() {
  const mainCamera = cameras.find((camera) => camera.isMain)

  return (
    <main className='px-5 py-6'>
      <Header title='라이브 피드' subtitle='실시간 카메라 화면 확인' />

      <section className='mb-5 overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-900 shadow-card'>
        <div className='relative flex h-72 items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950'>
          <div className='absolute left-4 top-4'>
            <StatusBadge type='normal'>실시간</StatusBadge>
          </div>

          <div className='absolute right-4 top-4 rounded-full bg-black/30 px-3 py-1 text-xs text-slate-200'>
            {mainCamera.resolution} · {mainCamera.fps}fps
          </div>

          <div className='text-center'>
            <div className='mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/10'>
              <Camera size={38} className='text-blue-200' />
            </div>
            <h2 className='text-xl font-bold'>{mainCamera.name}</h2>
            <p className='mt-2 text-sm text-slate-400'>카메라 스트림 영역</p>
          </div>
        </div>
      </section>

      <Card>
        <h2 className='mb-4 text-lg font-bold'>카메라 목록</h2>

        <div className='space-y-3'>
          {cameras.map((camera) => {
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
                      {camera.location} · {camera.resolution}
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
      </Card>
    </main>
  )
}

export default LivePage
