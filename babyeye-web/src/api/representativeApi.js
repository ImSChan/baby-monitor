import { apiGet } from './client'
import { getEmotionHistory } from './emotionApi'
import { getLatestStateNotification } from './notificationApi'
import { representativeFromHistory } from '../utils/representativeState'

export async function getRepresentativeState(options={}){
 try{return await apiGet('/api/emotions/representative',options)}
 catch(error){if(error.status!==404)throw error}
 // During rollout, old servers can still aggregate real recent observations.
 const rows=await getEmotionHistory(options)
 const result=representativeFromHistory(Array.isArray(rows)?rows:[])
 if(result)return result
 // Retain the known alert state, but never present a single score as a mean.
 const alert=await getLatestStateNotification(options)
 return alert?{...alert,confidence:null,topPredictions:[],top_predictions:[],aggregationPending:true}:null
}
