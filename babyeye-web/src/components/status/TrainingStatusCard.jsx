import useAccountStatus from '../../hooks/useAccountStatus'
import { formatAnalysisTime } from '../../utils/babyStatus'

const stages = {
  empty: ['피드백을 기다리고 있어요', '알림에서 당시 상태를 알려주면 개인화 학습 자료를 모을 수 있어요.'],
  collecting: ['학습 자료를 모으고 있어요', '피드백을 저장했어요. 학습 가능한 종류와 자료가 충분히 모이면 작업을 준비해요.'],
  queued: ['학습을 기다리고 있어요', '학습 작업이 준비됐어요. 서버에서 차례로 처리해요.'],
  training: ['개인화 학습 중이에요', '저장한 피드백으로 학습하고 있어요. 완료 후 검토를 거쳐 적용해요.'],
  review_ready: ['학습 완료 · 검토 대기', '새 모델을 학습했어요. 검토 후 적용 등록되며, 아직 새 모델이 적용된 상태는 아니에요.'],
  completed_unknown: ['학습 완료 · 적용 확인 필요', '학습은 완료됐지만 현재 모델 적용 정보를 확인할 수 없어요.'],
  activation_unknown: ['개인화 적용 정보 확인 필요', '기존 모델 파일이 있지만 적용 등록 정보를 확인할 수 없어요. 관리자 확인이 필요해요.'],
  registered: ['개인화 모델 적용 등록됨', '등록된 개인화 모델을 이후 분석에 사용할 수 있어요. 새 피드백은 계속 모아요.'],
  failed: ['학습 작업 확인이 필요해요', '최근 학습 작업을 완료하지 못했어요. 이미 적용된 모델이 있다면 유지되며, 피드백도 남아 있어요.'],
}
export default function TrainingStatusCard() {
  const { data, error, retry } = useAccountStatus('/api/training/status')
  const [title, message] = stages[data?.stage] || (error ? ['개인화 상태 확인 불가', '연결을 확인하고 다시 시도해 주세요.'] : ['개인화 상태 확인 중', '잠시 기다려 주세요.'])
  return <section aria-label="개인화 학습 상태" className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
    <h2 className="text-sm font-semibold text-blue-200">개인화 학습 상태</h2>
    <p className="mt-2 font-bold">{title}</p>
    <p className="mt-2 text-sm text-slate-400">{message}</p>
    {error && <p role="alert" className="mt-2 text-sm text-amber-200">{error}<button onClick={retry} className="ml-2 underline">다시 확인</button></p>}
    {data && <details className="mt-3 text-sm text-slate-300"><summary className="cursor-pointer">저장 및 적용 내역</summary>
      <p className="mt-3">피드백을 적용한 분석 {data.feedback.total}개 · 학습 제외 {data.feedback.excluded}개</p>
      <p className="mt-1 text-xs text-slate-400">한 번의 응답으로 여러 분석에 반영될 수 있어요. 분석 개수는 학습에 필요한 독립적인 상황 수와 달라요.</p>
      {data.feedback.lastSavedAt && <p className="mt-2">최근 피드백 저장: {formatAnalysisTime(data.feedback.lastSavedAt)}</p>}
      <p className="mt-2">대기 작업 {data.jobs.queued}개 · 진행 중 {data.jobs.running}개</p>
      {data.latestJob?.completedAt && <p className="mt-2">최근 작업 종료: {formatAnalysisTime(data.latestJob.completedAt)}</p>}
      {data.activation.models.map(model => <p key={model.modality} className="mt-2">{model.modality === 'audio' ? '음성' : '영상'} 모델 적용 등록: {formatAnalysisTime(model.activatedAt)}</p>)}
      {data.activation.availability !== 'available' && <p className="mt-2 text-amber-200">모델 적용 정보를 확인할 수 없어요. 적용 여부는 관리자 확인이 필요해요.</p>}
      <p className="mt-2 text-xs text-slate-400">피드백 저장과 학습 완료, 모델 적용은 서로 다른 단계예요. 학습이 끝나도 자동으로 적용되지는 않아요.</p>
    </details>}
  </section>
}
