import {beforeEach,it,expect,vi} from 'vitest'
import {getLatestStateNotification} from './notificationApi'
const mock=vi.hoisted(()=>({get:vi.fn()}))
vi.mock('./client',()=>({apiGet:mock.get}))
beforeEach(()=>{mock.get.mockReset()})
it('uses the latest state alert even if read, expired, old or missing the new confirmation fields',async()=>{
 mock.get.mockResolvedValue({items:[{id:9,createdAt:'2024-01-01T10:00:00',readAt:'2024-01-01T10:01:00',status:'expired',result:{emotion:'불편함',confidence:.87}}]})
 const result=await getLatestStateNotification()
 expect(result).toMatchObject({notificationId:9,emotion:'불편함',confidence:.87,createdAt:'2024-01-01T10:00:00'})
})
it('skips newer review reminders and malformed entries without requiring three-hit data',async()=>{
 mock.get.mockResolvedValue({items:[{id:12,result:{kind:'review',emotion:'돌아보기'}},{id:11,result:null},{id:10,result:{need:'feeding',confidence:.7}}]})
 expect((await getLatestStateNotification()).notificationId).toBe(10)
})
it('searches older pages when the most recent page contains only review reminders',async()=>{
 mock.get.mockResolvedValueOnce({items:Array.from({length:100},(_,i)=>({id:200-i,result:{kind:'review'}}))})
   .mockResolvedValueOnce({items:[{id:9,result:{emotion:'졸림'}}]})
 expect((await getLatestStateNotification()).notificationId).toBe(9)
 expect(mock.get).toHaveBeenLastCalledWith('/api/push/events?limit=100&offset=100',{})
})
it('returns null when only review notifications or an empty list exist',async()=>{
 mock.get.mockResolvedValue({items:[{id:4,result:{kind:'review',emotion:'돌아보기'}}]})
 expect(await getLatestStateNotification()).toBeNull()
 mock.get.mockResolvedValue({items:[]});expect(await getLatestStateNotification()).toBeNull()
})
it('keeps timestamp, score and all candidate ranks from the same notification',async()=>{
 const top=[{need:'care',confidence:.87},{need:'feeding',confidence:.2},{need:'sleep',confidence:.12}]
 mock.get.mockResolvedValue({items:[{id:3,createdAt:'2026-01-01T11:00:00',result:{need:'care',createdAt:'2026-01-01T10:59:00',confidence:.87,topPredictions:top}}]})
 expect(await getLatestStateNotification()).toMatchObject({notificationId:3,createdAt:'2026-01-01T10:59:00',confidence:.87,topPredictions:top})
})
it('aborts pagination without issuing a request for a cancelled account',async()=>{
 const abort=new AbortController();abort.abort()
 await expect(getLatestStateNotification({signal:abort.signal})).rejects.toMatchObject({name:'AbortError'})
 expect(mock.get).not.toHaveBeenCalled()
})
it('propagates retrieval errors so empty and unavailable remain distinct',async()=>{
 mock.get.mockRejectedValue(new Error('offline'))
 await expect(getLatestStateNotification()).rejects.toMatchObject({message:'offline'})
})
