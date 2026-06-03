import { useEffect, useState } from 'react'
import { Camera, Plus, Wifi, WifiOff, X } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { createCamera, getCameras } from '../api/cameraApi'

const initialForm = {
  name: '',
  location: '',
  stream_url: '',
  resolution: '1080p',
  fps: 30,
  analysis_enabled: true,
}

function LivePage() {
  const [cameras, setCameras] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [formError, setFormError] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState(initialForm)

  useEffect(() => {
    loadCameras()
  }, [])

  async function loadCameras() {
    try {
      setLoading(true)
      setError(null)

      const result = await getCameras()
      setCameras(result || [])
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  function handleChange(event) {
    const { name, value, type, checked } = event.target

    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.name.trim()) {
      setFormError('카메라 이름을 입력해주세요.')
      return
    }

    try {
      setSaving(true)
      setFormError(null)

      await createCamera({
        name: form.name.trim(),
        location: form.location.trim() || null,
        stream_url: form.stream_url.trim() || null,
        resolution: form.resolution.trim() || null,
        fps: Number(form.fps) || null,
        analysis_enabled: form.analysis_enabled,
      })

      setForm(initialForm)
      setIsFormOpen(false)
      await loadCameras()
    } catch (err) {
      setFormError(err.message || '카메라 등록 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

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

      <Card className='mb-5'>
        <div className='mb-4 flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <h2 className='text-lg font-bold'>카메라 목록</h2>
            <p className='mt-1 text-sm leading-5 text-slate-400'>
              등록된 홈캠 또는 테스트 카메라를 관리합니다.
            </p>
          </div>

          <button
            type='button'
            onClick={() => setIsFormOpen((prev) => !prev)}
            className={
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition ' +
              (isFormOpen
                ? 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                : 'border-blue-400/40 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25')
            }
          >
            {isFormOpen ? <X size={15} /> : <Plus size={15} />}
            <span>{isFormOpen ? '닫기' : '카메라 추가'}</span>
          </button>
        </div>

        {isFormOpen && (
          <form onSubmit={handleSubmit} className='mb-5 rounded-3xl border border-slate-700 bg-slate-950/60 p-4'>
            <div className='mb-4 rounded-2xl bg-blue-400/10 p-4 text-sm leading-6 text-blue-100'>
              현재는 프로토타입 단계입니다. 홈캠 자동 검색, QR 등록, 제조사 계정 연동,
              RTSP/ONVIF 연동 방식은 추후 추가 예정입니다.
            </div>

            <div className='space-y-4'>
              <div>
                <label className='mb-2 block text-sm font-semibold text-slate-200'>
                  카메라 이름
                </label>
                <input
                  name='name'
                  value={form.name}
                  onChange={handleChange}
                  placeholder='예: 아기 방 카메라'
                  className='w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400'
                />
              </div>

              <div>
                <label className='mb-2 block text-sm font-semibold text-slate-200'>
                  위치
                </label>
                <input
                  name='location'
                  value={form.location}
                  onChange={handleChange}
                  placeholder='예: 침실, 거실'
                  className='w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400'
                />
              </div>

              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <label className='mb-2 block text-sm font-semibold text-slate-200'>
                    해상도
                  </label>
                  <select
                    name='resolution'
                    value={form.resolution}
                    onChange={handleChange}
                    className='w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-blue-400'
                  >
                    <option value='720p'>720p</option>
                    <option value='1080p'>1080p</option>
                    <option value='2K'>2K</option>
                    <option value='4K'>4K</option>
                  </select>
                </div>

                <div>
                  <label className='mb-2 block text-sm font-semibold text-slate-200'>
                    FPS
                  </label>
                  <input
                    name='fps'
                    type='number'
                    min='1'
                    max='60'
                    value={form.fps}
                    onChange={handleChange}
                    className='w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-blue-400'
                  />
                </div>
              </div>

              <div>
                <label className='mb-2 block text-sm font-semibold text-slate-200'>
                  스트림 URL
                </label>
                <input
                  name='stream_url'
                  value={form.stream_url}
                  onChange={handleChange}
                  placeholder='추후 RTSP/ONVIF/제조사 연동 방식 추가 예정'
                  className='w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-blue-400'
                />
                <p className='mt-2 text-xs leading-5 text-slate-500'>
                  현재는 입력값 저장만 수행합니다. 실제 홈캠 연결 테스트와 영상 스트리밍 연동은 추후 구현 예정입니다.
                </p>
              </div>

              <label className='flex items-center justify-between rounded-2xl bg-slate-800/70 p-4'>
                <div>
                  <p className='text-sm font-semibold text-slate-200'>AI 분석 활성화</p>
                  <p className='mt-1 text-xs text-slate-500'>
                    등록된 카메라를 분석 대상으로 사용할지 설정합니다.
                  </p>
                </div>

                <input
                  name='analysis_enabled'
                  type='checkbox'
                  checked={form.analysis_enabled}
                  onChange={handleChange}
                  className='h-5 w-5 accent-blue-500'
                />
              </label>

              {formError && (
                <p className='rounded-2xl bg-rose-400/10 p-3 text-sm text-rose-300'>
                  {formError}
                </p>
              )}

              <button
                type='submit'
                disabled={saving}
                className='w-full rounded-2xl bg-blue-500 py-3 text-sm font-bold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
              >
                {saving ? '등록 중...' : '카메라 등록'}
              </button>
            </div>
          </form>
        )}

        {cameraList.length === 0 ? (
          <div className='rounded-2xl bg-slate-800/70 p-5 text-center'>
            <div className='mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-700/80'>
              <Camera size={28} className='text-slate-300' />
            </div>
            <p className='font-semibold'>등록된 카메라가 없습니다.</p>
            <p className='mt-2 text-sm leading-6 text-slate-400'>
              프로토타입 테스트를 위해 임시 카메라 정보를 추가해보세요.
            </p>
          </div>
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
