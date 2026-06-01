import { useRef, useState } from 'react'
import {
  AlertCircle,
  Baby,
  Camera,
  Droplets,
  Lightbulb,
  Moon,
  Thermometer,
  Upload,
  Video,
} from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { getDashboard } from '../api/dashboardApi'
import {
  getInferenceResult,
  getInferenceStatus,
  requestMultimodalInference,
} from '../api/inferenceApi'
import { useApi } from '../hooks/api/useApi'
import { preprocessVideoForInference } from '../utils/videoPreprocess'

function HomePage() {
  const fileInputRef = useRef(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [analysisResult, setAnalysisResult] = useState(null)

  const { data, loading, error } = useApi(getDashboard, [reloadKey])

  async function handleVideoSelected(event) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      setUploading(true)
      setUploadMessage('영상 전처리를 시작합니다...')
      setUploadError('')
      setAnalysisResult(null)

      const preprocessed = await preprocessVideoForInference(file, {
        framesPerSecond: 1,
        maxFrames: 20,
        maxWidth: 640,
        onProgress: setUploadMessage,
      })

      if (preprocessed.frameFiles.length === 0 && !preprocessed.audioFile) {
        throw new Error('분석할 프레임 또는 오디오를 추출하지 못했습니다.')
      }

      const audioStatus = preprocessed.audioFile
        ? '오디오 추출 완료'
        : '오디오 추출 실패. 프레임만 전송합니다.'

      setUploadMessage(
        '프레임 ' +
          preprocessed.frameFiles.length +
          '개 추출 완료. ' +
          audioStatus +
          ' 서버에 분석 작업을 등록하는 중입니다...'
      )

      const queued = await requestMultimodalInference({
        audioFile: preprocessed.audioFile,
        frameFiles: preprocessed.frameFiles,
        capturedAt: new Date().toISOString(),
        frameRate: preprocessed.frameRate,
        durationSeconds: preprocessed.durationSeconds,
      })

      const requestId = queued.requestId

      if (!requestId) {
        throw new Error('서버 응답에 requestId가 없습니다.')
      }

      setUploadMessage('분석 작업이 등록되었습니다. 작업 처리 상태를 확인하는 중입니다...')

      const completedResult = await waitForInferenceCompleted(requestId, {
        onProgress: setUploadMessage,
      })

      setAnalysisResult({
        ...completedResult.result,
        requestId,
        saved: completedResult.saved,
      })

      setUploadMessage('영상 분석이 완료되었습니다.')
      setReloadKey((prev) => prev + 1)
    } catch (err) {
      setUploadError(err.message || '영상 분석 요청 중 오류가 발생했습니다.')
      setUploadMessage('')
    } finally {
      setUploading(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const currentEmotion = data?.currentEmotion
  const environment = data?.environment
  const cameras = data?.cameras
  const alerts = data?.alerts || []
  const confidencePercent = Math.round((currentEmotion?.confidence || 0) * 100)

  return (
    <main className='px-5 py-6'>
      <Header />

      <Card className='mb-5 border-blue-400/30 bg-gradient-to-br from-slate-900 to-blue-950/60'>
        <div className='flex items-start gap-4'>
          <div className='flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-400/15 text-blue-200'>
            <Video size={28} />
          </div>

          <div className='min-w-0 flex-1'>
            <p className='text-sm font-semibold text-blue-200'>영상 업로드 분석</p>
            <h2 className='mt-1 text-xl font-bold text-white'>
              저장된 영상으로 감정 상태 분석
            </h2>
            <p className='mt-2 text-sm leading-6 text-slate-400'>
              영상을 업로드하면 브라우저에서 프레임과 오디오를 추출한 뒤, AI 분석 서버로 전송합니다.
            </p>
          </div>
        </div>

        <div className='mt-4 rounded-2xl bg-slate-950/40 p-4 text-xs leading-5 text-slate-400'>
          현재는 프로토타입 단계입니다. 안드로이드 환경 기준으로 영상에서 오디오와 프레임을 추출해 분석을 요청합니다.
        </div>

        <input
          ref={fileInputRef}
          type='file'
          accept='video/*'
          className='hidden'
          onChange={handleVideoSelected}
        />

        <button
          type='button'
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3 text-sm font-bold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
        >
          <Upload size={18} />
          {uploading ? '분석 요청 중...' : '영상 업로드하여 분석'}
        </button>

        {uploadMessage && (
          <p className='mt-3 rounded-2xl bg-blue-400/10 p-3 text-sm leading-6 text-blue-100'>
            {uploadMessage}
          </p>
        )}

        {uploadError && (
          <p className='mt-3 rounded-2xl bg-rose-400/10 p-3 text-sm leading-6 text-rose-300'>
            {uploadError}
          </p>
        )}

        {analysisResult && (
          <TopPredictionCard analysisResult={analysisResult} />
        )}
      </Card>

      {loading && (
        <Card>
          <p className='text-sm text-slate-300'>대시보드 정보를 불러오는 중입니다...</p>
        </Card>
      )}

      {error && (
        <Card>
          <p className='font-semibold text-rose-300'>데이터를 불러오지 못했습니다.</p>
          <p className='mt-2 text-sm text-slate-400'>{error.message}</p>
        </Card>
      )}

      {!loading && !error && (
        <>
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
        </>
      )}
    </main>
  )
}

function TopPredictionCard({ analysisResult }) {
  const predictions = getTopPredictions(analysisResult)

  return (
    <div className='mt-4 rounded-[28px] bg-slate-950/50 p-5'>
      <div className='mb-4 flex items-center gap-3'>
        <div className='flex h-11 w-11 items-center justify-center rounded-full bg-blue-400/15 text-blue-200'>
          <Baby size={24} />
        </div>
        <div>
          <p className='text-xs font-semibold text-blue-200'>AI 분석 결과</p>
          <h3 className='text-lg font-bold text-white'>현재 아기가 우는 이유</h3>
        </div>
      </div>

      <div className='grid grid-cols-2 gap-3'>
        {predictions.map((item, index) => (
          <div
            key={item.emotion + index}
            className='rounded-3xl border border-slate-700/70 bg-slate-900/80 p-4'
          >
            <div className='mb-3 flex items-center justify-between'>
              <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-2xl'>
                {getEmotionIcon(item.need || item.emotion)}
              </div>
              <span className='rounded-full bg-blue-400/10 px-2 py-1 text-[11px] font-semibold text-blue-200'>
                TOP {index + 1}
              </span>
            </div>

            <p className='text-sm font-bold text-blue-200'>
              {toUserFriendlyEmotion(item.emotion)}
            </p>

            <p className='mt-1 text-3xl font-light text-white'>
              {Math.round((item.confidence || 0) * 100)}
              <span className='ml-1 text-base text-slate-400'>%</span>
            </p>
          </div>
        ))}
      </div>

      <p className='mt-4 text-xs leading-5 text-slate-400'>
        AI가 가능성이 높은 상태 2가지를 제시합니다. 보호자는 실제 상황을 함께 보고 판단할 수 있습니다.
      </p>
    </div>
  )
}

function getTopPredictions(analysisResult) {
  if (analysisResult.topPredictions?.length > 0) {
    return analysisResult.topPredictions.slice(0, 2)
  }

  return [
    {
      emotion: analysisResult.emotion,
      confidence: analysisResult.confidence,
      need: analysisResult.need,
      message: analysisResult.message,
    },
  ]
}

async function waitForInferenceCompleted(requestId, options = {}) {
  const onProgress = options.onProgress || (() => {})
  const maxAttempts = options.maxAttempts || 60
  const intervalMs = options.intervalMs || 2000

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getInferenceStatus(requestId)

    if (status.status === 'completed') {
      onProgress('분석이 완료되어 결과를 불러오는 중입니다...')
      return getInferenceResult(requestId)
    }

    if (status.status === 'failed') {
      throw new Error(status.message || '분석 작업이 실패했습니다.')
    }

    if (status.status === 'processing') {
      onProgress('AI 분석 작업을 처리 중입니다...')
    } else {
      onProgress('분석 대기열에서 순서를 기다리는 중입니다...')
    }

    await sleep(intervalMs)
  }

  throw new Error('분석 작업 시간이 초과되었습니다.')
}

function toUserFriendlyEmotion(value) {
  if (!value) return '분석 중'

  const mapping = {
    배고픔: '배고파요',
    잠와요: '잠와요',
    피곤함: '잠와요',
    불편함: '불편해요',
    '안정 상태': '괜찮아요',
    안정상태: '괜찮아요',
  }

  return mapping[value] || value
}

function getEmotionIcon(value) {
  const key = String(value || '')

  if (key.includes('feeding') || key.includes('배고')) {
    return '🍼'
  }

  if (key.includes('sleep') || key.includes('잠') || key.includes('피곤')) {
    return '🌙'
  }

  if (key.includes('care') || key.includes('불편')) {
    return '🌡️'
  }

  if (key.includes('stable') || key.includes('안정')) {
    return '😊'
  }

  return '👶'
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function formatTime(value) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default HomePage
