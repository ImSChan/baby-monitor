# 배포 PC Codex에게 전달할 프롬프트

C:\deploy\baby-monitor의 BabyEye에 최신 3회 연속 대표 상태/3순위 표시 기능을 적용해줘. GitHub는 https://github.com/ImSChan/baby-monitor.git 이고 docs/CONFIRMED_STATE_OVERVIEW.md를 먼저 읽어줘. 계획으로 끝내지 말고 이 기능에 필요한 API/분석 Worker 갱신과 검증·결과 요약까지 진행해.

이번 변경은 DB 마이그레이션이 없어. PostgreSQL 데이터/피드백/업로드/학습 데이터/가중치/Redis 큐/환경/비밀키/SSL을 보존해. DB 초기화, 임의 데이터 보정, 볼륨 삭제, down -v, prune, git reset/clean, 강제 push, 학습 모델 승격은 하지 마. 이 작업과 무관한 서비스나 학습 작업을 임의 재배포/중단하지 마. 비밀번호·JWT·키는 출력하지 마.

1. AGENTS.md, git status, remote, 실제 Docker context/project/Compose overlay를 확인해. 운영 checkout은 app 코드가 바인드 마운트되므로 git pull부터 하지 마. git fetch origin main 후 새 문서/변경 사항을 검토하고 원래 commit을 기록해. 로컬 변경이 있으면 덮어쓰지 말고 차이를 보고해.
2. 기존 API의 DB가 007까지 준비된 현재 환경인지 확인하되 이번 작업에서 SQL을 실행할 필요는 없어. 새 소스와 다른 신규 기능이 섞였는지 확인해. 시험 PostgreSQL이 있으면 운영 DB를 사용하지 않고 test_confirmed_state.py와 기존 테스트를 실행하고, 새 window 쿼리가 해당 데이터 규모에서 정상 응답하는지 확인해. 실데이터 내용을 로그로 덤프하지 마.
3. 신규 분석 요청을 안전하게 중지/차단하고 진행 중인 분석이 완료되도록 기다려. 큐나 작업을 삭제하지 마. backend-api와 backend-worker만 정상 정지하고, 검토한 main으로 깨끗한 checkout을 fast-forward해(git merge --ff-only origin/main). 장시간 학습 작업은 종료하지 마.
4. 같은 운영 Compose/overlay 구성으로 backend-api와 backend-worker만 최신 소스를 사용해 재생성/재시작해. 현재 기본 구성은 backend/app 바인드 마운트지만 실제 이미지에 소스가 복사되는 구성이라면 해당 이미지부터 준비해. DB/Redis/training/notification 서비스를 이 변경 때문에 재생성하지 마. 가중치 파일/승인 상태는 보존해. API가 정상 기동되지 않으면 서비스를 방치하지 말고 기록한 이전 코드로 안전하게 복구해.
5. health와 오류 로그, 인증된 GET /api/dashboard를 확인해. 기존 currentEmotion 필드는 유지되고 confirmedEmotion이 추가돼야 해. 3연속 기록이 없으면 null이며, 있으면 해당 계정/카메라의 최신 확정 결과(id/시각/confidence/topPredictions/consecutiveCount=3)여야 해. JWT는 콘솔/결과에 남기지 마.
6. 실제 운영 DB에 합성 분석을 넣지 말고 격리 테스트에서 care2→null, care1추가→care, feeding2→기존 care 유지, feeding1추가→feeding, stable3→stable을 확인해. 서로 다른 계정·카메라 결과를 섞지 않는지, unknown이 연속성을 끊는지 확인해. 20개 넘는 새 미확정 기록 뒤에도 이전 확정 결과를 조회해야 해. 대표 상태에는 알림 opt-in이 필요하지 않고 stable은 기존처럼 푸시 대상에서 제외돼야 해.
7. 새 Worker의 실제 다음 결과가 top3를 저장하는지 가능한 범위에서 확인해. 원래 후보가 1~2개뿐인 override나 예전 top2 DB 행에 3순위를 임의로 추가하지 마. 프런트는 그 경우 기록 없음으로 보여. 실제 모델을 실행하지 못했으면 단위/모의 검증과 구분해 보고해.
8. 신규 분석을 정상 재개하고 API/Worker 상태를 확인해. Vercel main 배포와 Android v1.16 앱을 확인하되 임의 운영 도메인/배포 설정 변경은 하지 마. 새 API가 적용되지 않은 상태에서는 새 화면이 단일 최신 분석을 대표 상태로 대신 표시하지 않아. Android는 새 APK 설치 또는 build/sync 후 실행이 필요해.

최종 보고: 적용 commit, 갱신한 서비스, DB SQL 불필요 및 데이터/가중치 보존, confirmedEmotion 검증 결과, 3후보 저장 검증 결과, 실시/미실시 테스트, 장애·복구 여부, 남은 사용자 조치를 간결하게 알려줘.
