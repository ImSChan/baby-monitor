import { apiGet } from './client'

export async function getLatestStateNotification(options = {}) {
  const limit=100
  let offset=0
  while(true){
    if(options.signal?.aborted)throw new DOMException('Request cancelled','AbortError')
    const data=await apiGet('/api/push/events?limit='+limit+'&offset='+offset,options)
    if(!Array.isArray(data?.items))throw new Error('알림 목록을 확인하지 못했어요.')
    const event=data.items.find(item=>item.result?.kind!=='review' &&
      [item.result?.need,item.result?.emotion].some(value=>typeof value==='string'&&value.trim()))
    if(event)return {...event.result,notificationId:event.id,
      createdAt:event.result.createdAt||event.result.created_at||event.createdAt,
      notificationCreatedAt:event.createdAt}
    if(data.items.length<limit)return null
    offset+=data.items.length
  }
}
