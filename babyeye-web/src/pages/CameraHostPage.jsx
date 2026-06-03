import { useEffect, useRef, useState } from 'react'
import { Activity, Camera, Radio, Square, Video } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import { buildLiveWebSocketUrl, createLiveSession } from '../api/liveApi'
import {
  getInferenceResult,
  getInferenceStatus,
  requestMultimodalInference,
} from '../api/inferenceApi'

const peerConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
}

const ANALYSIS_INTERVAL_MS = 5000

function CameraHostPage() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const peerRef = useRef(null)
  const audioRecorderRef = useRef(null)
  const analysisRunningRef = useRef(false)

  const [sessionId, setSessionId] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const [analysisEnabled, setAnalysisEnabled] = useState(true)
  const [analysisStatus, setAnalysisStatus] = useState('분석 대기 중')
  const [latestAnalysis, setLatestAnalysis] = useState(null)
  const [analysisCount, setAnalysisCount] = useState(0)

  useEffect(() => {
    return () => {
      stopStreaming()
    }
  }, [])

  async function startHomeCam() {
    try {
      setError('')
      setStatus('카메라 권한을 요청하는 중입니다...')

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      })

      streamRef.current = mediaStream

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }

      setStatus('라이브 세션을 생성하는 중입니다...')

      const session = await createLiveSession({
        camera_name: '휴대폰 홈캠',
      })

      setSessionId(session.sessionId)

      const wsUrl = buildLiveWebSocketUrl(session.sessionId, 'host')
      const socket = new WebSocket(wsUrl)
      socketRef.current = socket

      socket.onopen = () => {
        setStatus('홈캠이 시작되었습니다. 시청자 연결을 기다리는 중입니다.')
        setIsStreaming(true)

        if (analysisEnabled) {
          startRealtimeAnalysis(mediaStream)
        }
      }

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data)

        if (message.type === 'viewer-connected' || message.type === 'viewer-ready') {
          await createOfferForViewer()
          return
        }

        if (message.type === 'answer') {
          if (peerRef.current) {
            await peerRef.current.setRemoteDescription(
              new RTCSessionDescription(message.answer)
            )
            setStatus('시청자와 연결되었습니다.')
          }
          return
        }

        if (message.type === 'candidate') {
          if (peerRef.current && message.candidate) {
            await peerRef.current.addIceCandidate(
              new RTCIceCandidate(message.candidate)
            )
          }
        }

        if (message.type === 'viewer-disconnected') {
          setStatus('시청자 연결이 종료되었습니다. 다시 연결을 기다리는 중입니다.')
          closePeer()
        }
      }

      socket.onerror = () => {
        setError('WebSocket 연결 중 오류가 발생했습니다.')
        setStatus('라이브 세션 연결에 실패했습니다.')
      }

      socket.onclose = () => {
        stopRealtimeAnalysis()

        if (isStreaming) {
          setStatus('라이브 세션 연결이 종료되었습니다.')
        }
      }
    } catch (err) {
      setError(err.message || '홈캠 시작 중 오류가 발생했습니다.')
      setStatus('idle')
      stopStreaming()
    }
  }

  async function createOfferForViewer() {
    if (!streamRef.current || !socketRef.current) {
      return
    }

    closePeer()

    const peer = new RTCPeerConnection(peerConfig)
    peerRef.current = peer

    streamRef.current.getTracks().forEach((track) => {
      peer.addTrack(track, streamRef.current)
    })

    peer.onicecandidate = (event) => {
      if (event.candidate && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'candidate',
          candidate: event.candidate,
        }))
      }
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        setStatus('시청자와 P2P 라이브 연결이 완료되었습니다.')
      }

      if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'disconnected'
      ) {
        setStatus('P2P 연결이 끊겼습니다. 시청자 재연결을 기다립니다.')
      }
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)

    socketRef.current.send(JSON.stringify({
      type: 'offer',
      offer,
    }))

    setStatus('시청자에게 라이브 연결 요청을 보냈습니다.')
  }

  function startRealtimeAnalysis(mediaStream) {
    if (audioRecorderRef.current) {
      return
    }

    if (typeof MediaRecorder === 'undefined') {
      setAnalysisStatus('이 브라우저는 MediaRecorder를 지원하지 않습니다.')
      return
    }

    const audioTracks = mediaStream.getAudioTracks()

    if (!audioTracks || audioTracks.length === 0) {
      setAnalysisStatus('오디오 트랙이 없어 프레임만 분석합니다.')
      startFrameOnlyAnalysis()
      return
    }

    const mimeType = getSupportedAudioMimeType()

    if (!mimeType) {
      setAnalysisStatus('지원 가능한 오디오 녹음 형식이 없습니다.')
      startFrameOnlyAnalysis()
      return
    }

    const audioStream = new MediaStream(audioTracks)
    const recorder = new MediaRecorder(audioStream, { mimeType })

    recorder.ondataavailable = async (event) => {
      if (!analysisEnabled) {
        return
      }

      if (!event.data || event.data.size === 0) {
        return
      }

      if (analysisRunningRef.current) {
        return
      }

      const extension = getAudioExtensionByMimeType(mimeType)
      const audioFile = new File(
        [event.data],
        'live_audio_' + Date.now() + extension,
        { type: mimeType }
      )

      await requestRealtimeInference(audioFile)
    }

    recorder.onerror = () => {
      setAnalysisStatus('오디오 녹음 중 오류가 발생했습니다.')
    }

    recorder.start(ANALYSIS_INTERVAL_MS)
    audioRecorderRef.current = recorder
    setAnalysisStatus('5초 단위 실시간 분석을 시작했습니다.')
  }

  function startFrameOnlyAnalysis() {
    const timer = window.setInterval(async () => {
      if (!analysisEnabled || analysisRunningRef.current) {
        return
      }

      await requestRealtimeInference(null)
    }, ANALYSIS_INTERVAL_MS)

    audioRecorderRef.current = {
      stop: () => window.clearInterval(timer),
      state: 'recording',
    }

    setAnalysisStatus('5초 단위 프레임 분석을 시작했습니다.')
  }

  function stopRealtimeAnalysis() {
    analysisRunningRef.current = false

    if (audioRecorderRef.current) {
      try {
        if (
          audioRecorderRef.current.state &&
          audioRecorderRef.current.state !== 'inactive'
        ) {
          audioRecorderRef.current.stop()
        } else if (typeof audioRecorderRef.current.stop === 'function') {
          audioRecorderRef.current.stop()
        }
      } catch {
        // ignore
      }

      audioRecorderRef.current = null
    }

    setAnalysisStatus('분석이 중지되었습니다.')
  }

  async function requestRealtimeInference(audioFile) {
    try {
      analysisRunningRef.current = true
      setAnalysisStatus('현재 프레임과 오디오를 분석 서버로 전송 중입니다...')

      const frameFile = await captureCurrentFrame()

      if (!frameFile && !audioFile) {
        setAnalysisStatus('분석할 프레임 또는 오디오가 없습니다.')
        return
      }

      const queued = await requestMultimodalInference({
        audioFile,
        frameFiles: frameFile ? [frameFile] : [],
        capturedAt: new Date().toISOString(),
        frameRate: 1,
        durationSeconds: ANALYSIS_INTERVAL_MS / 1000,
      })

      if (!queued.requestId) {
        throw new Error('분석 requestId가 없습니다.')
      }

      setAnalysisStatus('AI 분석 작업 처리 중입니다...')

      const completed = await waitForInferenceCompleted(queued.requestId)

      setLatestAnalysis(completed.result)
      setAnalysisCount((prev) => prev + 1)
      setAnalysisStatus('최근 분석 완료: ' + toUserFriendlyEmotion(completed.result?.emotion))
    } catch (err) {
      setAnalysisStatus(err.message || '실시간 분석 요청 중 오류가 발생했습니다.')
    } finally {
      analysisRunningRef.current = false
    }
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

  function closePeer() {
    if (peerRef.current) {
      peerRef.current.close()
      peerRef.current = null
    }
  }

  function stopStreaming() {
    stopRealtimeAnalysis()
    closePeer()

    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsStreaming(false)
    setSessionId('')
    setStatus('idle')
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
                  홈캠 실행 중 5초마다 프레임과 오디오를 분석합니다.
                </p>
              </div>

              <input
                type='checkbox'
                checked={analysisEnabled}
                onChange={(event) => {
                  setAnalysisEnabled(event.target.checked)

                  if (!event.target.checked) {
                    stopRealtimeAnalysis()
                  } else if (isStreaming && streamRef.current) {
                    startRealtimeAnalysis(streamRef.current)
                  }
                }}
                className='h-5 w-5'
              />
            </label>
          </div>

          <button
            type='button'
            onClick={isStreaming ? stopStreaming : startHomeCam}
            className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3 text-sm font-bold text-white transition hover:bg-blue-400'
          >
            {isStreaming ? <Square size={18} /> : <Video size={18} />}
            {isStreaming ? '홈캠 중지' : '홈캠 시작하기'}
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

async function waitForInferenceCompleted(requestId) {
  const maxAttempts = 30
  const intervalMs = 1000

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getInferenceStatus(requestId)

    if (status.status === 'completed') {
      return getInferenceResult(requestId)
    }

    if (status.status === 'failed') {
      throw new Error(status.message || '분석 작업이 실패했습니다.')
    }

    await sleep(intervalMs)
  }

  throw new Error('분석 작업 시간이 초과되었습니다.')
}

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ]

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }

  return ''
}

function getAudioExtensionByMimeType(mimeType) {
  if (mimeType.includes('webm')) {
    return '.webm'
  }

  if (mimeType.includes('ogg')) {
    return '.ogg'
  }

  if (mimeType.includes('mp4')) {
    return '.m4a'
  }

  return '.webm'
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
