import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({host:null,stop:vi.fn(),request:vi.fn(),status:vi.fn(),result:vi.fn()}))
vi.mock('../hooks/useLiveConnection',()=>({useLiveHost:()=>mocks.host}))
vi.mock('../api/inferenceApi',()=>({requestMultimodalInference:mocks.request,getInferenceStatus:mocks.status,getInferenceResult:mocks.result}))
import CameraHostPage from './CameraHostPage'
class Audio {
  static instances=[]
  sampleRate=16000
  constructor(){Audio.instances.push(this)}
  resume=vi.fn().mockResolvedValue()
  close=vi.fn().mockResolvedValue()
  createMediaStreamSource(){return {connect:p=>p.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array([.1,.2,.3])}}),disconnect:vi.fn()}}
  createScriptProcessor(){return {connect:vi.fn(),disconnect:vi.fn()}}
}
beforeEach(()=>{
  vi.useFakeTimers(); vi.clearAllMocks(); Audio.instances=[]
  vi.stubGlobal('AudioContext',Audio)
  vi.stubGlobal('MediaStream',class {constructor(tracks){this.tracks=tracks}})
  mocks.host={streamRef:{current:{getAudioTracks:()=>[{}]}},sessionId:'room',status:'streaming',error:'',isStreaming:true,isStarting:false,start:vi.fn(),stop:mocks.stop}
  mocks.request.mockResolvedValue({requestId:'analysis'}); mocks.status.mockResolvedValue({status:'completed'}); mocks.result.mockResolvedValue({result:{emotion:'stable'}})
})
afterEach(()=>{cleanup(); vi.useRealTimers(); vi.unstubAllGlobals()})
it('closes audio processing immediately when the host is stopped and never uploads the cancelled clip',async()=>{
  render(<MemoryRouter><CameraHostPage/></MemoryRouter>)
  fireEvent.click(screen.getByRole('button',{name:'홈캠 중지'}))
  await act(async()=>Promise.resolve())
  expect(Audio.instances[0].close).toHaveBeenCalledOnce()
  await act(async()=>vi.advanceTimersByTimeAsync(6000))
  expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.stop).toHaveBeenCalledOnce()
})
it('aborts an in-flight upload and ignores a late queued analysis response',async()=>{
  let complete; mocks.request.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
  render(<MemoryRouter><CameraHostPage/></MemoryRouter>)
  await act(async()=>vi.advanceTimersByTimeAsync(5000))
  expect(mocks.request).toHaveBeenCalledOnce()
  const signal=mocks.request.mock.calls[0][0].signal
  fireEvent.click(screen.getByRole('button',{name:'홈캠 중지'}))
  expect(signal.aborted).toBe(true)
  await act(async()=>{complete({requestId:'late'}); for(let i=0;i<10;i++)await Promise.resolve()})
  expect(mocks.status).not.toHaveBeenCalled()
})
