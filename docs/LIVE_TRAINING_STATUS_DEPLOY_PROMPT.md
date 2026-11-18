C:\deploy\baby-monitor에서 홈캠 연결 상태 및 개인화 학습 상태 표시 변경을 적용해줘.

대상 GitHub는 https://github.com/ImSChan/baby-monitor.git 이며 main을 사용해. 먼저 AGENTS.md, git status, remote, 실제 Compose 파일·프로젝트명, 실행 컨테이너 상태를 확인하고 docs/LIVE_TRAINING_STATUS.md를 읽어.

기존 로컬 수정과 .env, Firebase 비밀키, SSL 인증서, PostgreSQL 볼륨, backend/uploads, backend/training-data, backend/weights 전체를 보존해. 강제 reset/clean, docker compose down -v, DB drop/reset, 학습 자료 및 가중치 삭제는 하지 마. 모델 승격/재학습을 실행하지 마. 진행 중 학습·분석 워커를 불필요하게 중단하지 마.

1. 배포 전 커밋과 서비스 상태, 기존 백업 상태를 기록해. 로컬 변경이 없으면 git fetch origin 후 main에서 git pull --ff-only origin main으로 갱신해. 충돌/다른 브랜치는 강제 덮어쓰기하지 말고 보존 가능한 방식으로 처리해.
2. 이번 변경에는 SQL 마이그레이션이 없어. DB 스키마나 데이터를 수정하지 마. 기존 학습/피드백 테이블 적용 상태만 읽기 전용으로 확인해.
3. 실제 학습·분석 워커가 쓰는 사용자 가중치 폴더를 확인해. 기본 구성은 backend/weights/users야. backend-api에 같은 폴더가 /app/weights/users로 읽기 전용 마운트되는지 확인해. USER_WEIGHTS_DIR 환경 변수가 있다면 실제 마운트 경로와 일치하는지 확인하되 비밀 환경 값은 출력하지 마. 기존 가중치 파일을 이동하거나 새 파일로 덮어쓰지 마.
4. 실제 운영 Compose 옵션을 유지해. 기본 구성은 docker compose -f docker-compose.yml -f docker-compose.push.yml up -d --no-deps backend-api 야. API의 볼륨 추가 때문에 단순 restart가 아니라 컨테이너 재생성이 필요해. 이번 API 변경에 새 Python 패키지는 없어. DB·Redis·GPU 학습 워커·분석 워커는 재생성하지 마.
5. API가 정상 기동되고 /health가 성공하는지 확인해. API 컨테이너 IP가 바뀔 수 있으므로 nginx가 backend-api를 다시 해석하도록 기존 nginx 설정을 검사하고 reload해. 예: docker compose -f docker-compose.yml -f docker-compose.push.yml exec -T nginx nginx -t 이후 성공한 경우 exec -T nginx nginx -s reload. 외부 /health와 기존 API도 확인해.
6. 인증 없는 /api/training/status와 /api/training/analysis-status가 보호되는지 확인해. 승인된 본인 테스트 계정이 있다면 해당 계정만 조회해서 학습 상태와 적용 정보가 반환되는지 확인해. JWT·비밀번호·비밀키와 사용자 원본 자료를 로그에 남기지 마. 등록 메타데이터가 없는 예전 가중치는 적용 확인 필요가 정상이며 이를 해결하려고 모델을 임의 승격하지 마.
7. Vercel의 최신 main 반영 여부를 확인해. Android는 개발 PC에서 제공한 1.8 APK를 같은 서명으로 업데이트하거나 최신 소스로 재빌드해야 해. 실제 기기에서 영상 정상→멈춤 경고→재생/재연결과 홈캠 종료, 계정 변경 후 정보 초기화, 홈/설정의 개인화 학습 상태를 확인해.
8. 적용한 커밋, 실행 명령, DB 변경 없음, 가중치 읽기 전용 마운트, 기존 학습 보존, API/nginx 상태와 남은 실기기 검증 항목을 정리해줘. 운영 계정에 가짜 피드백이나 학습 작업을 생성하지 마.
