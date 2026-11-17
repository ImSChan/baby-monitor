C:\deploy\baby-monitor에서 BabyEye 알림 피드백 단순화 변경을 적용해줘.

먼저 AGENTS.md, git status, remote, 현재 서비스/Compose 설정을 확인하고 기존 사용자 수정과 .env/Firebase 비밀키를 보존해. 대상 remote는 https://github.com/ImSChan/baby-monitor.git 이며 main을 사용해. docs/NOTIFICATION_FEEDBACK.md를 읽고 변경 범위부터 확인해.

운영 PostgreSQL 데이터, backend/weights, backend/training-data, backend/uploads 및 인증서·비밀키를 보존해. docker compose down -v, DB reset/drop, weights 삭제, 강제 git reset/clean은 하지 마. 실행 중인 GPU 학습·분석 워커도 불필요하게 재시작하지 마. 비밀키 내용을 출력하거나 Git에 올리지 마.

1. 현재 커밋·컨테이너 상태와 진행 중 학습 유무를 기록해. 기존 백업을 확인하고 필요하면 DB를 컨테이너 내부 pg_dump -Fc -f /tmp/<타임스탬프>.dump로 만든 뒤 docker cp로 호스트 백업 폴더에 복사하고 pg_restore --list로 읽을 수 있는지 확인해. PowerShell에서 바이너리를 > 리다이렉션하지 마. 기존 볼륨·가중치 백업 정책을 지켜.
2. 작업 트리가 깨끗하면 git fetch origin 후 main에서 git pull --ff-only origin main을 적용해. 로컬 수정/다른 브랜치가 있으면 보존 가능한 방식으로 처리하고 강제 덮어쓰기는 하지 마. git pull 전 API가 backend/app 바인드 마운트를 쓰므로 실행 중 프로세스가 재로드 모드인지 확인해.
3. 이번 변경은 새 DB 스키마가 없으므로 SQL 마이그레이션을 추가 실행하지 마. 기존 ReviewAnalysis/ReviewAction 및 004, 기존 육아 기록 006 적용 상태를 읽기 전용으로 확인해. 누락이 있다면 먼저 기존 해당 배포 가이드를 확인하고 데이터 보존 방식으로만 진행해.
4. 실제 운영에서 쓰는 Compose 파일과 프로젝트명을 유지해. 기본 구성이라면 docker compose -f docker-compose.yml -f docker-compose.push.yml build notification-worker 후 docker compose -f docker-compose.yml -f docker-compose.push.yml up -d --no-deps notification-worker 를 실행해. notification-worker는 앱 소스 바인드 마운트가 없어 이미지 재빌드가 필요해. backend-api는 소스 바인드 마운트를 확인한 뒤 docker compose -f docker-compose.yml -f docker-compose.push.yml restart backend-api 로 새 코드를 로드해. backend-api를 불필요하게 재생성하지 않아 nginx 주소 문제를 피하고, DB/Redis/학습·분석 워커는 그대로 둬.
5. 서비스 상태·API health·오류 로그를 확인해. production 계정에 가짜 피드백이나 분석·푸시를 주입하지 마. mock 검증은 별도 임시 SQLite에서 backend/tests/test_reviews.py 또는 backend/tools/review_demo.py로만 실행해. 운영 자격증명을 출력하지 마.
6. Vercel이 최신 main을 배포했는지 확인하고 공개 웹 자산이 상태 버튼 UI를 포함하는지 확인해. 운영 Vercel 설정은 변경하지 마. Android 1.7 APK는 개발 PC에서 제공되며 로컬 자산 기반 앱은 업데이트 설치가 필요할 수 있어.
7. 배포 전/후 커밋, 실제 실행 명령, DB 변경 없음, 서비스 검증, 실행 중 학습 보존 여부, 실기기에서 확인할 항목을 정리해줘. 문제 발생 시 임의 스키마 변경이나 데이터 삭제 없이 원인을 확인하고 롤백은 기존 커밋/이미지를 기준으로 데이터 보존 방식으로 처리해.
