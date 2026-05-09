import { Moon, Smile, Activity } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'
import { currentEmotion, emotionDistribution, emotionHistory } from '../data/emotionData'

function EmotionPage() {
  return (
    <main className='px-5 py-6'>
      <Header title='감정 분석' subtitle='AI 기반 영아 상태 분석' />

      <Card className='mb-5'>
        <div className='flex items-center gap-4'>
          <div className='flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-400/15 text-indigo-200'>
            <Moon size={32} />
          </div>

          <div className='flex-1'>
            <p className='text-sm text-slate-400'>현재 감정</p>
            <h2 className='mt-1 text-2xl font-bold'>{currentEmotion.label}</h2>
            <p className='mt-1 text-sm text-slate-400'>
              신뢰도 {currentEmotion.confidence}% · {currentEmotion.lastUpdated}
            </p>
          </div>
        </div>

        <p className='mt-4 rounded-2xl bg-slate-800/70 p-4 text-sm leading-6 text-slate-300'>
          {currentEmotion.description}
        </p>
      </Card>

      <Card className='mb-5'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>오늘의 감정 분포</h2>
          <Activity size={20} className='text-slate-400' />
        </div>

        <div className='space-y-4'>
          {emotionDistribution.map((item) => (
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
      </Card>

      <Card>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-lg font-bold'>감정 히스토리</h2>
          <Smile size={20} className='text-slate-400' />
        </div>

        <div className='space-y-3'>
          {emotionHistory.map((history) => (
            <div key={history.id} className='flex gap-3 rounded-2xl bg-slate-800/70 p-4'>
              <div className='text-sm font-semibold text-blue-300'>
                {history.time}
              </div>
              <div>
                <p className='font-semibold'>{history.label}</p>
                <p className='mt-1 text-sm text-slate-400'>{history.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </main>
  )
}

export default EmotionPage
