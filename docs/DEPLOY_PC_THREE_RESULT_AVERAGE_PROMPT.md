# 배포 PC Codex용 3회 평균 대표 상태 적용

C:\deploy\baby-monitor에 최신 3회 연속 대표 상태/3건 평균 점수 API를 적용해줘. GitHub https://github.com/ImSChan/baby-monitor.git 과 docs/THREE_RESULT_AVERAGE.md를 확인해. 계획으로 끝내지 말고 이 기능 범위의 적용·검증·결과 요약까지 진행해.

1. AGENTS.md, git status/remote, 실제 Docker context/project/Compose overlay와 main 변경을 확인해. 코드 바인드 마운트가 있으므로 git pull부터 하지 마. git fetch origin main 후 검토한 commit과 원래 commit을 기록해. 로컬 변경은 덮어쓰지 마.
2. DB 마이그레이션은 없어. 기존 사용자/분석/알림/피드백/학습 데이터/가중치/Redis 큐/비밀키/인증서와 JWT_SECRET_KEY를 보존해. SQL 일괄 보정/원본 점수 변경/초기화/down -v/prune/reset/clean/강제 push는 금지해.
3. 현재 라이브 이용/분석을 확인하고 API 적용 시간을 맞춰. API 교체 중 WebSocket은 재연결이 필요해. backend-api만 정상 중지한 뒤 깨끗한 checkout을 검토한 main으로 fast-forward하고 같은 Compose/overlay로 backend-api만 최신 소스를 사용해 재생성/기동해. 실제 구성이 소스 복사 이미지면 API 이미지를 먼저 준비해. DB/Redis/학습 Worker를 이 변경 때문에 재생성하지 마. 실패하면 기존 코드로 안전히 복구하고 서비스가 중단된 채 남지 않게 해.
4. 인증된 GET /api/emotions/representative를 확인해. 다른 계정의 데이터는 보이지 않고, 최신 동일 카메라 3건의 sampleIds/sampleCount=3/scoreBasis=three_consecutive_mean이어야 해. confidence와 각 후보는 해당 3개 실제 점수의 평균이어야 하고 시각은 마지막 분석이어야 해. 원본 행은 변경되지 않아야 해. 토큰/개인정보를 로그에 출력하지 마.
5. 격리 시험에서 feeding .90/.80/.70, care .02/.35/.10, sleep .08/.05/.20 → 대표 feeding .80, 2순위 care .156667, 3순위 sleep .11을 확인해. 네 번째 결과가 생기면 최근 3개만 쓰는지, 새 상태 2회만으로 대표가 바뀌지 않는지, 다른 계정/카메라가 섞이지 않는지, 누락 후보를 0으로 채우지 않는지 확인해. 운영 DB에 합성 시험 자료를 넣지 마.
6. 이전에 top3 저장 Worker가 적용돼 있는지 확인해. 기존 top2 행의 세 번째 후보는 소급 생성하지 마. 새 점수 기록이 필요하나 Worker가 예전 버전이면 이전 top3 변경 배포 상태를 구분해 보고하고 정상 작업 완료 후 해당 Worker를 갱신할 필요가 있는지 판단해. 이번 평균 로직 자체는 API의 읽기 집계이며 학습/모델 승격을 하지 않아.
7. tests/test_confirmed_state.py와 프런트엔드 representativeState/representativeApi 테스트를 가능한 범위에서 실행해. PostgreSQL 시험은 전용 DB/schema만 사용해. 운영 DB를 TEST_POSTGRES_URL로 쓰지 마. Vercel main 배포와 Android v1.20을 확인해. 새 API가 없을 때도 최근 이력에서 실제 3건이 있으면 평균을 계산하지만 전체 과거 기록 보장은 새 API가 필요해.

최종 보고: 적용 commit/서비스, DB 변경 없음과 원본·가중치 보존, sampleIds/평균·순위 검증 결과(개인정보 없이), 실행/미실행 테스트, 남은 Vercel/APK/구형 Worker 적용 항목을 짧게 알려줘.
