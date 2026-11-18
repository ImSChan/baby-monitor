# 홈캠 연결 및 개인화 학습 상태 표시

## 사용자 화면
- 라이브 영상 아래에 홈캠 연결 상태 카드: 마지막으로 실제 화면 프레임을 확인한 시각/경과 시간, 10초 초과 미갱신 경고, 영상 재생/다시 연결 버튼.
- 실제 프레임이 들어온 경우만 LIVE를 표시합니다. WebSocket 인증이나 WebRTC 트랙 연결만으로 LIVE라고 하지 않습니다. 화면을 숨기면 확인 대기, 해당 기능을 지원하지 않는 브라우저는 확인 불가로 표시합니다. 재연결/종료 시 이전 프레임 시각을 초기화합니다.
- 카메라 송출 화면은 마지막 카메라 미리보기 확인 시각과 이 홈캠에서 완료를 확인한 AI 분석 시각, AI 켜짐/꺼짐/처리 중을 표시합니다.
- 시청 화면의 마지막 AI 분석 완료는 계정 전체의 서버 완료 시각입니다. 업로드 영상과 다른 홈캠 분석이 포함될 수 있으므로 해당 세션의 분석으로 표시하지 않습니다. 최근 1분 갱신이 없을 때 확인 안내를 표시합니다.
- 홈의 최신 아기 상태 아래와 설정에 개인화 학습 상태 카드를 추가했습니다. 피드백 대기 / 자료 수집 / 학습 대기 / 학습 중 / 학습 완료·검토 대기 / 모델 적용 등록 / 실패 / 적용 확인 필요를 구분합니다.
- 저장 및 적용 내역에서 피드백을 적용한 분석 수, 학습 제외 수, 최근 저장 시각, 대기·진행 작업 수, 최근 작업 종료와 음성/영상별 모델 등록 시각을 확인합니다. 분석 개수는 독립 학습 상황 수와 다름을 명시합니다.
- 최근 작업과 이미 등록된 기존 모델을 따로 보여줍니다. API 실패 때 마지막 확인 정보임을 알리며 재시도를 제공합니다. 계정 변경 때 이전 계정의 응답을 표시하지 않습니다.

## API와 데이터
GET /api/training/status, GET /api/training/analysis-status 모두 JWT의 현재 계정만 조회합니다. 사용자 ID를 클라이언트에서 지정하지 않습니다. 응답은 private, no-store입니다. 분석 완료는 EmotionEvent.created_at이며 촬영 시각과 구분합니다.
InferenceFeedback와 TrainingJob을 읽기 전용으로 집계합니다. 학습 데이터 적격성 계산이나 작업 생성/예약/모델 승격은 하지 않습니다. 원본 미디어, 오류 내부 메시지나 서버 파일 경로를 반환하지 않습니다.
모델 적용 등록은 기존 current.json의 사용자·모달리티·작업 소유권·완료 상태·시각을 확인하고, 활성 파일과 해당 불변 버전 파일의 해시가 같은지 확인합니다. 체크포인트를 역직렬화하거나 API에 torch를 추가하지 않습니다. 적용 등록은 개별 추론에서 모델이 성공적으로 실행됐다는 증명이 아니며, 기존 추론 런타임의 검증/오류 처리는 그대로 유지합니다.
가중치 경로가 보이지 않거나 메타데이터가 손상되면 적용 확인 필요로 표시합니다. 과거 활성 파일만 있고 등록 정보가 없는 경우에도 미적용이라고 단정하지 않습니다. API는 모델 파일을 수정하거나 자동 승격하지 않습니다.

## DB와 배포 변경
새 테이블/컬럼, SQL 마이그레이션은 없습니다. PostgreSQL 데이터, 미디어, 학습 자료와 가중치는 보존합니다.
docker-compose.yml의 backend-api에 기존 backend/weights/users 폴더를 /app/weights/users로 읽기 전용 마운트합니다. 파일 확인용이며 학습 워커의 쓰기 마운트는 바꾸지 않습니다. API 컨테이너 재생성이 필요하므로 배포 프롬프트의 nginx 재확인 절차도 따라주세요.

## 주요 변경 파일
- backend/app/routers/training.py 및 app/main.py: 계정별 학습/분석 상태 읽기 API.
- docker-compose.yml: API에 사용자 가중치 읽기 전용 접근 추가.
- hooks/useVideoFreshness.js: 실제 프레임 진행 확인, 정지/복구/숨김/미지원 처리.
- hooks/useAccountStatus.js: 15초 갱신, 타임아웃·계정 변경·화면 종료 처리.
- components/status/LiveHealthCard.jsx, TrainingStatusCard.jsx: 사용자 상태 표시.
- pages/LivePage.jsx, CameraHostPage.jsx: 영상 상태·시각·재생/재연결.
- pages/HomePage.jsx, SettingsPage.jsx: 개인화 카드 노출.
- services/liveConnection.js: 연결 신호와 실제 영상 수신 표현 분리.
- backend/tests/test_training_status.py 및 프런트엔드 상태 테스트: 계정 격리·학습 단계·이전 응답 차단·프레임 정지와 복구.
- backend/tools/review_demo.py, babyeye-web/tests/status-browser.mjs: 임시 DB와 가상 카메라로 실제 로컬 WebRTC 검증.
- Android app/build.gradle: 1.8 / versionCode 9.

## 검증 결과
- 백엔드 전체: 152 passed, 11 skipped (PostgreSQL 환경 전용 테스트 미실행).
- 프런트엔드: 80 passed, 21 files.
- Edge + 실제 로컬 WebRTC + Chromium 가상 카메라·마이크: 실제 프레임 표시, 일시 정지 10초 초과 경고, 재생 복구, 재연결, 송출 종료 정리, 다른 계정의 세션 차단 통과.
- 같은 브라우저에서 임시 학습 작업/모델 등록 자료로 대기→진행→검토 대기→적용 등록 화면 확인. 실제 GPU 학습이나 운영 모델 적용은 하지 않았습니다.
- Android 웹 빌드, Capacitor 동기화 및 debug APK 빌드.
- 실제 Android 기기의 백그라운드·잠금·제조사 절전 환경과 외부 네트워크/TURN 경로는 실기기에서 추가 확인이 필요합니다.

## 개발 PC 재빌드
babyeye-web에서 npm ci, npm run build -- --mode android, npx cap sync android 실행 후 Android Studio에서 android 폴더를 열고 APK를 빌드하세요. .env.android, 로컬 google-services.json과 기존 서명을 유지합니다. 제공 APK는 debug 서명입니다.

## 배포 PC
DEPLOY_CODEX_PROMPT.md를 전달하세요. 이 개발 PC에서는 운영 컨테이너 재시작, DB 변경, 모델 적용을 실행하지 않았습니다.
