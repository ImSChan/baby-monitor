import { useEffect, useRef, useState } from 'react'
import { Camera, Radio, Square, Video } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import { buildLiveWebSocketUrl, createLiveSession } from '../api/liveApi'

const peerConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
}

function CameraHostPage() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const socketRef = useRef(null)
  const peerRef = useRef(null)

  const [sessionId, setSessionId] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

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
      }

      socket.onclose = () => {
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

  function closePeer() {
    if (peerRef.current) {
      peerRef.current.close()
      peerRef.current = null
    }
  }

  function stopStreaming() {
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

      <Card>
        <p className='text-sm font-semibold text-blue-200'>시연 안내</p>
        <p className='mt-2 text-sm leading-6 text-slate-400'>
          이 화면은 공기계 휴대폰에서 열어두고, 노트북에서는 라이브 피드 탭에서 해당 세션을 선택하면 됩니다.
        </p>
      </Card>
    </main>
  )
}

export default CameraHostPage
