# 로그인 유지 시간 제거

기존 로그인 JWT의 60분 exp를 제거했다. 새 토큰은 서명된 sub/iat/persistent=true를 담고 만료 시각이 없다. 기존 exp가 있는 토큰은 원래 만료를 검증하며 이미 만료된 토큰을 되살리지 않는다. exp도 persistent 정책도 없는 임의 토큰은 거부한다. 서명/사용자 존재/계정 활성 상태를 기존처럼 검증한다.

기존 라이브 WebSocket과 세션 매니저에는 내부 deadline으로 float infinity를 전달한다. 이 값은 외부 JSON에 전송하지 않는다. 정상 heartbeat와 활성 계정이 유지되는 연결은 JWT의 시간 경과로 종료되지 않는다. 살아 있지 않은 연결의 heartbeat/미연결 정리와 30초마다 활성 계정 재검사는 유지한다.

클라이언트는 JWT를 sessionStorage에서 localStorage로 이동했다. 앱/브라우저를 다시 열어도 /api/auth/me 검증 후 로그인 상태를 복원한다. 기존 tab token은 한 번 이관하고 서버가 검증한다. 비밀번호는 저장하지 않는다. 로그아웃과 인증 오류는 두 저장소를 모두 지우고 라이브 리소스를 정리한다. 같은 브라우저의 다른 탭에서 계정 변경/로그아웃이 일어나면 storage 이벤트로 다시 검증하며, 이전 tab token이 로그아웃을 되돌리지 않게 한다. 다른 기기의 로그인까지 로그아웃시키는 기능은 아니다.

적용은 backend-api 업데이트와 최신 프런트엔드/APK가 필요하다. 기존 60분짜리 토큰을 쓰는 사용자는 업데이트 후 한 번 다시 로그인해야 새 토큰을 받는다. DB 마이그레이션/가중치/학습 데이터 변경은 없다. JWT_SECRET_KEY를 바꾸지 않는다.

변경 파일: backend/app/routers/auth.py; babyeye-web/src/api/authToken.js, contexts/AuthContext.jsx; 관련 REST/WebSocket/저장소/인증 테스트; Android v1.19/versionCode20.

검증: 백엔드 185 passed/12 PostgreSQL 전용 skipped, 프런트엔드 30개 파일/138 passed. 서명 정책, 2099년 시각에서도 새 토큰 유효, 기존 만료 토큰 거부, 계정 비활성 거부, 정상 라이브 연결의 긴 wall-clock 경과와 idle cleanup, 오래된 인증 응답/로그아웃 경합, 저장소 이관·앱 데이터 복원·탭 동기화를 확인했다.

실제 Edge 390×844 + 임시 SQLite에서 실제 가입/로그인, exp 없는 서명 토큰, legacy 저장소 정리, 새 페이지/페이지 닫은 뒤 재진입의 로그인 복원, 한 탭 로그아웃 후 다른 탭의 로그인 해제와 양쪽 저장소 삭제를 검증했다. 실제 Android 앱 종료/재실행 및 기기 전원 재부팅 시험은 수행하지 않았다. 운영 데이터/키/FCM에는 접근하지 않았다.

Vite android build / cap sync / Gradle assembleDebug 성공. 운영 서버는 자동 재배포하지 않았다. DEPLOY_PC_PERSISTENT_LOGIN_PROMPT.md를 배포 PC Codex에 전달한다.
