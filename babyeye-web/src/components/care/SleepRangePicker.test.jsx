import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SleepRangePicker from './SleepRangePicker'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('accepts a finger drag in either direction as a chronological interval',()=>{
  vi.stubGlobal('PointerEvent',MouseEvent)
  const change=vi.fn(),start=new Date('2026-11-15T00:00:00Z').getTime()
  render(<SleepRangePicker bounds={{start,end:start+86400000}} start={start+3600000} end={start+7200000} onChange={change}/>)
  const track=screen.getByTestId('sleep-drag-track')
  track.getBoundingClientRect=()=>({left:0,width:100})
  fireEvent.pointerDown(track,{clientX:80});fireEvent.pointerMove(track,{clientX:20});fireEvent.pointerUp(track,{clientX:20})
  expect(change).toHaveBeenCalled()
  const [a,b]=change.mock.calls.at(-1)
  expect(a).toBeLessThan(b);expect(a).toBeGreaterThanOrEqual(start);expect(b).toBeLessThanOrEqual(start+86400000)
})
it('prevents the start thumb crossing the end thumb',()=>{
  const change=vi.fn(),start=new Date('2026-11-15T00:00:00Z').getTime()
  render(<SleepRangePicker bounds={{start,end:start+86400000}} start={start+3600000} end={start+7200000} onChange={change}/>)
  fireEvent.change(screen.getByRole('slider',{name:'잠든 시각 조절'}),{target:{value:'100'}})
  const [a,b]=change.mock.calls[0];expect(a).toBeLessThan(b);expect(b-a).toBe(300000)
})
