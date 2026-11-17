# 알림에서 한 번 선택하는 피드백 (Android 1.7 / versionCode 8)

## 바뀐 동작
- 알림 상세 또는 지난 12시간 돌아보기에서 당시 실제 상태 버튼을 한 번 누르면 일괄 저장합니다.
- 서버가 알림 분석 시점까지 같은 계정·camera_key의 최근 20개 분석(최대 12시간)을 먼저 고른 뒤 알림 분석과 같은 정규화 상태만 선택합니다. 안정·다른 상태, 알림 이후 분석은 포함하지 않습니다. camera_key=0인 미등록 기기는 기존 계정 기본 그룹을 따릅니다.
- 배고픔→안정→배고픔→배고픔→졸림→배고픔→배고픔→배고픔 예시에서 졸림을 누르면 배고픔 6개만 졸림으로 저장합니다.
- 구간·프레임·소리·개별 분석 피드백 화면과 API 클라이언트를 제거했습니다. 예전 /feedback 링크는 /notifications로 이동합니다.
- 알림 열기·확인하기는 정답으로 취급하지 않습니다. 잘 모르겠어요는 학습 제외입니다.

## 데이터 보호 및 호환성
서버가 전적으로 대상을 결정하며 클라이언트 request_ids/expected_versions는 422로 거절합니다. 이전 context API는 소유권 확인 후 410을 반환합니다. 새 GET /api/reviews/events/{id}/feedback에서 개수와 동시 수정 검사용 scopeSignature만 받습니다. POST /api/reviews/feedback은 event_id, action_id, label, scope_signature를 받습니다.
JWT 사용자·원본 완료 메타데이터 소유권을 다시 확인합니다. 다른 알림/기존 개별 피드백, 다른 사람이 수정한 버전, 예약·학습 완료 및 학습에 연결된 전체 cohort는 보호하고 건너뜁니다. 자료가 없는 기록도 건너뛰며 실제 저장 개수와 제외 개수를 반환합니다. 동일 action_id 재전송은 중복 저장하지 않습니다. 실행 취소는 전부 복구 가능할 때만 처리합니다.
동일 응답에 속한 여러 샘플은 기존 learning_cohorts 로직에서 한 관측으로 계산합니다. 개인화 학습 임계치·미디어 검증·mock 데이터 학습 제외 정책은 유지됩니다. 저장 즉시 학습/가중치 반영을 보장하지 않습니다.
기존 ReviewAction.changes JSON 각 항목에 event_id/label, 첫 항목에 skipped_count를 추가합니다. 기존 id/before/version은 유지해 이전 데이터와 학습 로직이 호환됩니다. 스키마·데이터 삭제나 신규 마이그레이션은 없습니다. 기존 004_feedback_review.sql까지 적용되어 있어야 하며, 최신 앱의 육아 기록은 기존 006까지 필요합니다. 이미 적용된 DB에 SQL을 재실행할 필요가 없습니다. 구버전 앱의 구간 저장 요청은 실패하므로 웹/앱을 함께 갱신하세요.

## 변경 파일
- backend/app/routers/reviews.py: 자동 대상 선정, 버전 검사, 보호된 데이터 제외, idempotency, cohort 단위 실행 취소 보호.
- backend/app/services/review_service.py 및 routers/push.py: 알림 단위 응답 완료 표시 및 정기 알림 미응답 계산.
- babyeye-web/src/components/review/ReviewEditor.jsx: 상태 버튼만 제공하는 일괄 피드백.
- pages/ReviewPage.jsx: 알림 응답 상태 표시.
- components/home/BabyStatusOverview.jsx 및 routes/AppRouter.jsx: 알림으로 진입 통일.
- pages/FeedbackPage.jsx 및 api/feedbackApi.js 삭제: 개별 피드백 화면 제거. 기존 백엔드 /api/feedback은 인증·중복 보호를 유지한 호환 API로 남깁니다.
- Android app/build.gradle: 1.7 (8).
- backend/tests/test_reviews.py, ReviewEditor.test.jsx, tests/review-browser.mjs: 새 UX, 혼합 상태, 범위·인증·중복·학습 보호 및 mock 알림 통합 검증.
- .gitignore: 로컬 브라우저 테스트 결과 제외.

## 검증
- 백엔드 전체: 136 passed / 11 skipped (PostgreSQL 전용 테스트; 로컬 PostgreSQL 없음).
- 프런트엔드: 67 passed / 18 files.
- Vite Android 빌드 및 Capacitor sync 성공. Android Gradle APK 빌드 성공.
- 실제 Edge 브라우저 + 임시 SQLite + 실제 라우터·알림 워커·FCM 메시지 구성: mock 분석 21개 → 상태 알림 2개 → 알림 열기 → 상태 한 번 선택으로 3개 자동 저장 → 실행 취소 → 재저장 → 정기 알림 1개 → 돌아보기·설정 변경 통과. pageErrors 없음.
- 사용자가 제시한 8개 혼합 예시는 서버 테스트에서 배고픔 6개만 졸림 저장 확인.
- Firebase 외부 네트워크와 Android 네이티브 브리지만 mock입니다. 실제 휴대폰 FCM 수신·클릭은 별도 실기기 확인이 필요합니다.

## 개발 PC에서 재빌드
PowerShell에서 저장소 babyeye-web로 이동 후 npm ci, npm run build -- --mode android, npx cap sync android를 실행합니다. .env.android의 API 주소와 로컬 google-services.json을 유지하고 Android Studio에서 android 폴더를 열어 Build APK(s)를 실행합니다. 기존 설치와 같은 서명을 사용하면 앱 데이터 보존 업데이트가 가능합니다.

## 배포 PC
DEPLOY_CODEX_PROMPT.md를 배포 PC Codex에 전달하세요. 이 개발 PC에서 운영 재배포나 DB 작업은 실행하지 않았습니다.
