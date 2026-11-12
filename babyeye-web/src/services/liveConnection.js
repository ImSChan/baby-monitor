import { buildLiveWebSocketUrl, getLiveConfig, createLiveSession, endLiveSession } from '../api/liveApi'
import { getAccessToken } from '../api/authToken'

export const liveCloseMessage = code => ({
  4401: '로그인이 만료되었습니다. 다시 로그인해주세요.',
  4404: '홈캠이 종료되었거나 현재 계정으로 연결할 수 없습니다.',
  4409: '이미 다른 기기가 이 연결을 사용 중입니다. 기존 연결을 종료해주세요.',
  1008: '이 환경에서 라이브 연결이 허용되지 않습니다.',
  1012: '서버가 재시작되었습니다. 홈캠을 다시 시작해주세요.',
}[code] || '라이브 연결이 종료되었습니다.')

export function authenticatedSocket({ sessionId, role, token, onReady, onMessage, onEnd }) {
  const socket = new WebSocket(buildLiveWebSocketUrl(sessionId, role))
  let closed = false, ready = false, heartbeat, lastPong = Date.now(), chain = Promise.resolve()
  const early = []
  const timeout = setTimeout(() => finish('라이브 인증 연결 시간이 초과되었습니다.'), 10000)
  function clear() { clearTimeout(timeout); clearInterval(heartbeat) }
  function close() {
    if (closed) return
    closed = true; clear()
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    socket.close()
  }
  function finish(reason, code) {
    if (closed) return
    close()
    onEnd(reason, code)
    if (code === 4401 && getAccessToken() === token) window.dispatchEvent(new Event('babyeye:unauthorized'))
  }
  function send(message) {
    if (!closed && ready && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
  async function consume(message) {
    if (closed) return
    if (message.type === 'authenticated') {
      if (message.protocolVersion !== 2 || message.role !== role || message.sessionId !== sessionId) throw new Error('라이브 인증 응답이 올바르지 않습니다.')
      if (ready) return
      ready = true; lastPong = Date.now(); clearTimeout(timeout)
      heartbeat = setInterval(() => {
        if (Date.now() - lastPong > 30000) finish('서버 응답이 없어 라이브 연결을 종료했습니다.')
        else send({ type: 'ping' })
      }, 10000)
      await onReady(message)
      for (const pending of early.splice(0)) await onMessage(pending)
    } else if (message.type === 'session-ended') {
      finish(liveCloseMessage(message.code), message.code)
    } else if (message.type === 'pong') lastPong = Date.now()
    else if (ready) await onMessage(message)
    else if (early.length < 20) early.push(message)
    else throw new Error('라이브 인증에 실패했습니다.')
  }
  socket.onopen = () => {
    if (!closed) socket.send(JSON.stringify({ type: 'authenticate', token }))
  }
  socket.onmessage = event => {
    chain = chain.then(() => consume(JSON.parse(event.data))).catch(error => finish(error.message || '라이브 연결 처리 중 오류가 발생했습니다.'))
  }
  socket.onerror = () => finish('라이브 서버에 연결하지 못했습니다.')
  socket.onclose = event => finish(liveCloseMessage(event.code), event.code)
  return { send, close }
}

function mediaPeer({ configuration, negotiationId, send, stream, onStream, onStatus, onFailure }) {
  const connection = new RTCPeerConnection({ iceServers: configuration.iceServers })
  const pending = []
  let closed = false, disconnectTimer
  const connectionTimer = setTimeout(() => {
    if (!closed && connection.connectionState !== 'connected') onFailure('영상 연결 시간이 초과되었습니다. 네트워크와 TURN 설정을 확인해주세요.')
  }, 30000)
  if (stream) stream.getTracks().forEach(track => connection.addTrack(track, stream))
  connection.ontrack = event => { if (!closed) onStream?.(event.streams[0]) }
  connection.onicecandidate = event => {
    if (!closed && event.candidate) send({ type: 'candidate', candidate: event.candidate, negotiationId })
  }
  connection.onconnectionstatechange = () => {
    if (closed) return
    clearTimeout(disconnectTimer)
    if (connection.connectionState === 'connected') {
      clearTimeout(connectionTimer); onStatus('P2P 라이브 연결 완료')
    } else if (connection.connectionState === 'failed') {
      onFailure('영상 연결에 실패했습니다. 다른 네트워크에서는 TURN 서버가 필요할 수 있습니다.')
    } else if (connection.connectionState === 'disconnected') {
      onStatus('연결 복구를 기다리는 중입니다…')
      disconnectTimer = setTimeout(() => onFailure('영상 연결이 끊겼습니다.'), 10000)
    }
  }
  return {
    connection, negotiationId,
    async remote(description) {
      await connection.setRemoteDescription(description)
      if (closed) return
      for (const candidate of pending.splice(0)) await connection.addIceCandidate(candidate)
    },
    async candidate(candidate) {
      if (closed) return
      if (!connection.remoteDescription) {
        if (pending.length >= 256) throw new Error('너무 많은 ICE 후보를 받았습니다.')
        pending.push(candidate)
      } else await connection.addIceCandidate(candidate)
    },
    close() {
      if (closed) return
      closed = true; pending.length = 0
      clearTimeout(connectionTimer); clearTimeout(disconnectTimer)
      connection.ontrack = connection.onicecandidate = connection.onconnectionstatechange = null
      connection.close()
    },
  }
}

class LiveController {
  constructor({ onState, onStream } = {}) {
    this.onState = onState; this.onStream = onStream; this.generation = 0
  }
  patch(update) { this.state = { ...this.state, ...update }; this.onState?.({ ...this.state }) }
  current(run) { return run === this.generation && this.token === getAccessToken() }
  release() {
    this.generation++
    this.abort?.abort(); this.abort = null
    this.peer?.close(); this.peer = null
    this.socket?.close(); this.socket = null
  }
}

export class LiveViewer extends LiveController {
  constructor(options) {
    super(options)
    this.state = { selectedSession: null, connecting: false, receiving: false, status: '라이브 세션 대기 중', error: '' }
  }
  stop(reason = '라이브 연결이 종료되었습니다.', error = '') {
    this.release()
    this.remoteStream?.getTracks().forEach(track => track.stop()); this.remoteStream = null
    this.onStream?.(null)
    this.patch({ selectedSession: null, connecting: false, receiving: false, status: reason, error })
  }
  async start(session) {
    if (this.state.selectedSession?.sessionId === session.sessionId) return
    this.stop()
    const run = this.generation
    this.token = getAccessToken(); this.abort = new AbortController()
    this.patch({ selectedSession: session, connecting: true, status: '같은 계정의 홈캠에 연결 중입니다…', error: '' })
    try {
      if (!this.token) throw new Error('먼저 로그인해주세요.')
      const configuration = await getLiveConfig({ signal: this.abort.signal })
      if (!this.current(run)) return
      this.socket = authenticatedSocket({ sessionId: session.sessionId, role: 'viewer', token: this.token,
        onReady: message => {
          if (!this.current(run)) return
          this.peer = mediaPeer({ configuration, negotiationId: message.negotiationId,
            send: data => this.socket?.send(data),
            onStream: stream => {
              if (!this.current(run)) { stream?.getTracks().forEach(track => track.stop()); return }
              this.remoteStream = stream; this.onStream?.(stream)
              this.patch({ connecting: false, receiving: true, status: '실시간 영상 수신 중입니다.' })
            },
            onStatus: status => { if (this.current(run)) this.patch({ connecting: false, status }) },
            onFailure: reason => { if (this.current(run)) this.stop(reason, reason) },
          })
          this.patch({ connecting: false, status: '홈캠 영상 연결을 기다리는 중입니다…' })
        },
        onMessage: async message => {
          const peer = this.peer
          if (!this.current(run) || !peer || message.negotiationId !== peer.negotiationId) return
          if (message.type === 'offer') {
            await peer.remote(message.offer)
            if (!this.current(run) || this.peer !== peer) return
            const answer = await peer.connection.createAnswer()
            if (!this.current(run) || this.peer !== peer) return
            await peer.connection.setLocalDescription(answer)
            if (this.current(run) && this.peer === peer) this.socket.send({ type: 'answer', answer, negotiationId: peer.negotiationId })
          } else if (message.type === 'candidate') await peer.candidate(message.candidate)
        },
        onEnd: (reason, code) => { if (this.current(run)) this.stop(reason, code !== 1000 ? reason : '') },
      })
    } catch (error) { if (this.current(run)) this.stop('라이브 연결 실패', error.message) }
  }
}

export class LiveHost extends LiveController {
  constructor(options) {
    super(options)
    this.state = { sessionId: '', isStarting: false, isStreaming: false, status: 'idle', error: '' }
  }
  stop(reason = 'idle', error = '') {
    const sessionId = this.state.sessionId, token = this.token
    this.release()
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop() }); this.stream = null
    this.onStream?.(null)
    this.patch({ sessionId: '', isStarting: false, isStreaming: false, status: reason, error })
    if (sessionId) void endLiveSession(sessionId, token)
  }
  async offer(negotiationId, configuration, run) {
    if (!this.current(run) || this.peer?.negotiationId === negotiationId) return
    this.peer?.close()
    const peer = mediaPeer({ configuration, negotiationId, stream: this.stream,
      send: data => this.socket?.send(data),
      onStatus: status => { if (this.current(run)) this.patch({ status }) },
      onFailure: reason => {
        if (this.current(run) && this.peer === peer) {
          this.peer.close(); this.peer = null
          this.patch({ status: reason + ' 시청 기기에서 다시 연결해주세요.' })
        }
      },
    })
    this.peer = peer
    const offer = await peer.connection.createOffer()
    if (!this.current(run) || this.peer !== peer) return
    await peer.connection.setLocalDescription(offer)
    if (this.current(run) && this.peer === peer) this.socket.send({ type: 'offer', offer, negotiationId })
  }
  async start() {
    if (this.state.isStarting || this.state.isStreaming) return
    this.stop()
    const run = this.generation
    this.token = getAccessToken(); const token = this.token
    this.abort = new AbortController()
    this.patch({ isStarting: true, status: '홈캠 연결을 준비하는 중입니다…', error: '' })
    try {
      if (!token) throw new Error('먼저 로그인해주세요.')
      const configuration = await getLiveConfig({ signal: this.abort.signal })
      if (!this.current(run)) return
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true,
      })
      if (!this.current(run)) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream; this.onStream?.(stream)
      stream.getTracks().forEach(track => { track.onended = () => { if (this.current(run)) this.stop('카메라 또는 마이크 사용이 중지되었습니다.') } })
      const room = await createLiveSession({ camera_name: '휴대폰 홈캠' }, { signal: this.abort.signal })
      if (!this.current(run)) { void endLiveSession(room.sessionId, token); return }
      this.patch({ sessionId: room.sessionId })
      this.socket = authenticatedSocket({ sessionId: room.sessionId, role: 'host', token,
        onReady: () => { if (this.current(run)) this.patch({ isStarting: false, isStreaming: true, status: '같은 계정의 시청 기기 연결을 기다리는 중입니다.' }) },
        onMessage: async message => {
          if (!this.current(run)) return
          if (message.type === 'viewer-connected') return this.offer(message.negotiationId, configuration, run)
          const peer = this.peer
          if (!peer || message.negotiationId !== peer.negotiationId) return
          if (message.type === 'answer') await peer.remote(message.answer)
          else if (message.type === 'candidate') await peer.candidate(message.candidate)
          else if (message.type === 'viewer-disconnected') {
            peer.close(); this.peer = null
            this.patch({ status: '시청자가 연결을 종료했습니다. 새 연결을 기다립니다.' })
          }
        },
        onEnd: (reason, code) => { if (this.current(run)) this.stop(reason, code !== 1000 ? reason : '') },
      })
    } catch (error) { if (this.current(run)) this.stop('홈캠 시작에 실패했습니다.', error.message) }
  }
}
