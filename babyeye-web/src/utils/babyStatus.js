const STATES = {
  feeding: { key: 'feeding', label: '배고픔', icon: '🍼', title: '배가 고픈 것 같아요', hint: '수유가 필요한지 살펴봐 주세요.', color: 'bg-amber-300' },
  sleep: { key: 'sleep', label: '졸림', icon: '🌙', title: '잠이 오는 것 같아요', hint: '편안하게 쉴 수 있는지 살펴봐 주세요.', color: 'bg-indigo-300' },
  care: { key: 'care', label: '돌봄 필요', icon: '🤲', title: '돌봄이 필요한 것 같아요', hint: '기저귀나 자세 등 불편한 곳이 있는지 살펴봐 주세요.', color: 'bg-rose-300' },
  stable: { key: 'stable', label: '편안함', icon: '🍃', title: '편안한 상태로 보여요', hint: '최근 분석에서 특별한 요구가 감지되지 않았어요.', color: 'bg-emerald-300' },
}
const aliases = {
  feeding: 'feeding', hungry: 'feeding', 배고픔: 'feeding', 배고파요: 'feeding',
  sleep: 'sleep', tired: 'sleep', 졸림: 'sleep', 졸려요: 'sleep', 잠와요: 'sleep', 피곤함: 'sleep', '수면 중': 'sleep',
  care: 'care', discomfort: 'care', 불편함: 'care', 불편해요: 'care',
  stable: 'stable', normal: 'stable', 안정: 'stable', '안정 상태': 'stable', 안정상태: 'stable',
}
export function babyStatus(result) {
  const need = String(result?.need || '').trim().toLowerCase()
  const emotion = String(result?.emotion || '').trim().toLowerCase()
  const key = aliases[need] || aliases[emotion]
  return STATES[key] || { key: emotion || 'unknown', label: result?.emotion || '상태 확인 중', icon: '👶', title: '아이의 상태를 살펴봐 주세요', hint: '당시 모습을 함께 확인해 주세요.', color: 'bg-slate-400' }
}
export function predictions(result) {
  const top = result?.topPredictions?.length ? result.topPredictions : result?.top_predictions
  return (top?.length ? top : result ? [result] : []).slice(0, 2)
}
export function score(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(Math.min(1, Math.max(0, number)) * 100) : null
}
export function analysisDate(value) {
  if (!value) return null
  // Legacy API timestamps are naive KST. Do not interpret them as device time.
  const text = String(value)
  const date = new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(text) && !/(Z|[+-]\d\d:\d\d)$/.test(text) ? `${text}+09:00` : text)
  return Number.isNaN(date.getTime()) ? null : date
}
export function analysisTime(result) {
  return result?.createdAt || result?.created_at || result?.analyzedAt || result?.capturedAt || result?.captured_at
}
export function formatAnalysisTime(value) {
  return analysisDate(value)?.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) || '분석 시각 없음'
}
export function distribution(history) {
  const counts = new Map()
  history.forEach(row => {
    const status = babyStatus(row)
    counts.set(status.key, { ...status, count: (counts.get(status.key)?.count || 0) + 1 })
  })
  return [...counts.values()].sort((a, b) => b.count - a.count)
}
