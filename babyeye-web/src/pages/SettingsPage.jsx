import { User, Camera, Bell, Shield, ChevronRight } from 'lucide-react'

import Card from '../components/common/Card'
import Header from '../components/common/Header'

const sections = [
  {
    title: '아이 정보',
    items: [
      { icon: User, label: '프로필 관리', description: '아이 이름, 생년월일, 보호자 정보' },
    ],
  },
  {
    title: '기기 설정',
    items: [
      { icon: Camera, label: '카메라 설정', description: '연결된 카메라 및 화질 설정' },
      { icon: Bell, label: '알림 설정', description: '울음, 보챔, 움직임 감지 알림' },
      { icon: Shield, label: '개인정보 보호', description: '영상 저장 및 데이터 보안 설정' },
    ],
  },
]

function SettingsPage() {
  return (
    <main className='px-5 py-6'>
      <Header title='설정' subtitle='서비스 및 기기 설정 관리' />

      <Card className='mb-5'>
        <div className='flex items-center gap-4'>
          <div className='flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-400/15 text-blue-200'>
            <User size={30} />
          </div>

          <div>
            <h2 className='text-xl font-bold'>아기</h2>
            <p className='mt-1 text-sm text-slate-400'>생후 8개월 · 보호자 계정</p>
          </div>
        </div>
      </Card>

      <div className='space-y-5'>
        {sections.map((section) => (
          <Card key={section.title}>
            <h2 className='mb-4 text-lg font-bold'>{section.title}</h2>

            <div className='space-y-3'>
              {section.items.map((item) => {
                const Icon = item.icon

                return (
                  <button
                    key={item.label}
                    type='button'
                    className='flex w-full items-center justify-between rounded-2xl bg-slate-800/70 p-4 text-left'
                  >
                    <div className='flex items-center gap-3'>
                      <div className='flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-700/80'>
                        <Icon size={21} className='text-slate-200' />
                      </div>

                      <div>
                        <p className='font-semibold'>{item.label}</p>
                        <p className='mt-1 text-sm text-slate-400'>{item.description}</p>
                      </div>
                    </div>

                    <ChevronRight size={20} className='text-slate-500' />
                  </button>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </main>
  )
}

export default SettingsPage
