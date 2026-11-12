import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ config:vi.fn(), create:vi.fn(), end:vi.fn(), media:vi.fn() }))
vi.mock('../api/liveApi', () => ({ getLiveConfig:mocks.config, createLiveSession:mocks.create,
  endLiveSession:mocks.end, buildLiveWebSocketUrl:() => 'wss://example.test/ws' }))
import { useLiveHost } from './useLiveConnection'
import { setAccessToken } from '../api/authToken'
beforeEach(() => {
  vi.clearAllMocks()
  const storage = new Map()
  vi.stubGlobal('sessionStorage', {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)})
  vi.stubGlobal('WebSocket', class { close=vi.fn(); send=vi.fn() })
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:mocks.media}})
  setAccessToken('token'); mocks.config.mockResolvedValue({protocolVersion:2,iceServers:[]})
  mocks.create.mockResolvedValue({sessionId:'room'}); mocks.end.mockResolvedValue()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('stops camera and server room on pagehide and unmount without duplicate cleanup', async () => {
  const tracks=[{stop:vi.fn()}], stream={getTracks:()=>tracks}
  mocks.media.mockResolvedValue(stream)
  const videoRef={current:{srcObject:null,play:vi.fn().mockResolvedValue()}}
  const {result,unmount}=renderHook(()=>useLiveHost(videoRef))
  await act(async()=>result.current.start())
  expect(videoRef.current.srcObject).toBe(stream)
  act(()=>window.dispatchEvent(new Event('pagehide')))
  expect(tracks[0].stop).toHaveBeenCalledOnce(); expect(videoRef.current.srcObject).toBe(null)
  unmount(); expect(mocks.end).toHaveBeenCalledExactlyOnceWith('room','token')
})
it('stops permission-granted tracks that arrive after route unmount', async () => {
  let grant; mocks.media.mockReturnValue(new Promise(resolve=>{grant=resolve}))
  const tracks=[{stop:vi.fn()}], stream={getTracks:()=>tracks}
  const {result,unmount}=renderHook(()=>useLiveHost({current:null}))
  let starting; await act(async()=>{starting=result.current.start(); await Promise.resolve()})
  unmount(); await act(async()=>{grant(stream); await starting})
  expect(tracks[0].stop).toHaveBeenCalledOnce(); expect(mocks.create).not.toHaveBeenCalled()
})
