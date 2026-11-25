import { Link } from 'react-router-dom'
import { Clock3 } from 'lucide-react'
import { analysisTime, babyStatus, formatAnalysisTime, predictions, score } from '../../utils/babyStatus'
import CareContextNote from '../care/CareContextNote'

export default function BabyStatusOverview({ result, loading, unavailable }) {
  const status=babyStatus(result),time=analysisTime(result),confidence=score(result?.confidence)
  const seen=new Set([status.key])
  const alternatives=predictions(result).filter(item=>{const key=babyStatus(item).key;if(seen.has(key))return false;seen.add(key);return true}).slice(0,2)
  return <section id="baby-status" aria-label="최근 아기 상태" className="scroll-mt-5 overflow-hidden rounded-[28px] border border-blue-300/25 bg-gradient-to-br from-[#182743] via-[#121e35] to-[#101b30] p-5">
    {result?<>
      <div className="mb-4 flex items-center justify-between gap-2 text-xs text-slate-400"><p className="flex items-center gap-1.5"><Clock3 size={13}/>{formatAnalysisTime(time)} 분석</p><span className="shrink-0 text-[10px] text-blue-200/70">{result.aggregationPending?'최근 상태 알림':'3회 연속 · 평균'}</span></div>
      <div aria-label="대표 상태" className="flex items-baseline gap-3"><h2 className="text-3xl font-bold tracking-tight text-white">{status.label}</h2><span className="text-sm tabular-nums text-slate-400">{result.aggregationPending?'평균 확인 중':confidence==null?'점수 없음':confidence+'%'}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-3">{[0,1].map(index=>{
        const item=alternatives[index],value=score(item?.confidence)
        return <p key={index} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-xs text-slate-400"><span className="text-[10px] text-slate-500">{index+2}순위</span>{item?<><span className="text-slate-300">{babyStatus(item).label}</span><span className="tabular-nums">{value==null?'점수 없음':value+'%'}</span></>:<span>기록 없음</span>}</p>
      })}</div>
      <p className="mt-3 text-[10px] text-slate-500">{result.aggregationPending?'3건 평균 기록을 확인하기 전에는 점수를 표시하지 않아요.':'AI 예측 점수 · 같은 상태로 연속 감지된 3건의 평균'}</p>
    </>:<div className="py-2"><p className="text-sm text-slate-300">{loading?'분석 상태를 확인하고 있어요':unavailable?'대표 상태를 불러오지 못했어요':'3회 연속 감지 대기 중'}</p><p className="mt-2 text-xs leading-5 text-slate-500">{unavailable?'연결 상태를 확인하고 다시 시도해주세요.':'같은 상태가 3회 연속 감지되면 해당 3건의 평균 점수를 표시해요.'}</p>{!loading&&<Link to="/camera-host" className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold">홈캠 분석 시작</Link>}</div>}
    <CareContextNote context={result?.careContext}/>
  </section>
}
