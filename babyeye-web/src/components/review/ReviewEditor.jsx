import { useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'

export const STATES = [['feeding', '배고팠어요'], ['sleep', '졸렸어요'], ['care', '돌봄이 필요했어요'], ['stable', '편안했어요'], ['uncertain', '잘 모르겠어요']]
export const timeText = value => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ReviewEditor({ eventId, onSaved }) {
  const { user } = useAuth()
  const [summary, setSummary] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [undo, setUndo] = useState(null)
  const [reload, setReload] = useState(0)
  const epoch = useRef(0)
  const pending = useRef(null)
  useEffect(() => {
    const generation = ++epoch.current
    const controller = new AbortController()
    setSummary(null); setError(''); setSuccess(''); setUndo(null); setBusy(false); pending.current = null
    apiGet('/api/reviews/events/' + eventId + '/feedback', { signal: controller.signal }).then(data => {
      if (generation === epoch.current) setSummary(data)
    }).catch(err => { if (generation === epoch.current) setError(err.message) })
    return () => { epoch.current++; controller.abort() }
  }, [eventId, user?.id, reload])
  async function save(label) {
    if (busy || !summary) return
    const generation = epoch.current
    setBusy(true); setError(''); setSuccess('')
    if (!pending.current || pending.current.label !== label) pending.current = {
      action_id: crypto.randomUUID(), event_id: Number(eventId), label, scope_signature: summary.scopeSignature,
    }
    try {
      const result = await apiPost('/api/reviews/feedback', pending.current)
      if (generation !== epoch.current) return
      pending.current = null; setUndo(result.actionId); setSuccess(result.count + '개 분석에 일괄 반영했어요.' + (result.skippedCount ? ' 보호되거나 자료가 없는 ' + result.skippedCount + '개는 제외했어요.' : ''))
      onSaved?.(); window.dispatchEvent(new Event('babyeye:notifications'))
      const data = await apiGet('/api/reviews/events/' + eventId + '/feedback')
      if (generation === epoch.current) setSummary(data)
    } catch (err) { if (generation === epoch.current) setError(err.message || '저장하지 못했어요. 다시 시도해주세요.') }
    finally { if (generation === epoch.current) setBusy(false) }
  }
  async function undoLast() {
    const generation = epoch.current
    setBusy(true); setError('')
    try {
      await apiPost('/api/reviews/feedback/' + undo + '/undo', {})
      if (generation !== epoch.current) return
      setUndo(null); setSuccess('이전 응답으로 되돌렸어요.'); onSaved?.()
      const data = await apiGet('/api/reviews/events/' + eventId + '/feedback')
      if (generation === epoch.current) setSummary(data)
    } catch (err) { if (generation === epoch.current) setError(err.message) }
    finally { if (generation === epoch.current) setBusy(false) }
  }
  return <section aria-label="당시 상태 피드백" className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-4">
    <h2 className="font-bold">당시 아기는 어떤 상태였나요?</h2>
    <p className="text-sm text-slate-400">실제 상태를 선택하면 관련 분석에 한 번에 반영해요.</p>
    <details className="text-xs text-slate-400"><summary className="cursor-pointer">자동 적용 대상 안내</summary><p className="mt-2">알림 시점까지 같은 카메라의 최근 20개·최대 12시간 기록 중 알림과 같은 판단만 반영해요. 다른 상태와 기존 다른 응답, 학습에 사용 중인 기록은 제외해요. 알림 확인만으로는 학습되지 않아요.</p></details>
    {error && <div role="alert" className="text-sm text-red-300">{error}<button className="ml-3 underline" onClick={() => setReload(v => v + 1)}>새로고침</button></div>}
    {!summary && !error && <p role="status">피드백 대상을 확인하는 중…</p>}
    {summary?.response && <p className="text-sm text-emerald-300">저장한 응답: {STATES.find(([key]) => key === summary.response.label)?.[1] || '응답 완료'}</p>}
    {summary && <>
      <p className="text-sm text-slate-300">같은 판단의 분석 최대 {summary.matchedCount}개에 적용해요.</p>
      <div className="grid grid-cols-2 gap-2">{STATES.map(([value, text]) => <button key={value} disabled={busy || !summary.matchedCount} onClick={() => save(value)} className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-3 text-sm disabled:opacity-40">{text}</button>)}</div>
    </>}
    {busy && <p role="status">저장 중…</p>}
    {success && <div role="status" className="text-sm text-emerald-300">{success} {undo && <button disabled={busy} onClick={undoLast} className="ml-2 underline">실행 취소</button>}</div>}
  </section>
}
