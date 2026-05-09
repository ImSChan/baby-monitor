export const currentEmotion = {
  label: '수면 중',
  description: '아이가 편안하게 잠을 자고 있습니다',
  confidence: 97,
  lastUpdated: '방금 전',
}

export const emotionDistribution = [
  { label: '수면 중', value: 40 },
  { label: '평온', value: 25 },
  { label: '행복', value: 20 },
  { label: '보챔', value: 8 },
  { label: '흥분', value: 5 },
  { label: '울음', value: 2 },
]

export const emotionHistory = [
  {
    id: 1,
    time: '14:30',
    label: '수면 중',
    description: '편안한 수면 상태',
  },
  {
    id: 2,
    time: '13:45',
    label: '평온',
    description: '안정적인 상태 유지',
  },
  {
    id: 3,
    time: '12:20',
    label: '보챔',
    description: '일시적인 불편함 감지',
  },
]
