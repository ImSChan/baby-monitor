import {beforeEach,it,expect,vi} from 'vitest'
import {getRepresentativeState} from './representativeApi'
const mock=vi.hoisted(()=>({get:vi.fn(),history:vi.fn(),alert:vi.fn()}))
vi.mock('./client',()=>({apiGet:mock.get}))
vi.mock('./emotionApi',()=>({getEmotionHistory:mock.history}))
vi.mock('./notificationApi',()=>({getLatestStateNotification:mock.alert}))
beforeEach(()=>{vi.resetAllMocks()})
it('uses the authoritative averaged endpoint including null without fallback',async()=>{
 mock.get.mockResolvedValue({need:'care',sampleCount:3,confidence:.8})
 expect((await getRepresentativeState()).confidence).toBe(.8);expect(mock.history).not.toHaveBeenCalled()
 mock.get.mockResolvedValue(null);expect(await getRepresentativeState()).toBeNull();expect(mock.alert).not.toHaveBeenCalled()
})
it('averages actual recent history while an older server lacks the endpoint',async()=>{
 mock.get.mockRejectedValue({status:404});mock.history.mockResolvedValue([1,2,3].map(id=>({id,need:'feeding',confidence:.9})))
 expect((await getRepresentativeState()).confidence).toBe(.9);expect(mock.alert).not.toHaveBeenCalled()
})
it('retains the known old alert but never labels its single score as a triplet mean',async()=>{
 mock.get.mockRejectedValue({status:404});mock.history.mockResolvedValue([])
 mock.alert.mockResolvedValue({need:'care',confidence:.87,topPredictions:[{need:'care',confidence:.87}]})
 expect(await getRepresentativeState()).toMatchObject({need:'care',confidence:null,topPredictions:[],aggregationPending:true})
})
it('does not hide real authentication or server failures behind fallback',async()=>{
 mock.get.mockRejectedValue({status:401});await expect(getRepresentativeState()).rejects.toMatchObject({status:401})
 expect(mock.history).not.toHaveBeenCalled()
})
