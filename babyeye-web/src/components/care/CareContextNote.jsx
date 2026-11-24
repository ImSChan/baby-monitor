import { Link } from 'react-router-dom'
export default function CareContextNote({ context }) {
  if (!context || context.reason === 'snapshot_missing') return null
  const reasons = { child_age_missing:'아이 월령을 입력하면 육아 기록을 판단에 참고할 수 있어요.', age_timing_not_supported:'현재 월령은 시간 기록으로 AI 점수를 보정하지 않아요.', parent_disabled:'육아 기록 참고가 꺼져 있어요.', no_records:'참고할 육아 기록이 아직 없어요.',
    capture_time_unknown:'촬영 시각을 확인하지 못해 육아 기록은 참고하지 않았어요.', capture_time_out_of_range:'촬영 시각에 맞는 기록을 참고하지 않았어요.' }
  return <details className="mt-3 rounded-xl border border-indigo-300/15 bg-indigo-300/5 p-3 text-xs text-slate-300">
    <summary className="cursor-pointer font-medium text-indigo-200">{context.applied ? '육아 기록을 함께 참고했어요' : '육아 기록 참고 내역'}</summary>
    <div className="mt-2 space-y-2 leading-5">
      {context.ageMonths!=null&&<p>분석 시점 추정 월령: 약 {context.ageMonths}개월</p>}
      {context.applied ? <>{context.adjustments?.map(row => <p key={row.need}>{row.reason}</p>)}<p>영상·소리 결과에 시간 기록을 더해 점수를 최대 6%p 범위에서 조정했어요.</p></>
        : <p>{reasons[context.reason] || '기록을 확인했지만 시간만으로 판단을 바꾸지 않았어요.'}</p>}
      {context.recordedSleepMinutes24h != null && <p>지난 24시간에 기록된 수면: {Math.round(context.recordedSleepMinutes24h/60*10)/10}시간. 누락된 기록이 있을 수 있어요.</p>}
      <Link to="/care" className="inline-block text-indigo-200 underline">육아 기록 확인</Link>
    </div>
  </details>
}
