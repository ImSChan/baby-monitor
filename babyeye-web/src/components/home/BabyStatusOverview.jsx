import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, HelpCircle } from 'lucide-react'
import { analysisTime, babyStatus, formatAnalysisTime, predictions, score } from '../../utils/babyStatus'
import CareContextNote from '../care/CareContextNote'

const themes = {
  stable: { accent: '#34D399', tint: '#153D37', border: '#2C6658' },
  feeding: { accent: '#FBBF24', tint: '#44351F', border: '#75602D' },
  care: { accent: '#FB923C', tint: '#472C27', border: '#79503A' },
  sleep: { accent: '#FDBA74', tint: '#3D3042', border: '#73566A' },
  unknown: { accent: '#93C5FD', tint: '#233653', border: '#425879' },
}

function StatusGauge({ state, value, theme }) {
  return <svg viewBox="0 0 112 112" className="h-20 w-20 shrink-0 min-[360px]:h-28 min-[360px]:w-28" role="img" aria-label={value == null ? '예측 점수 확인 중' : `예측 점수 ${value}%`}>
    <circle cx="56" cy="56" r="48" fill="none" stroke="white" strokeOpacity=".07" strokeWidth="6"/>
    {value != null && <circle cx="56" cy="56" r="48" fill="none" stroke={theme.accent} strokeWidth="6" strokeLinecap="round" pathLength="100" strokeDasharray={`${value} 100`} transform="rotate(-90 56 56)"/>}
    <circle cx="56" cy="56" r="39" fill={theme.tint}/>
    <g stroke="#F7D9B3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="31" cy="59" r="5" fill="#F7D9B3"/><circle cx="81" cy="59" r="5" fill="#F7D9B3"/>
      <ellipse cx="56" cy="58" rx="25" ry="26" fill="#F7D9B3" stroke="none"/>
      <path d="M53 33q-4-10 4-10q7 1 2 7" fill="none"/>
    </g>
    <g fill="none" stroke="#654836" strokeWidth="2.5" strokeLinecap="round">
      {state === 'sleep' ? <><path d="M41 56q4 4 8 0M63 56q4 4 8 0"/><ellipse cx="56" cy="70" rx="3" ry="4"/></> : state === 'care' ? <><path d="m41 51 8 3m14 0 8-3M42 59h4m20 0h4M50 73q6-6 12 0"/></> : <><path d="M43 55v3m26-3v3"/>{state === 'feeding' ? <ellipse cx="56" cy="70" rx="4" ry="5"/> : <path d="M49 68q7 9 14 0"/>}</>}
    </g>
    <ellipse cx="39" cy="65" rx="5" ry="3" fill="#EFAB99" opacity=".7"/><ellipse cx="73" cy="65" rx="5" ry="3" fill="#EFAB99" opacity=".7"/>
    {state === 'sleep' && <text x="82" y="33" fill={theme.accent} fontSize="13" fontWeight="bold">z</text>}
  </svg>
}

function ScoreHelp({ pending }) {
  const [open, setOpen] = useState(false)
  const id = useId(), container = useRef(null), button = useRef(null)
  useEffect(() => {
    if (!open) return
    const outside = event => { if (!container.current?.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div ref={container} className="contents">
    <button ref={button} type="button" aria-label="AI 예측 점수 설명" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"><HelpCircle size={17}/></button>
    {open && <p id={id} className="order-last mt-1 basis-full rounded-xl border border-slate-600 bg-slate-800 p-3 text-xs leading-5 text-slate-200 shadow-lg">{pending ? '3건 평균 기록을 확인하기 전에는 점수를 표시하지 않아요.' : 'AI 예측 점수 · 같은 상태로 연속 감지된 3건의 평균'}</p>}
  </div>
}

export default function BabyStatusOverview({ result, loading, unavailable }) {
  const status = babyStatus(result), time = analysisTime(result)
  const confidence = result?.aggregationPending ? null : score(result?.confidence)
  const theme = themes[status.key] || themes.unknown
  const seen = new Set([status.key])
  const alternatives = predictions(result).filter(item => { const key = babyStatus(item).key; if (seen.has(key)) return false; seen.add(key); return true }).slice(0, 2)
  return <section id="baby-status" aria-label="최근 아기 상태" style={{ '--status-accent': theme.accent, '--status-tint': theme.tint, '--status-border': theme.border }} className="scroll-mt-5 rounded-3xl border border-[var(--status-border)] bg-gradient-to-br from-[#1C2A40] to-[#131E30] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.18)]">
    {result ? <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><p className="flex items-center gap-1.5"><Clock3 size={13}/>{formatAnalysisTime(time)} 분석</p><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-slate-300">{result.aggregationPending ? '최근 상태 알림' : '3회 연속 · 평균'}</span></div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1"><div aria-label="대표 상태" className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1"><h2 className="text-2xl font-bold tracking-tight min-[360px]:text-3xl text-white">{status.label}</h2><span className="text-base font-semibold tabular-nums text-[var(--status-accent)]">{result.aggregationPending ? '평균 확인 중' : confidence == null ? '점수 없음' : confidence + '%'}</span><ScoreHelp key={result.aggregationPending ? 'pending' : 'averaged'} pending={result.aggregationPending}/></div></div>
        <StatusGauge state={status.key} value={confidence} theme={theme}/>
      </div>
      <div className="mb-5 mt-4 flex flex-wrap gap-2">{[0, 1].map(index => {
        const item = alternatives[index], value = score(item?.confidence)
        return <p key={index} className={'flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs ' + (item ? 'border-white/10 bg-white/5 text-slate-300' : 'border-transparent bg-white/[0.03] text-slate-500')}><span className="text-[10px] text-slate-500">{index + 2}순위</span>{item ? <><span>{babyStatus(item).label}</span><span className="tabular-nums text-slate-400">{value == null ? '점수 없음' : value + '%'}</span></> : <span>기록 없음</span>}</p>
      })}</div>
    </> : <div className="py-3"><p className="text-sm font-semibold text-slate-200">{loading ? '분석 상태를 확인하고 있어요' : unavailable ? '대표 상태를 불러오지 못했어요' : '3회 연속 감지 대기 중'}</p><p className="mt-2 text-xs leading-5 text-slate-400">{unavailable ? '연결 상태를 확인하고 다시 시도해주세요.' : '같은 상태가 3회 연속 감지되면 해당 3건의 평균 점수를 표시해요.'}</p>{!loading && <Link to="/camera-host" className="mt-4 inline-flex rounded-xl border border-blue-300/40 bg-blue-400/20 px-4 py-3 text-sm font-semibold text-blue-100">홈캠 분석 시작</Link>}</div>}
    <CareContextNote context={result?.careContext}/>
  </section>
}
