# 3회 연속 감지 대표 상태 및 간결한 홈 결과

최신 변경: 홈은 기존 알림 목록의 가장 최근 상태 알림을 사용한다. LATEST_ALERT_REPRESENTATIVE.md 참고. 이 문서의 별도 confirmedEmotion API 요건은 최신 홈 화면에 필요하지 않다.

홈 상단 아이에게 필요한 것을 한눈에/아기 상태 제목을 제거했다. 알림과 설정 버튼은 유지한다. 대표 상태 카드의 안내 문장과 큰 돌봄 필요 제목을 제거하고 분류명 불편함/배고픔/졸림/안정을 표시한다. 위에는 분석 완료 시각, 분류명 옆에는 작은 예측 점수, 아래에는 2·3순위와 점수를 작게 표시한다.

## 대표 상태 선택

GET /api/dashboard에 confirmedEmotion을 추가했다. 기존 currentEmotion 필드는 보존한다. 서버에서 인증된 계정의 EmotionEvent 전체 기록을 카메라별로 나누고 분석 완료/저장 순서(id)에서 동일 상태가 3회 연속인 가장 최근 결과를 찾는다. 알림 활성화/FCM 발송 여부와 무관하다. 서로 다른 카메라의 관측으로 3회를 채우지 않는다. unknown/다른 상태는 연속성을 끊는다. NULL 카메라의 업로드 분석은 기존 동일 소스 그룹으로 취급한다.

1~2회 새 상태가 나와도 이전 대표 상태를 유지하고, 세 번째에 바꾼다. 같은 상태가 4회 이상 이어지면 최신 3개 창의 마지막 결과/시각/점수를 사용한다. 안정 상태도 3회 연속이면 대표 상태가 되지만 기존 stable 알림 제외 정책은 바꾸지 않는다. 아직 연속 3회 기록이 없으면 감지 대기를 표시한다. 최신 단일 업로드나 최근 20개 이력으로 대표 상태를 대체하지 않는다. 과거 촬영 영상을 늦게 올린 경우 판정 순서는 완료 순서이고 표시 시각도 분석 완료 시각이다. 평균/재계산한 확률이 아니라 선택된 마지막 분석의 원래 점수다.

## 후보 순위

model_runtime의 실제 최종 후보를 최대 3개 보존한다. 낮은 점수 안정 override에는 안정+최대 2개의 원래 후보를 담고, 조용함/자료 없음 override에서 후보가 없으면 임의 생성하지 않는다. 기존 Worker 저장/알림/육아 기록 보정 경로를 그대로 사용한다. 점수를 합계 100으로 강제 정규화하지 않는다. 기존 행에 없는 3순위는 기록 없음으로 표시하며 과거 행을 추정·덮어쓰지 않는다. 점수는 모델의 예측 점수다.

## 변경 파일

- backend/app/services/confirmed_state_service.py: 계정·카메라별 SQL window 연속 감지 조회.
- backend/app/routers/dashboard.py: confirmedEmotion 응답 추가.
- backend/app/services/model_runtime.py: top3 후보 보존 및 fusion 식별자.
- BabyStatusOverview.jsx, HomePage.jsx, Header.jsx, babyStatus.js: 간결한 화면, 분류명, 대표 상태 전용 데이터 사용, 상단 제목 제거.
- backend/tests/test_confirmed_state.py, test_prediction_ranking.py, test_care.py, test_smart_home_retirement.py 및 프런트엔드 테스트: 연속성/소유권/후보 순위/기존 API 호환/화면 검증.
- backend/tools/review_demo.py: loopback 임시 SQLite 전용 mock/observe 테스트 입력. 운영 main 앱에는 mock 경로가 없다.
- Android v1.16/versionCode17.

## 검증과 한계

- 백엔드 전체 171개 통과/12개 PostgreSQL 전용 skip, 이후 추가한 순수 융합 함수 테스트 3개 통과(합계 174개). 융합 테스트는 실제 source의 순수 함수·상수를 AST로 컴파일해 GPU/다운로드 라이브러리 없이 실행한다. 실제 모델 가중치 추론 정확도/GPU 성능을 검증한 것은 아니다.
- 프런트엔드 28개 파일/126개 테스트 통과.
- 실제 Edge 390×844 + 임시 SQLite: 불편함 2회까지 대기, 3회째 불편함 87% 및 2순위 배고픔20%/3순위 졸림12% 표시, 배고픔 2회까지 이전 대표 유지, 세 번째에 배고픔 갱신, 안정 3회에 안정 갱신. 상단 제목 없음/가로 넘침 없음 확인.
- 합성 care3/feeding3/stable3에서 알림 이벤트 경로와 완료 메타데이터를 사용해 FCM 전송 2건을 mock transport로 캡처했다. 실제 FCM은 발송하지 않았고 안정 알림은 생성하지 않았다. pytest Worker 통합 시험에서도 3후보 저장과 알림 1회/중복 방지를 검증했다.
- Vite android build, cap sync, Gradle assembleDebug 성공. 실제 Android 기기 설치는 미실행.
- DB 컬럼/테이블/가중치 변경 없음. PostgreSQL 실제 실행과 대용량 기록의 쿼리 성능은 이 PC에서 미검증이며 운영 전 전용 시험 DB에서 확인한다.

## 적용

이번에는 API와 분석 Worker 업데이트가 필요하다. 새 API가 적용돼야 대표 상태를 받고, 새 Worker 적용 이후 분석부터 3순위 후보가 쌓인다. 기존 2후보 행에 3순위를 소급 생성하지 않는다. DB 마이그레이션은 없다. 운영 자동 재배포는 수행하지 않았다. 배포 PC용 DEPLOY_PC_CONFIRMED_STATE_PROMPT.md를 전달하고 Android 새 APK/Vercel 배포도 확인한다.
