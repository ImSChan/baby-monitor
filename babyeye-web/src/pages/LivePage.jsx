import { useEffect, useRef, useState } from 'react'
import { Camera, Plus, Radio, RefreshCw, Smartphone, Wifi, WifiOff, X } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import StatusBadge from '../components/common/StatusBadge'
import { createCamera, getCameras } from '../api/cameraApi'
import { buildLiveWebSocketUrl, getLiveSessions } from '../api/liveApi'

const initialForm = {
  name: '',
  location: '',
  stream_url: '',
  resolution: '1080p',
  fps: 30,
  analysis_enabled: true,
}

const peerConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
}

function LivePage() {
  const remoteVideoRef = useRef(null)
  const socketRef = useRef(null)
  const peerRef = useRef(null)

  const [cameras, setCameras] = useState([])
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)

  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [liveStatus, setLiveStatus] = useState('대기 중')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [formError, setFormError] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState(initialForm)

  useEffect(() => {
    loadPageData()

    const timer = setInterval(() => {
      loadSessionsOnly()
    }, 5000)

    return () => {
      clearInterval(timer)
      stopViewer()
    }
  }, [])

  async function loadPageData() {
    try {
      setLoading(true)
      setError(null)

      const [cameraResult, sessionResult] = await Promise.all([
        getCameras(),
        getLiveSessions(),
      ])

      setCameras(cameraResult || [])
      setSessions(sessionResult || [])
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  async function loadSessionsOnly() {
    try {
      const sessionResult = await getLiveSessions()
      setSessions(sessionResult || [])
    } catch {
      // ignore polling error
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
      await loadPageData()
    } catch (err) {
      setFormError(err.message || '카메라 등록 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function connectToSession(session) {
    try {
      stopViewer()

      setSelectedSession(session)
      setConnecting(true)
      setLiveStatus('라이브 세션에 연결하는 중입니다...')

      const peer = new RTCPeerConnection(peerConfig)
      peerRef.current = peer

      peer.ontrack = (event) => {
        const [stream] = event.streams

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream
        }

        setLiveStatus('실시간 영상 수신 중입니다.')
      }

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
          setLiveStatus('P2P 라이브 연결 완료')
        }

        if (peer.connectionState === 'failed') {
          setLiveStatus('P2P 연결 실패. TURN 서버가 필요할 수 있습니다.')
        }

        if (peer.connectionState === 'disconnected') {
          setLiveStatus('라이브 연결이 일시적으로 끊겼습니다.')
        }
      }

      const wsUrl = buildLiveWebSocketUrl(session.sessionId, 'viewer')
      const socket = new WebSocket(wsUrl)
      socketRef.current = socket

      socket.onopen = () => {
        setConnecting(false)
        setLiveStatus('홈캠에 연결 요청을 보냈습니다.')
        socket.send(JSON.stringify({ type: 'viewer-ready' }))
      }

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data)

        if (message.type === 'offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(message.offer))

          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)

          socket.send(JSON.stringify({
            type: 'answer',
            answer,
          }))

          setLiveStatus('라이브 응답을 전송했습니다.')
          return
        }

        if (message.type === 'candidate') {
          if (message.candidate) {
            await peer.addIceCandidate(new RTCIceCandidate(message.candidate))
          }
          return
        }

        if (message.type === 'host-disconnected') {
          setLiveStatus('홈캠 연결이 종료되었습니다.')
          stopViewer(false)
        }
      }

      socket.onerror = () => {
        setConnecting(false)
        setLiveStatus('WebSocket 연결 오류가 발생했습니다.')
      }

      socket.onclose = () => {
        setConnecting(false)
      }
    } catch (err) {
      setConnecting(false)
      setLiveStatus(err.message || '라이브 연결 중 오류가 발생했습니다.')
    }
  }

  function stopViewer(clearSession = true) {
    if (peerRef.current) {
      peerRef.current.close()
      peerRef.current = null
    }

    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null
    }

    if (clearSession) {
      setSelectedSession(null)
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

  return (
    <main className='px-5 py-6'>
      <Header title='라이브 피드' subtitle='실시간 카메라 화면 확인' />

      <section className='mb-5 overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-900 shadow-card'>
        <div className='relative flex h-72 items-center justify-center bg-black'>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            controls={false}
            className='h-full w-full object-cover'
          />

          {!selectedSession && (
            <div className='absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 text-center'>
              <div className='mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/10'>
                <Camera size={38} className='text-blue-200' />
              </div>
              <h2 className='text-xl font-bold'>라이브 세션 대기 중</h2>
              <p className='mt-2 text-sm text-slate-400'>
                휴대폰 홈캠을 시작한 뒤 세션을 선택해주세요.
              </p>
            </div>
          )}

          {selectedSession && (
            <>
              <div className='absolute left-4 top-4'>
                <StatusBadge type='normal'>LIVE</StatusBadge>
              </div>

              <div className='absolute bottom-4 left-4 right-4 rounded-2xl bg-black/50 p-3 text-xs text-slate-200'>
                {liveStatus}
              </div>
            </>
          )}
        </div>
      </section>

      <Card className='mb-5'>
        <div className='mb-4 flex items-center justify-between'>
          <div>
            <h2 className='text-lg font-bold'>휴대폰 홈캠 PoC</h2>
            <p className='mt-1 text-sm text-slate-400'>
              공기계 휴대폰에서 Camera Host 화면을 열고 홈캠을 시작하세요.
            </p>
          </div>
          <Smartphone size={24} className='text-blue-300' />
        </div>

        <a
          href='/camera-host'
          className='flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 py-3 text-sm font-bold text-white transition hover:bg-blue-400'
        >
          <Radio size={18} />
          이 기기를 홈캠으로 사용하기
        </a>

        <p className='mt-3 text-xs leading-5 text-slate-500'>
          휴대폰에서는 위 버튼을 눌러 홈캠 모드를 시작하고, 노트북에서는 아래 세션 목록에서 실시간 피드를 확인합니다.
        </p>
      </Card>

      <Card className='mb-5'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>온라인 라이브 세션</h2>
          <button
            type='button'
            onClick={loadSessionsOnly}
            className='rounded-xl bg-slate-800 p-2 text-slate-300'
          >
            <RefreshCw size={18} />
          </button>
        </div>

        {sessions.length === 0 ? (
          <p className='text-sm text-slate-400'>
            현재 온라인 홈캠 세션이 없습니다.
          </p>
        ) : (
          <div className='space-y-3'>
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                type='button'
                disabled={connecting}
                onClick={() => connectToSession(session)}
                className='w-full rounded-2xl bg-slate-800/70 p-4 text-left transition hover:bg-slate-800 disabled:opacity-60'
              >
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='font-semibold'>{session.cameraName || '휴대폰 홈캠'}</p>
                    <p className='mt-1 text-xs text-slate-500'>
                      {session.status} · {session.sessionId}
                    </p>
                  </div>

                  <Wifi size={20} className='text-emerald-300' />
                </div>
              </button>
            ))}
          </div>
        )}

        {selectedSession && (
          <button
            type='button'
            onClick={() => stopViewer(true)}
            className='mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-800 py-3 text-sm font-bold text-slate-200'
          >
            <WifiOff size={18} />
            라이브 연결 종료
          </button>
        )}
      </Card>

      <div className='mb-5 flex justify-end'>
        <button
          type='button'
          onClick={() => setIsFormOpen(true)}
          className='flex items-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400'
        >
          <Plus size={18} />
          카메라 추가
        </button>
      </div>

      <div className='space-y-3'>
        {cameraList.map((camera) => (
          <Card key={camera.id} className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='font-semibold'>{camera.name}</p>
                <p className='mt-1 text-sm text-slate-400'>
                  {camera.location || '위치 미지정'}
                </p>
              </div>

              <StatusBadge type={camera.status === 'online' ? 'normal' : 'warning'}>
                {camera.status === 'online' ? '온라인' : '오프라인'}
              </StatusBadge>
            </div>

            <div className='mt-3 flex items-center gap-4 text-xs text-slate-500'>
              <span>{camera.resolution || '-'}</span>
              <span>{camera.fps || 0}fps</span>
              <span>{camera.analysis_enabled ? 'AI 분석 ON' : 'AI 분석 OFF'}</span>
            </div>
          </Card>
        ))}
      </div>

      {isFormOpen && (
        <div className='fixed inset-0 z-50 flex items-end bg-black/60 px-4 pb-4'>
          <form
            onSubmit={handleSubmit}
            className='mx-auto w-full max-w-[430px] rounded-[28px] border border-slate-700 bg-slate-900 p-5 shadow-2xl'
          >
            <div className='mb-4 flex items-center justify-between'>
              <div>
                <h2 className='text-lg font-bold'>카메라 추가</h2>
                <p className='mt-1 text-xs text-slate-400'>
                  홈캠 연동 방식은 추후 추가 예정입니다. 현재는 프로토타입용 정보만 등록합니다.
                </p>
              </div>

              <button
                type='button'
                onClick={() => setIsFormOpen(false)}
                className='rounded-full bg-slate-800 p-2 text-slate-400'
              >
                <X size={18} />
              </button>
            </div>

            {formError && (
              <p className='mb-3 rounded-2xl bg-rose-400/10 p-3 text-sm text-rose-300'>
                {formError}
              </p>
            )}

            <div className='space-y-3'>
              <input
                name='name'
                value={form.name}
                onChange={handleChange}
                placeholder='카메라 이름'
                className='w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-blue-400'
              />

              <input
                name='location'
                value={form.location}
                onChange={handleChange}
                placeholder='설치 위치'
                className='w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-blue-400'
              />

              <input
                name='stream_url'
                value={form.stream_url}
                onChange={handleChange}
                placeholder='스트림 URL 또는 연동 정보'
                className='w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-blue-400'
              />

              <div className='grid grid-cols-2 gap-3'>
                <input
                  name='resolution'
                  value={form.resolution}
                  onChange={handleChange}
                  placeholder='해상도'
                  className='w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-blue-400'
                />

                <input
                  name='fps'
                  type='number'
                  value={form.fps}
                  onChange={handleChange}
                  placeholder='FPS'
                  className='w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-blue-400'
                />
              </div>

              <label className='flex items-center gap-3 rounded-2xl bg-slate-950 px-4 py-3 text-sm text-slate-300'>
                <input
                  type='checkbox'
                  name='analysis_enabled'
                  checked={form.analysis_enabled}
                  onChange={handleChange}
                  className='h-4 w-4'
                />
                AI 분석 활성화
              </label>
            </div>

            <button
              type='submit'
              disabled={saving}
              className='mt-5 w-full rounded-2xl bg-blue-500 py-3 text-sm font-bold text-white transition hover:bg-blue-400 disabled:opacity-60'
            >
              {saving ? '저장 중...' : '카메라 등록'}
            </button>
          </form>
        </div>
      )}
    </main>
  )
}

export default LivePage
