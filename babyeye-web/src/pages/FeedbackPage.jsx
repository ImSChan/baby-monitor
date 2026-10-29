
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  getInferenceHistory,
  getFeedbackList,
  createFeedback,
  updateFeedback,
} from '../api/feedbackApi'

const FEEDBACK_OPTIONS = [
  {
    value: 'correct',
    label: 'AI 예측이 맞았어요',
  },
  {
    value: 'incorrect',
    label: '실제로는 다른 상태였어요',
  },
  {
    value: 'uncertain',
    label: '정확한 상태를 모르겠어요',
  },
]

function formatDate(value) {
  if (!value) return '분석 시각 없음'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatConfidence(value) {
  if (value === null || value === undefined) return '-'

  const number = Number(value)
  if (!Number.isFinite(number)) return '-'

  const percentage = number <= 1 ? number * 100 : number
  return `${percentage.toFixed(1)}%`
}

function FeedbackCard({ item, feedback, onSaved }) {
  const [expanded, setExpanded] = useState(false)
  const [type, setType] = useState('correct')
  const [label, setLabel] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const locked = feedback && ![
    'pending',
    'excluded',
  ].includes(feedback.training_status)

  function openEditor() {
    setType(feedback?.feedback_type || 'correct')
    setLabel(feedback?.corrected_label || '')
    setComment(feedback?.comment || '')
    setError('')
    setSuccess('')
    setExpanded(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const correctedLabel = label.trim()

    if (type === 'incorrect' && !correctedLabel) {
      setError('실제 상태를 입력해주세요.')
      return
    }

    if (
      type === 'incorrect' &&
      correctedLabel === item.emotion
    ) {
      setError('예측과 동일한 상태라면 "맞았어요"를 선택해주세요.')
      return
    }

    const payload = {
      feedback_type: type,
      corrected_label:
        type === 'incorrect' ? correctedLabel : null,
      comment: comment.trim() || null,
    }

    setSaving(true)

    try {
      if (feedback) {
        await updateFeedback(feedback.id, payload)
      } else {
        await createFeedback({
          request_id: item.requestId,
          ...payload,
        })
      }

      setSuccess('피드백이 저장되었습니다.')
      await onSaved()
      setExpanded(false)
    } catch (err) {
      if (err.status === 409) {
        setError(
          '이미 등록되었거나 학습 처리 중인 피드백입니다. 목록을 새로고침해주세요.'
        )
      } else {
        setError(err.message || '피드백 저장에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">
            {formatDate(
              item.completedAt ||
              item.createdAt ||
              item.capturedAt
            )}
          </p>

          <h3 className="mt-2 text-lg font-bold text-white">
            {item.emotion}
          </h3>

          <p className="mt-1 text-sm text-slate-400">
            AI 신뢰도 {formatConfidence(item.confidence)}
          </p>

          {item.message && (
            <p className="mt-2 text-sm text-slate-300">
              {item.message}
            </p>
          )}
        </div>

        {feedback ? (
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
            피드백 완료
          </span>
        ) : (
          <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs text-blue-300">
            피드백 대기
          </span>
        )}
      </div>

      {feedback && (
        <div className="mt-4 rounded-xl bg-slate-800 p-3 text-sm">
          <p className="font-medium text-slate-200">
            {feedback.feedback_type === 'correct'
              ? 'AI 예측이 맞았어요'
              : feedback.feedback_type === 'uncertain'
                ? '정확한 상태를 모르겠어요'
                : `실제 상태: ${feedback.corrected_label}`}
          </p>

          {feedback.comment && (
            <p className="mt-2 text-slate-400">
              {feedback.comment}
            </p>
          )}

          <p className="mt-2 text-xs text-slate-500">
            학습 상태: {feedback.training_status}
          </p>
        </div>
      )}

      {!expanded && !locked && (
        <button
          type="button"
          onClick={openEditor}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white"
        >
          <MessageSquare size={16} />
          {feedback ? '피드백 수정' : '피드백 제출'}
        </button>
      )}

      {locked && (
        <p className="mt-3 text-xs text-amber-300">
          학습에 사용 중이거나 반영된 피드백은 수정할 수 없습니다.
        </p>
      )}

      {expanded && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-4 border-t border-slate-700 pt-4"
        >
          <p className="text-sm font-semibold text-white">
            실제 아기의 상태가 어땠나요?
          </p>

          <div className="space-y-2">
            {FEEDBACK_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-200"
              >
                <input
                  type="radio"
                  name={`feedback-${item.requestId}`}
                  value={option.value}
                  checked={type === option.value}
                  onChange={() => setType(option.value)}
                  className="accent-blue-500"
                />
                {option.label}
              </label>
            ))}
          </div>

          {type === 'incorrect' && (
            <div>
              <label
                htmlFor={`label-${item.requestId}`}
                className="mb-2 block text-sm text-slate-300"
              >
                실제 상태
              </label>

              <input
                id={`label-${item.requestId}`}
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={100}
                placeholder="예: 배고픔, 졸림, 불편함"
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none focus:border-blue-400"
              />

              <p className="mt-2 text-xs text-slate-400">
                추후 모델 학습용 라벨 체계에 맞춰 선택식으로 변경할 예정입니다.
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor={`comment-${item.requestId}`}
              className="mb-2 block text-sm text-slate-300"
            >
              추가 설명 (선택)
            </label>

            <textarea
              id={`comment-${item.requestId}`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="당시 아기의 상태를 설명해주세요."
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none focus:border-blue-400"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              disabled={saving}
              className="flex-1 rounded-xl bg-slate-700 py-3 text-sm font-medium text-white"
            >
              취소
            </button>

            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? '저장 중...' : '피드백 저장'}
            </button>
          </div>
        </form>
      )}

      {!expanded && success && (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 size={16} />
          {success}
        </p>
      )}
    </article>
  )
}

export default function FeedbackPage() {
  const [history, setHistory] = useState([])
  const [feedbacks, setFeedbacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    const [historyResponse, feedbackResponse] =
      await Promise.all([
        getInferenceHistory(100, 0),
        getFeedbackList(100, 0),
      ])

    setHistory(historyResponse.items || [])
    setFeedbacks(feedbackResponse.items || [])
  }, [])

  useEffect(() => {
    let active = true

    async function initialLoad() {
      try {
        const [historyResponse, feedbackResponse] =
          await Promise.all([
            getInferenceHistory(100, 0),
            getFeedbackList(100, 0),
          ])

        if (!active) return

        setHistory(historyResponse.items || [])
        setFeedbacks(feedbackResponse.items || [])
      } catch (err) {
        if (active) {
          setError(err.message || '데이터 조회에 실패했습니다.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    initialLoad()

    return () => {
      active = false
    }
  }, [])

  async function refresh() {
    try {
      setError('')
      await loadData()
    } catch (err) {
      setError(err.message || '목록 새로고침에 실패했습니다.')
      throw err
    }
  }

  const feedbackMap = new Map(
    feedbacks.map((item) => [
      item.request_id,
      item,
    ])
  )

  const submittedCount = history.filter(
    (item) => feedbackMap.has(item.requestId)
  ).length

  return (
    <main className="px-5 py-6 pb-28 text-white">
      <div className="mb-6 flex items-center gap-3">
        <Link
          to="/emotion"
          aria-label="감정 분석 화면으로 돌아가기"
          className="rounded-xl bg-slate-800 p-2"
        >
          <ArrowLeft size={20} />
        </Link>

        <div className="flex-1">
          <h1 className="text-xl font-bold">
            AI 분석 피드백
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            실제 상태를 알려주면 AI 개선에 활용할 수 있어요.
          </p>
        </div>

        <button
          type="button"
          onClick={() => refresh().catch(() => {})}
          aria-label="새로고침"
          className="rounded-xl bg-slate-800 p-2"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {!loading && !error && (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-900 p-4">
            <p className="text-xs text-slate-400">
              최근 분석
            </p>
            <p className="mt-2 text-2xl font-bold">
              {history.length}
            </p>
          </div>

          <div className="rounded-2xl bg-slate-900 p-4">
            <p className="text-xs text-slate-400">
              피드백 완료
            </p>
            <p className="mt-2 text-2xl font-bold text-emerald-300">
              {submittedCount}
            </p>
          </div>
        </div>
      )}

      {loading && (
        <p className="text-sm text-slate-400">
          분석 이력을 불러오는 중입니다...
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </p>
      )}

      {!loading && !error && history.length === 0 && (
        <div className="rounded-2xl bg-slate-900 p-6 text-center">
          <p className="text-slate-300">
            아직 완료된 AI 분석이 없습니다.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-blue-300"
          >
            분석하러 가기
          </Link>
        </div>
      )}

      {!loading && history.length > 0 && (
        <div className="space-y-4">
          {history.map((item) => (
            <FeedbackCard
              key={item.requestId}
              item={item}
              feedback={feedbackMap.get(item.requestId)}
              onSaved={refresh}
            />
          ))}
        </div>
      )}
    </main>
  )
}
