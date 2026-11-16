import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock3 } from 'lucide-react'
import { analysisDate, analysisTime, babyStatus, formatAnalysisTime, predictions, score } from '../../utils/babyStatus'
import CareContextNote from '../care/CareContextNote'

export default function BabyStatusOverview({ result, loading, unavailable }) {
  const status = babyStatus(result)
  const time = analysisTime(result)
  const date = analysisDate(time)
  const old = date && Date.now() - date.getTime() > 15 * 60 * 1000
  return <section id="baby-status" aria-label="최근 아기 상태" className="scroll-mt-5 overflow-hidden rounded-[28px] border border-blue-300/25 bg-gradient-to-br from-[#182743] via-[#121e35] to-[#101b30] p-5">
    <div className="mb-4 flex items-center justify-between gap-2">
      <p className="text-xs font-semibold tracking-wide text-blue-200">최근 AI 분석 결과</p>
      <span className={`rounded-full px-2.5 py-1 text-[11px] ${old ? 'bg-amber-300/10 text-amber-200' : 'bg-white/5 text-slate-300'}`}>{loading && !result ? '불러오는 중' : !result ? unavailable ? '연결 확인 필요' : '분석 대기' : old ? '이전 분석 기록' : '마지막 분석'}</span>
    </div>
    {result ? <>
      <div className="flex items-center gap-4"><span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-4xl">{status.icon}</span>
        <div><p className="text-sm text-blue-200">{status.label}</p><h2 className="mt-1 break-keep text-xl font-bold leading-snug tracking-tight">{status.title}</h2></div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">{result.message || status.hint}</p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><Clock3 size={13} />{formatAnalysisTime(time)} 분석</p>
      <div className="mt-5 grid grid-cols-2 gap-2.5">{predictions(result).map((item, i) => {
        const state = babyStatus(item), value = score(item.confidence)
        return <div key={`${state.key}:${i}`} className="rounded-2xl border border-white/5 bg-black/15 p-3">
          <p className="text-[10px] text-slate-400">{i === 0 ? '가장 높은 예측' : '함께 살펴볼 상태'}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><p className="whitespace-nowrap text-[13px] font-semibold">{state.icon} {state.label}</p><p className="ml-auto text-lg font-bold tabular-nums">{value === null ? '—' : `${value}%`}</p></div>
        </div>
      })}</div>
      <p className="mt-2 text-[10px] leading-4 text-slate-500">점수는 AI의 예측값이에요. 당시 아이의 모습과 함께 확인해 주세요.</p>
      <CareContextNote context={result.careContext}/>
    </> : <div className="py-3"><span className="text-4xl" aria-hidden="true">👶</span><h2 className="mt-3 text-xl font-bold">{loading ? '아이의 상태를 불러오고 있어요' : unavailable ? '분석 결과를 불러오지 못했어요' : '첫 분석을 기다리고 있어요'}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{unavailable ? '연결 상태를 확인하고 다시 시도해 주세요.' : '홈캠 분석을 시작하거나 영상을 올리면 여기에 결과를 모아 보여드려요.'}</p>
      {!loading && <Link to="/camera-host" className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold">홈캠 분석 시작</Link>}</div>}
    {result && <Link to="/feedback" className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-sm font-medium text-blue-200">실제 상태 알려주기<ArrowUpRight size={17} /></Link>}
  </section>
}
