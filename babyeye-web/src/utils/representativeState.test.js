import {it,expect} from 'vitest'
import {averageConsecutive,representativeFromHistory} from './representativeState'
const vectors=[[.7,.1,.2],[.8,.35,.05],[.9,.02,.08]]
const rows=()=>vectors.map(([feeding,care,sleep],i)=>({id:3-i,camera_id:1,need:'feeding',confidence:feeding,topPredictions:[{need:'feeding',confidence:feeding},{need:'care',confidence:care},{need:'sleep',confidence:sleep}]}))
it('averages by class and reranks the alternatives after per-frame rank swaps',()=>{
 const result=averageConsecutive(rows())
 expect(result.confidence).toBe(.8)
 expect(result.sampleIds).toEqual([1,2,3])
 expect(result.topPredictions.map(item=>[item.need,item.confidence])).toEqual([['feeding',.8],['care',.156667],['sleep',.11]])
})
it('does not count missing values as zero or invent a third score',()=>{
 const data=rows();data[0].topPredictions=data[0].topPredictions.filter(item=>item.need!=='care')
 const result=averageConsecutive(data);expect(result.candidateCoverage.care).toBe(2)
 expect(result.topPredictions.map(item=>item.need)).toEqual(['feeding','sleep'])
})
it('keeps a previous confirmed triplet when two newer results disagree',()=>{
 const data=[...rows(),{id:5,camera_id:1,need:'care',confidence:.8},{id:4,camera_id:1,need:'care',confidence:.7}]
 expect(representativeFromHistory(data).sampleIds).toEqual([1,2,3])
})
it('does not combine different cameras and accepts aliases',()=>{
 const data=rows();data[0].camera_id=2;expect(averageConsecutive(data)).toBeNull()
 expect(representativeFromHistory(data)).toBeNull()
 data[0].camera_id=1;data[0].need='hungry';expect(averageConsecutive(data).need).toBe('feeding')
})
it('shows a real zero score only when it is recorded in every sample',()=>{
 const data=rows();for(const row of data)row.topPredictions.find(item=>item.need==='sleep').confidence=0
 expect(averageConsecutive(data).topPredictions.find(item=>item.need==='sleep').confidence).toBe(0)
})
