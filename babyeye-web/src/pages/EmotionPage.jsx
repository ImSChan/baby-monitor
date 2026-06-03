import { Activity, Baby, Moon, Smile } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import { getCurrentEmotion, getEmotionHistory } from '../api/emotionApi'
import { useApi } from '../hooks/api/useApi'

function EmotionPage() {
  const current = useApi(getCurrentEmotion, [])
  const history = useApi(getEmotionHistory, [])

  const loading = current.loading || history.loading
  const error = current.error || history.error

  if (loading) {
    return (
      <main className='px-5 py-6'>
        <Header title='감정 분석' subtitle='AI 기반 영아 상태 분석' />
        <Card>
          <p className='text-sm text-slate-300'>감정 분석 데이터를 불러오는 중입니다...</p>
        </Card>
      </main>
    )
  }

  if (error) {
    return (
      <main className='px-5 py-6'>
        <Header title='감정 분석' subtitle='AI 기반 영아 상태 분석' />
        <Card>
          <p className='font-semibold text-rose-300'>감정 데이터를 불러오지 못했습니다.</p>
          <p className='mt-2 text-sm text-slate-400'>{error.message}</p>
        </Card>
      </main>
    )
  }

  const currentEmotion = current.data
  const emotionHistory = history.data || []
  const distribution = buildDistribution(emotionHistory)

  return (
    <main className='px-5 py-6'>
      <Header title='감정 분석' subtitle='AI 기반 영아 상태 분석' />

      <CurrentEmotionTopTwo currentEmotion={currentEmotion} />

      <Card className='mb-5 mt-5'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>최근 감정 분포</h2>
          <Activity size={20} className='text-slate-400' />
        </div>

        {distribution.length === 0 ? (
          <p className='text-sm text-slate-400'>분포를 계산할 감정 데이터가 없습니다.</p>
        ) : (
          <div className='space-y-4'>
            {distribution.map((item) => (
              <div key={item.label}>
                <div className='mb-2 flex justify-between text-sm'>
                  <span className='text-slate-300'>{item.label}</span>
                  <span className='text-slate-400'>{item.value}%</span>
                </div>
                <div className='h-3 rounded-full bg-slate-800'>
                  <div
                    className='h-3 rounded-full bg-gradient-to-r from-blue-400 to-indigo-400'
                    style={{ width: item.value + '%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>감정 히스토리</h2>
          <Smile size={20} className='text-slate-400' />
        </div>

        {emotionHistory.length === 0 ? (
          <p className='text-sm text-slate-400'>감정 히스토리가 없습니다.</p>
        ) : (
          <div className='space-y-3'>
            {emotionHistory.map((item) => (
              <div key={item.id} className='flex gap-3 rounded-2xl bg-slate-800/70 p-4'>
                <div className='min-w-12 text-sm font-semibold text-blue-300'>
                  {formatTime(item.created_at)}
                </div>
                <div className='flex-1'>
                  <p className='font-semibold'>{toUserFriendlyEmotion(item.emotion)}</p>
                  <p className='mt-1 text-sm text-slate-400'>
                    {item.message || item.need || '상태 메시지가 없습니다.'}
                  </p>

                  <div className='mt-3 flex gap-2'>
                    {getEmotionTopPredictions(item).map((prediction, index) => (
                      <span
                        key={prediction.emotion + index}
                        className='rounded-full bg-blue-400/10 px-3 py-1 text-xs font-semibold text-blue-200'
                      >
                        {toUserFriendlyEmotion(prediction.emotion)} {Math.round((prediction.confidence || 0) * 100)}%
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  )
}

function CurrentEmotionTopTwo({ currentEmotion }) {
  if (!currentEmotion) {
    return (
      <Card>
        <div className='flex items-center gap-4'>
          <div className='flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-400/15 text-indigo-200'>
            <Moon size={32} />
          </div>

          <div className='flex-1'>
            <p className='text-sm text-slate-400'>현재 감정</p>
            <h2 className='mt-1 text-2xl font-bold'>분석 대기</h2>
            <p className='mt-1 text-sm text-slate-400'>아직 분석된 감정 데이터가 없습니다.</p>
          </div>
        </div>
      </Card>
    )
  }

  const predictions = getEmotionTopPredictions(currentEmotion)

  return (
    <Card className='border-blue-400/30 bg-gradient-to-br from-slate-900 to-blue-950/60'>
      <div className='mb-4 flex items-center gap-4'>
        <div className='flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-400/15 text-blue-200'>
          <Baby size={32} />
        </div>

        <div className='flex-1'>
          <p className='text-sm text-blue-200'>현재 아기가 우는 이유</p>
          <h2 className='mt-1 text-2xl font-bold'>
            {toUserFriendlyEmotion(currentEmotion.emotion)}
          </h2>
          <p className='mt-1 text-sm text-slate-400'>
            가능성이 높은 상태 2가지를 함께 제공합니다.
          </p>
        </div>
      </div>

      <div className='grid grid-cols-2 gap-3'>
        {predictions.map((item, index) => (
          <div
            key={item.emotion + index}
            className='rounded-3xl border border-slate-700/70 bg-slate-950/70 p-4'
          >
            <div className='mb-3 flex items-center justify-between'>
              <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-2xl'>
                {getEmotionIcon(item.need || item.emotion)}
              </div>

              <span className='rounded-full bg-blue-400/10 px-2 py-1 text-[11px] font-semibold text-blue-200'>
                TOP {index + 1}
              </span>
            </div>

            <p className='text-sm font-bold text-blue-200'>
              {toUserFriendlyEmotion(item.emotion)}
            </p>

            <p className='mt-1 text-3xl font-light text-white'>
              {Math.round((item.confidence || 0) * 100)}
              <span className='ml-1 text-base text-slate-400'>%</span>
            </p>
          </div>
        ))}
      </div>

      <p className='mt-4 rounded-2xl bg-slate-950/40 p-4 text-sm leading-6 text-slate-300'>
        {currentEmotion.message || 'AI가 가능성이 높은 상태 후보를 분석했습니다.'}
      </p>
    </Card>
  )
}

function getEmotionTopPredictions(emotion) {
  const predictions =
    emotion?.topPredictions ||
    emotion?.top_predictions ||
    []

  if (predictions.length > 0) {
    return predictions.slice(0, 2)
  }

  if (!emotion) {
    return []
  }

  return [
    {
      emotion: emotion.emotion,
      confidence: emotion.confidence,
      need: emotion.need,
      message: emotion.message,
    },
  ]
}

function buildDistribution(items) {
  if (!items || items.length === 0) {
    return []
  }

  const counts = items.reduce((acc, item) => {
    acc[item.emotion] = (acc[item.emotion] || 0) + 1
    return acc
  }, {})

  return Object.entries(counts).map(([label, count]) => ({
    label,
    value: Math.round((count / items.length) * 100),
  }))
}

function toUserFriendlyEmotion(value) {
  if (!value) return '분석 중'

  const mapping = {
    배고픔: '배고파요',
    잠와요: '잠와요',
    피곤함: '잠와요',
    불편함: '불편해요',
    '안정 상태': '괜찮아요',
    안정상태: '괜찮아요',
  }

  return mapping[value] || value
}

function getEmotionIcon(value) {
  const key = String(value || '')

  if (key.includes('feeding') || key.includes('배고')) {
    return '🍼'
  }

  if (key.includes('sleep') || key.includes('잠') || key.includes('피곤')) {
    return '🌙'
  }

  if (key.includes('care') || key.includes('불편')) {
    return '🌡️'
  }

  if (key.includes('stable') || key.includes('안정')) {
    return '😊'
  }

  return '👶'
}

function formatTime(value) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default EmotionPage
