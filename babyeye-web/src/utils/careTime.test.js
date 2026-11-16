import {expect,it} from 'vitest'
import {sleepWindow,localInput,durationText} from './careTime'
it('includes the preceding day for an overnight sleep interval',()=>{
  const now=new Date(2026,10,17,12)
  const window=sleepWindow('2026-11-17',now)
  expect(window.start).toBe(new Date(2026,10,16,0).getTime())
  expect(window.end).toBe(now.getTime())
  expect(localInput(new Date(2026,10,17,7,5))).toBe('2026-11-17T07:05')
  expect(durationText(95)).toBe('1시간 35분')
})
