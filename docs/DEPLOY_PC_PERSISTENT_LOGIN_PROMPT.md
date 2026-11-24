# 배포 PC Codex용 로그인 유지 시간 제거 적용

C:\deploy\baby-monitor의 BabyEye에 최신 로그인 무기한 유지 변경을 적용해줘. 저장소 https://github.com/ImSChan/baby-monitor.git 이고 docs/PERSISTENT_LOGIN.md를 먼저 읽어. API와 최신 앱/웹 적용이 필요한 변경이야.

1. AGENTS.md, git status/remote, 실제 Docker context/Compose project/overlay를 확인해. 운영 소스는 바인드 마운트일 수 있으므로 git pull부터 하지 마. fetch한 main 변경과 원래 commit을 기록하고 로컬 변경을 덮어쓰지 마.
2. DB/사용자/업로드/피드백/학습 데이터/가중치/Redis/SSL/비밀키를 보존해. 이번 변경의 SQL 마이그레이션은 없어. JWT_SECRET_KEY는 기존 값을 그대로 유지해. down -v/prune/reset/clean/강제 push/모델 승격/DB 초기화는 금지야.
3. 현재 라이브 이용 중이라면 API 교체가 연결을 종료하므로 적용 시점을 맞추고 종료 후 다시 연결할 수 있게 안내해. backend-api만 정상 중지하고 깨끗한 checkout을 검토한 origin/main으로 fast-forward해. 같은 운영 Compose/overlay로 backend-api만 새 소스를 반영해 재생성/재시작해. 기본 구성은 backend/app 바인드 마운트지만 실제 이미지에 소스가 복사되는 구성이라면 해당 이미지를 준비해. DB/Redis/분석/학습 Worker를 이 변경 때문에 재생성하지 마. 실패하면 기존 commit 코드로 안전 복구하고 서비스가 중단된 채 남지 않게 해.
4. health와 오류를 확인하고 격리 환경에서 가입 또는 합의된 시험 계정으로 로그인해. 새 JWT의 exp 없음/persistent=true, /api/auth/me, 라이브 WebSocket 인증을 검증하되 토큰·비밀번호는 콘솔/보고서에 출력하지 마. 기존 exp 토큰의 만료를 무시하거나 과거 토큰을 되살리지 마. 현재 로그인돼 있는 사용자는 한 번 다시 로그인해야 새 정책을 받는다고 안내해.
5. 가능한 테스트를 실행해. backend tests/test_persistent_auth.py, tests/test_live_sessions.py, 프런트엔드 저장소/AuthContext 테스트를 확인해. 새 토큰이 시간이 지나도 인증되고 계정 비활성/잘못된 서명은 거부되는지, 정상 WebSocket은 시간 경과만으로 종료되지 않으면서 끊긴 연결은 정리되는지 구분해 확인해. TEST_POSTGRES_URL은 운영 DB에 설정하지 마.
6. main 연동 Vercel 배포와 Android v1.19 업데이트를 확인해. 앱이 localStorage의 JWT로 재실행 후 로그인 복원하고, 로그아웃 후 재로그인 화면이 되는지 확인해. 앱 데이터 삭제는 로그인 정보를 지우므로 시험을 이유로 사용자 데이터를 초기화하지 마.

최종 요약: 적용 commit, 갱신한 서비스, DB 변경 없음/가중치 보존, 테스트 결과와 미실행 항목, 새 토큰 적용을 위한 재로그인 필요, 남은 Vercel/APK 조치를 짧게 알려줘. 운영 계정 생성/키 교체/학습 중단 등 별도 작업을 임의로 추가하지 마.
