import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ config: vi.fn(), create: vi.fn(), end: vi.fn() }))
vi.mock('../api/liveApi', () => ({ getLiveConfig: api.config, createLiveSession: api.create,
  endLiveSession: api.end, buildLiveWebSocketUrl: (id, role) => `wss://example.test/ws/${id}/${role}` }))
import { LiveHost, LiveViewer } from './liveConnection'
import { registerLiveCleanup, stopAllLiveResources } from './liveResources'
import { setAccessToken, getAccessToken, clearAccessToken } from '../api/authToken'

class Socket {
  static OPEN = 1
  static instances = []
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; Socket.instances.push(this) }
  send(data) { this.sent.push(JSON.parse(data)) }
  close = vi.fn(() => { this.readyState = 3 })
  open() { this.readyState = 1; this.onopen?.({}) }
  frame(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
  remoteClose(code) { this.onclose?.({ code }) }
}
class Peer {
  static instances = []
  constructor() { this.connectionState = 'new'; this.remoteDescription = null; this.order = []; Peer.instances.push(this) }
  addTrack = vi.fn()
  close = vi.fn(() => { this.connectionState = 'closed' })
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer' }))
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer' }))
  setLocalDescription = vi.fn(async value => { this.localDescription = value })
  setRemoteDescription = vi.fn(async value => { this.remoteDescription = value; this.order.push('remote') })
  addIceCandidate = vi.fn(async () => { if (!this.remoteDescription) throw new Error('remote missing'); this.order.push('ice') })
}
const cleanups = [], media = vi.fn()
const stream = () => {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
  return { getTracks: () => tracks, getAudioTracks: () => tracks.slice(1) }
}
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
function tracked(controller) { cleanups.push(registerLiveCleanup(() => controller.stop())); return controller }
async function hostReady() {
  const host = tracked(new LiveHost()); await host.start()
  const ws = Socket.instances.at(-1); ws.open()
  ws.frame({ type:'authenticated', protocolVersion:2, role:'host', sessionId:'room' }); await flush()
  return { host, ws }
}
async function viewerReady() {
  const viewer = tracked(new LiveViewer()); await viewer.start({ sessionId:'room' })
  const ws = Socket.instances.at(-1); ws.open()
  ws.frame({ type:'authenticated', protocolVersion:2, role:'viewer', sessionId:'room', negotiationId:'n1' }); await flush()
  return { viewer, ws, peer: Peer.instances.at(-1) }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); Socket.instances = []; Peer.instances = []
  const storage = new Map()
  vi.stubGlobal('sessionStorage', { getItem:key => storage.get(key) || null,
    setItem:(key,value) => storage.set(key,value), removeItem:key => storage.delete(key) })
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('RTCPeerConnection', Peer)
  Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value:{ getUserMedia:media } })
  setAccessToken('account-one-token')
  api.config.mockResolvedValue({ protocolVersion:2, iceServers:[] })
  api.create.mockResolvedValue({ sessionId:'room' }); api.end.mockResolvedValue()
  media.mockImplementation(async () => stream())
})
afterEach(() => { stopAllLiveResources(); cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers(); vi.unstubAllGlobals() })

it('authenticates in the first frame without credentials in the URL', async () => {
  const { host, ws } = await hostReady()
  expect(ws.url).not.toContain('account-one-token')
  expect(ws.sent[0]).toEqual({ type:'authenticate', token:'account-one-token' })
  expect(host.state.isStreaming).toBe(true)
  expect(ws.sent.some(item => item.type === 'viewer-ready')).toBe(false)
})
it('stops tracks and ends the original account session on logout', async () => {
  const { host, ws } = await hostReady(); const tracks = host.stream.getTracks()
  clearAccessToken()
  expect(tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true)
  expect(ws.close).toHaveBeenCalledOnce()
  expect(api.end).toHaveBeenCalledWith('room','account-one-token')
  expect(host.state.isStreaming).toBe(false)
})
it('suppresses a stale close callback after switching accounts', async () => {
  const { host, ws } = await hostReady(); const oldCallback = ws.onclose
  const expired = vi.fn(); window.addEventListener('babyeye:unauthorized', expired)
  setAccessToken('account-two-token'); oldCallback({ code:4401 })
  expect(getAccessToken()).toBe('account-two-token')
  expect(host.state.isStreaming).toBe(false); expect(expired).not.toHaveBeenCalled()
  window.removeEventListener('babyeye:unauthorized', expired)
})
it('cleans a permission result that resolves after stop', async () => {
  const permission = defer(); media.mockReturnValue(permission.promise)
  const host = tracked(new LiveHost()); const starting = host.start(); await flush()
  host.stop(); const late = stream(); permission.resolve(late); await starting
  expect(late.getTracks().every(track => track.stop.mock.calls.length === 1)).toBe(true)
  expect(api.create).not.toHaveBeenCalled(); expect(Socket.instances).toHaveLength(0)
})
it('ends a late created room and prevents double starts', async () => {
  const creation = defer(); api.create.mockReturnValue(creation.promise)
  const host = tracked(new LiveHost()); const starting = host.start(); host.start(); await flush()
  expect(media).toHaveBeenCalledOnce(); const tracks = host.stream.getTracks()
  host.stop(); setAccessToken('account-two-token'); creation.resolve({ sessionId:'late-room' }); await starting
  expect(api.end).toHaveBeenCalledWith('late-room','account-one-token')
  expect(tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true)
  expect(Socket.instances).toHaveLength(0)
})
it('blocks media and socket creation when the protocol gate fails', async () => {
  api.config.mockRejectedValue(new Error('서버 업데이트 필요'))
  const host = tracked(new LiveHost()); await host.start()
  expect(media).not.toHaveBeenCalled(); expect(Socket.instances).toHaveLength(0)
  expect(host.state.error).toContain('업데이트')
})
it('stops the camera after an unexpected socket close', async () => {
  const { host, ws } = await hostReady(); const tracks = host.stream.getTracks()
  ws.remoteClose(1006)
  expect(host.state.isStreaming).toBe(false)
  expect(tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true)
})
it('queues early ICE until remote SDP and sends one answer', async () => {
  const { viewer, ws, peer } = await viewerReady()
  ws.frame({ type:'candidate', candidate:{candidate:'ice'}, negotiationId:'n1' }); await flush()
  expect(peer.addIceCandidate).not.toHaveBeenCalled()
  ws.frame({ type:'offer', offer:{type:'offer',sdp:'sdp'}, negotiationId:'n1' }); await flush()
  expect(peer.order).toEqual(['remote','ice'])
  expect(ws.sent.filter(item => item.type === 'answer')).toHaveLength(1)
  viewer.stop(); expect(api.end).not.toHaveBeenCalled()
})
it('releases the viewer peer and remote tracks when the host ends', async () => {
  const { viewer, ws, peer } = await viewerReady(); const incoming = stream()
  peer.ontrack({ streams:[incoming] })
  ws.frame({ type:'session-ended', code:1000 }); await flush()
  expect(peer.close).toHaveBeenCalledOnce()
  expect(incoming.getTracks().every(track => track.stop.mock.calls.length === 1)).toBe(true)
  expect(viewer.state.selectedSession).toBe(null); expect(api.end).not.toHaveBeenCalled()
})
it('avoids duplicate offers and ignores a prior viewer negotiation', async () => {
  const { host, ws } = await hostReady()
  ws.frame({ type:'viewer-connected', negotiationId:'n1' }); await flush()
  ws.frame({ type:'viewer-connected', negotiationId:'n1' }); await flush()
  expect(Peer.instances).toHaveLength(1)
  const old = Peer.instances[0]
  ws.frame({ type:'viewer-disconnected', negotiationId:'n1' }); await flush()
  ws.frame({ type:'viewer-connected', negotiationId:'n2' }); await flush()
  const fresh = Peer.instances[1]
  ws.frame({ type:'candidate', candidate:{candidate:'stale'}, negotiationId:'n1' }); await flush()
  expect(old.close).toHaveBeenCalledOnce(); expect(fresh.addIceCandidate).not.toHaveBeenCalled()
  expect(host.state.isStreaming).toBe(true)
})
it('reports occupied viewer slots clearly', async () => {
  const viewer = tracked(new LiveViewer()); await viewer.start({sessionId:'room'})
  Socket.instances[0].remoteClose(4409)
  expect(viewer.state.selectedSession).toBe(null)
  expect(viewer.state.error).toContain('다른 기기')
})
it('expires the connection when heartbeats stop responding', async () => {
  const { host } = await hostReady(); const tracks = host.stream.getTracks()
  await vi.advanceTimersByTimeAsync(40000)
  expect(host.state.isStreaming).toBe(false)
  expect(tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true)
})
it('cancels startup when socket authentication never finishes', async () => {
  const host = tracked(new LiveHost()); await host.start(); const tracks = host.stream.getTracks()
  await vi.advanceTimersByTimeAsync(10001)
  expect(host.state.isStarting).toBe(false)
  expect(tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true)
})
