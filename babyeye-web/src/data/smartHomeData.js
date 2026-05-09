export const smartHomeDevices = [
  {
    id: 1,
    name: '수면 조명',
    type: 'light',
    status: 'on',
    description: '은은한 밝기로 켜짐',
  },
  {
    id: 2,
    name: '가습기',
    type: 'humidifier',
    status: 'on',
    description: '습도 45% 유지 중',
  },
  {
    id: 3,
    name: '에어컨',
    type: 'air',
    status: 'off',
    description: '현재 꺼짐',
  },
]

export const sceneModes = [
  {
    id: 1,
    name: '수면 모드',
    active: true,
    description: '조명 낮춤 · 소음 최소화',
  },
  {
    id: 2,
    name: '수유 모드',
    active: false,
    description: '조명 밝기 증가',
  },
  {
    id: 3,
    name: '놀이 모드',
    active: false,
    description: '밝은 조명과 쾌적한 온도',
  },
]
