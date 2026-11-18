import { useEffect, useState } from 'react'
import { analysisDate, formatAnalysisTime } from '../../utils/babyStatus'

export const frameLabels = { idle: '연결 안 됨', waiting: '첫 영상 확인 중', live: '영상 갱신 중', stalled: '영상 갱신이 멈췄어요', hidden: '화면 비활성 · 확인 대기', unknown: '영상 갱신 확인 불가' }
function elapsed(value, now) {
  if (!value) return '아직 확인되지 않았어요'
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  return seconds < 60 ? seconds + '초 전' : Math.floor(seconds / 60) + '분 전'
}
export default function LiveHealthCard({ freshness, lastCompletedAt, analysisError, analysisLoading = false, host = false, analysisEnabled, analysisBusy }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return <section aria-label="홈캠 연결 상태" className="mb-5 rounded-2xl border border-slate-700 bg-slate-900 p-4">
    <h2 className="font-bold">홈캠 연결 상태</h2>
    <p role="status" className={'mt-2 text-sm ' + (freshness.phase === 'live' ? 'text-emerald-300' : 'text-amber-200')}>{frameLabels[freshness.phase]}</p>
    <p className="mt-2 text-sm text-slate-300">{host ? '마지막 카메라 화면 확인' : '마지막 영상 수신 확인'}: {elapsed(freshness.lastFrameAt, now)}</p>
    {freshness.lastFrameAt && <p className="text-xs text-slate-400">{formatAnalysisTime(new Date(freshness.lastFrameAt).toISOString())}</p>}
    {freshness.phase === 'stalled' && <p className="mt-2 text-sm text-amber-200">멈춘 화면일 수 있어요. 아이의 현재 모습을 직접 확인하고 홈캠과 네트워크 연결을 확인해 주세요.</p>}
    <p className="mt-3 text-sm text-slate-300">{host ? '이 홈캠의 마지막 AI 분석 완료' : '계정의 마지막 AI 분석 완료'}: {lastCompletedAt ? formatAnalysisTime(lastCompletedAt) : analysisError ? '확인 불가' : analysisLoading ? '확인 중…' : '완료 기록 없음'}</p>
    {host && <p className="mt-1 text-xs text-slate-400">{!analysisEnabled ? 'AI 분석 꺼짐' : analysisBusy ? 'AI 분석 처리 중' : 'AI 분석 켜짐'}</p>}
    {!host && <p className="mt-1 text-xs text-slate-400">영상 수신과 AI 분석은 별개예요. 분석 시각은 이 계정의 홈캠·업로드 분석 전체 기준입니다.</p>}
    {lastCompletedAt && (!host || analysisEnabled) && now - (analysisDate(lastCompletedAt)?.getTime() || now) > 60000 && <p className="mt-2 text-xs text-amber-200">최근 1분 동안 새 분석 완료 기록이 없어요. AI 분석 설정과 연결 상태를 확인해 주세요.</p>}
    {analysisError && <p role="alert" className="mt-2 text-xs text-amber-200">분석 완료 시각을 갱신하지 못했어요.</p>}
  </section>
}
