import { useEffect, useRef, useState } from 'react'
import { Activity, Camera, Radio, Square, Video } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import { useLiveHost } from '../hooks/useLiveConnection'
import { abortableDelay, throwIfAborted } from '../utils/abort'
import {
  getInferenceResult,
  getInferenceStatus,
  requestMultimodalInference,
} from '../api/inferenceApi'

const ANALYSIS_INTERVAL_MS = 5000
const AUDIO_SAMPLE_RATE = 16000
const QUIET_RMS_DBFS_THRESHOLD = -42
const QUIET_PEAK_DBFS_THRESHOLD = -20

function CameraHostPage() {
  const videoRef = useRef(null)
  const { streamRef, sessionId, status, error, isStreaming, isStarting,
    start: startHomeCam, stop: stopHost } = useLiveHost(videoRef)
  const analysisEpochRef = useRef(0)
  const analysisAbortRef = useRef(null)
  const analysisTimerRef = useRef(null)
  const analysisRunningRef = useRef(false)
  const stopRequestedRef = useRef(false)

  const [analysisEnabled, setAnalysisEnabled] = useState(true)
  const [analysisStatus, setAnalysisStatus] = useState('분석 대기 중')
  const [latestAnalysis, setLatestAnalysis] = useState(null)
  const [analysisCount, setAnalysisCount] = useState(0)
  const [latestAudioMetrics, setLatestAudioMetrics] = useState(null)

  useEffect(() => {
    if (isStreaming && analysisEnabled) startRealtimeAnalysisLoop()
    else stopRealtimeAnalysisLoop()
    return () => stopRealtimeAnalysisLoop()
  }, [isStreaming, analysisEnabled])

  function startRealtimeAnalysisLoop() {
    if (analysisTimerRef.current) {
      return
    }

    stopRequestedRef.current = false
    setAnalysisStatus('5초 단위 실시간 분석을 시작했습니다.')

    runAnalysisOnce()

    analysisTimerRef.current = window.setInterval(() => {
      runAnalysisOnce()
    }, ANALYSIS_INTERVAL_MS)
  }

  function stopRealtimeAnalysisLoop() {
    analysisEpochRef.current++
    analysisAbortRef.current?.abort()
    analysisAbortRef.current = null
    stopRequestedRef.current = true
    analysisRunningRef.current = false

    if (analysisTimerRef.current) {
      window.clearInterval(analysisTimerRef.current)
      analysisTimerRef.current = null
    }

    setAnalysisStatus('분석이 중지되었습니다.')
  }

  async function runAnalysisOnce() {
    if (!analysisEnabled || stopRequestedRef.current) {
      return
    }

    if (analysisRunningRef.current) {
      return
    }

    if (!streamRef.current) {
      return
    }

    const run = analysisEpochRef.current
    const controller = new AbortController()
    analysisAbortRef.current = controller
    const signal = controller.signal
    try {
      analysisRunningRef.current = true
      setAnalysisStatus('5초 오디오와 현재 프레임을 수집하는 중입니다...')

      const [audioPayload, frameFile] = await Promise.all([
        recordAudioClipAsWav(streamRef.current, ANALYSIS_INTERVAL_MS, signal),
        captureCurrentFrame(),
      ])

      throwIfAborted(signal)
      const audioFile = audioPayload?.audioFile || null
      const audioMetrics = audioPayload?.metrics || null

      setLatestAudioMetrics(audioMetrics)

      if (!audioFile && !frameFile) {
        setAnalysisStatus('분석할 프레임 또는 오디오가 없습니다.')
        return
      }

      if (audioMetrics?.quietAudio) {
        setAnalysisStatus('오디오가 조용한 상태입니다. 안정 상태 여부를 서버에 함께 전달합니다.')
      } else {
        setAnalysisStatus('분석 서버로 전송 중입니다...')
      }

      const queued = await requestMultimodalInference({
        audioFile,
        frameFiles: frameFile ? [frameFile] : [],
        capturedAt: new Date().toISOString(),
        frameRate: 1,
        durationSeconds: ANALYSIS_INTERVAL_MS / 1000,
        audioRmsDbfs: audioMetrics?.rmsDbfs,
        audioPeakDbfs: audioMetrics?.peakDbfs,
        quietAudio: audioMetrics?.quietAudio,
        signal,
      })

      throwIfAborted(signal)
      if (!queued.requestId) {
        throw new Error('분석 requestId가 없습니다.')
      }

      setAnalysisStatus('AI 분석 작업 처리 중입니다...')

      const completed = await waitForInferenceCompleted(queued.requestId, signal)
      throwIfAborted(signal)

      setLatestAnalysis(completed.result)
      setAnalysisCount((prev) => prev + 1)
      setAnalysisStatus('최근 분석 완료: ' + toUserFriendlyEmotion(completed.result?.emotion))
    } catch (err) {
      if (!signal.aborted && run === analysisEpochRef.current) setAnalysisStatus(err.message || '실시간 분석 요청 중 오류가 발생했습니다.')
    } finally {
      if (run === analysisEpochRef.current) {
        analysisRunningRef.current = false
        analysisAbortRef.current = null
      }
    }
  }

  async function recordAudioClipAsWav(mediaStream, durationMs, signal) {
    throwIfAborted(signal)
    const audioTracks = mediaStream.getAudioTracks()
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!audioTracks.length || !AudioContextClass) return null
    const context = new AudioContextClass()
    let source, processor
    const chunks = []
    const sampleRate = context.sampleRate
    try {
      void context.resume().catch(() => {})
      throwIfAborted(signal)
      source = context.createMediaStreamSource(new MediaStream(audioTracks))
      processor = context.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      source.connect(processor)
      processor.connect(context.destination)
      await abortableDelay(durationMs, signal)
    } finally {
      if (processor) { processor.onaudioprocess = null; processor.disconnect() }
      source?.disconnect()
      await context.close().catch(() => {})
    }
    throwIfAborted(signal)
    if (!chunks.length) return null
    const resampled = resampleFloat32(mergeFloat32Arrays(chunks), sampleRate, AUDIO_SAMPLE_RATE)
    const file = new File([new Blob([encodeWav(resampled, AUDIO_SAMPLE_RATE)], { type: 'audio/wav' })],
      'live_audio_' + Date.now() + '.wav', { type: 'audio/wav' })
    return { audioFile: file, metrics: calculateDbfsMetrics(resampled) }
  }

  async function captureCurrentFrame() {
    const video = videoRef.current

    if (!video || !video.videoWidth || !video.videoHeight) {
      return null
    }

    const canvas = document.createElement('canvas')
    const maxWidth = 640
    const scale = Math.min(1, maxWidth / video.videoWidth)

    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)

    const context = canvas.getContext('2d')

    if (!context) {
      return null
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8)
    })

    if (!blob) {
      return null
    }

    return new File(
      [blob],
      'live_frame_' + Date.now() + '.jpg',
      { type: 'image/jpeg' }
    )
  }

  function stopStreaming() {
    stopRealtimeAnalysisLoop()
    stopHost()
  }

  return (
    <main className='px-5 py-6'>
      <Header title='휴대폰 홈캠' subtitle='이 기기를 임시 홈캠으로 사용합니다.' />

      <section className='mb-5 overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-900 shadow-card'>
        <div className='relative h-[520px] bg-black'>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className='h-full w-full object-cover'
          />

          {!isStreaming && (
            <div className='absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-center'>
              <div className='mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-400/15 text-blue-200'>
                <Camera size={38} />
              </div>
              <p className='text-lg font-bold'>홈캠 대기 중</p>
              <p className='mt-2 text-sm text-slate-400'>
                시작 버튼을 누르면 카메라와 마이크 권한을 요청합니다.
              </p>
            </div>
          )}

          {isStreaming && (
            <div className='absolute left-4 top-4 flex items-center gap-2 rounded-full bg-rose-500/90 px-3 py-1 text-xs font-bold text-white'>
              <Radio size={14} />
              LIVE
            </div>
          )}
        </div>

        <div className='p-5'>
          <p className='text-sm leading-6 text-slate-300'>
            {status === 'idle' ? '홈캠 시작 버튼을 눌러 라이브 세션을 생성하세요.' : status}
          </p>

          {sessionId && (
            <p className='mt-2 break-all rounded-2xl bg-slate-800 p-3 text-xs text-slate-400'>
              Session ID: {sessionId}
            </p>
          )}

          {error && (
            <p className='mt-3 rounded-2xl bg-rose-400/10 p-3 text-sm text-rose-300'>
              {error}
            </p>
          )}

          <div className='mt-4 rounded-2xl bg-slate-950/50 p-4'>
            <label className='flex items-center justify-between gap-4'>
              <div>
                <p className='text-sm font-semibold text-blue-200'>실시간 AI 분석</p>
                <p className='mt-1 text-xs leading-5 text-slate-400'>
                  홈캠 실행 중 5초마다 프레임과 WAV 오디오를 분석합니다.
                </p>
              </div>

              <input
                type='checkbox'
                checked={analysisEnabled}
                onChange={(event) => {
                  const checked = event.target.checked
                  setAnalysisEnabled(checked)


                }}
                className='h-5 w-5'
              />
            </label>
          </div>

          <button
            type='button'
            onClick={isStreaming || isStarting ? stopStreaming : startHomeCam}
            className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3 text-sm font-bold text-white transition hover:bg-blue-400'
          >
            {isStreaming || isStarting ? <Square size={18} /> : <Video size={18} />}
            {isStarting ? '홈캠 시작 취소' : isStreaming ? '홈캠 중지' : '홈캠 시작하기'}
          </button>
        </div>
      </section>

      <Card className='mb-5'>
        <div className='mb-3 flex items-center gap-3'>
          <div className='flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-400/15 text-blue-200'>
            <Activity size={22} />
          </div>
          <div>
            <p className='text-sm font-semibold text-blue-200'>실시간 분석 상태</p>
            <p className='mt-1 text-xs text-slate-400'>총 분석 요청 {analysisCount}회</p>
          </div>
        </div>

        <p className='rounded-2xl bg-slate-950/50 p-3 text-sm leading-6 text-slate-300'>
          {analysisStatus}
        </p>

        {latestAudioMetrics && (
          <div className='mt-3 rounded-2xl bg-slate-950/40 p-3 text-xs leading-5 text-slate-400'>
            <p>RMS: {latestAudioMetrics.rmsDbfs} dBFS</p>
            <p>Peak: {latestAudioMetrics.peakDbfs} dBFS</p>
            <p>Quiet: {latestAudioMetrics.quietAudio ? 'true' : 'false'}</p>
          </div>
        )}

        {latestAnalysis && (
          <div className='mt-4 rounded-2xl bg-emerald-400/10 p-4'>
            <p className='text-xs font-semibold text-emerald-200'>최근 AI 분석 결과</p>
            <p className='mt-2 text-xl font-bold text-white'>
              {toUserFriendlyEmotion(latestAnalysis.emotion)}
            </p>
            <p className='mt-1 text-sm text-slate-300'>
              최종 확률 {Math.round((latestAnalysis.confidence || 0) * 100)}%
            </p>

            {latestAnalysis.topPredictions?.length > 0 && (
              <div className='mt-3 grid grid-cols-2 gap-2'>
                {latestAnalysis.topPredictions.slice(0, 2).map((item, index) => (
                  <div
                    key={item.emotion + index}
                    className='rounded-2xl bg-slate-950/60 p-3'
                  >
                    <p className='text-xs text-blue-200'>TOP {index + 1}</p>
                    <p className='mt-1 text-sm font-semibold text-white'>
                      {toUserFriendlyEmotion(item.emotion)}
                    </p>
                    <p className='mt-1 text-lg text-white'>
                      {Math.round((item.confidence || 0) * 100)}%
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <p className='text-sm font-semibold text-blue-200'>시연 안내</p>
        <p className='mt-2 text-sm leading-6 text-slate-400'>
          이 화면은 공기계 휴대폰에서 열어두고, 노트북에서는 라이브 피드 탭에서 해당 세션을 선택하면 됩니다.
          실시간 AI 분석은 이 휴대폰에서 5초 단위로 기존 분석 API에 요청합니다.
        </p>
      </Card>
    </main>
  )
}

async function waitForInferenceCompleted(requestId, signal) {
  const maxAttempts = 30
  const intervalMs = 1000

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(signal)
    const status = await getInferenceStatus(requestId, { signal })

    if (status.status === 'completed') {
      return getInferenceResult(requestId, { signal })
    }

    if (status.status === 'failed') {
      throw new Error(status.message || '분석 작업이 실패했습니다.')
    }

    await abortableDelay(intervalMs, signal)
  }

  throw new Error('분석 작업 시간이 초과되었습니다.')
}

function calculateDbfsMetrics(samples) {
  if (!samples || samples.length === 0) {
    return {
      rmsDbfs: -120,
      peakDbfs: -120,
      quietAudio: true,
    }
  }

  let sumSquares = 0
  let peak = 0

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index])
    sumSquares += value * value

    if (value > peak) {
      peak = value
    }
  }

  const rms = Math.sqrt(sumSquares / samples.length)
  const rmsDbfs = linearToDbfs(rms)
  const peakDbfs = linearToDbfs(peak)

  return {
    rmsDbfs,
    peakDbfs,
    quietAudio: rmsDbfs <= QUIET_RMS_DBFS_THRESHOLD && peakDbfs <= QUIET_PEAK_DBFS_THRESHOLD,
  }
}

function linearToDbfs(value) {
  const safeValue = Math.max(Number(value) || 0, 0.000001)
  return Math.round(20 * Math.log10(safeValue) * 10) / 10
}

function mergeFloat32Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Float32Array(totalLength)

  let offset = 0

  chunks.forEach((chunk) => {
    result.set(chunk, offset)
    offset += chunk.length
  })

  return result
}

function resampleFloat32(input, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return input
  }

  const ratio = inputSampleRate / outputSampleRate
  const outputLength = Math.round(input.length / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(leftIndex + 1, input.length - 1)
    const weight = sourceIndex - leftIndex

    output[i] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight
  }

  return output
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  floatTo16BitPCM(view, 44, samples)

  return buffer
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(offset, value, true)
    offset += 2
  }
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export default CameraHostPage
