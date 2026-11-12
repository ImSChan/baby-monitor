# ?? ?? ??? ??

2026-11-12: ??? ???/????, ?? non-stable ?? 3?, ??/?? ??? ??.

- ???: 25 passed, ?? PostgreSQL ?? 3 skipped (? PC? DB/Docker ??).
- ?????: 13 passed. ??? ??/??/?? ??, ? ??, ?? ??/??, ??/?? ??? ??? ??? ??.
- Android mode ? ??? JDK 21 assembleDebug ??. versionCode=2, versionName=1.1.
- Firebase ?? Android ??? ?? API ??? ??? emulator-5554? ???? ??. ??? ?? ?? ???, ???? ??? FATAL/Uncaught/TypeError/ReferenceError/FCM ??? ?? ??.
- ?? FCM ?????? ? 3? ????? ??? ? ?? 002 migration ?? ? ??? ??? ? ?? ??.
- ?? ?? OpenAPI?? ?? ? preferences/list API? ??. ??? ?? ???? ???.
- ?? ???? ?? ??? ???? ?????? ????? ????? ???? ?? ???.

?? ??? ?? ??? ?? ????.

# 검증 결과

검증일: 2026-11-12 (Asia/Seoul). 기준 main: 1c3dcc2. 작업 브랜치: codex/push-feedback-ux.

| 검증 | 결과 | 범위 |
|---|---|---|
| Python pytest | 18 passed, 3 skipped | SQLite 격리 DB, 실제 JWT 검증, FastAPI TestClient, SDK 전송 모의 |
| React/Vitest | 7 passed, 3 files | DOM 환경, native 플러그인 모의 |
| Vite production build | 성공 | 기존 웹과 새 결과 화면 번들 생성 |
| Capacitor sync android | 성공 | push-notifications 8.0.0 연결 |
| Gradle assembleDebug | 성공, 125 tasks | JDK 21, SDK 36, Firebase 설정 없는 빌드 검증 |
| Python compileall | 성공 | backend/app 구문 검증 |
| git diff --check | 성공 | 공백·패치 오류 확인 |
| 실제 PostgreSQL | 미실행 | Docker/psql 미설치, TEST_POSTGRES_URL 미설정으로 3개 skip |
| 실제 Firebase/Android 수신 | 미실행 | 비밀키/google-services.json/실기기 미제공 |
| GPU 학습·가중치 승격 | 미실행 | 기존 학습 후보 검증 함수까지 확인, 운영 가중치 보존 |

백엔드 테스트는 인증 누락·잘못된 JWT, 등록/회전/해제/계정 전환, 토큰 충돌, 타인 결과 404, 기존 피드백 저장·중복 409·학습 예약 후 수정 제한, 사용자별 유효 학습 후보, 일시 오류 backoff·최대 시도·Unregistered, 해제/계정 변경/토큰 변경/TTL 이후 전송 취소, 비활성 push/no_devices, 메타데이터 지연 처리, outbox 유일 제약, 알림 정책 제외, 최소 FCM payload와 안정적인 tag, 기기별 부분 실패를 확인한다.

프런트엔드는 권한 미허용 안내, 허용 후 등록, foreground 수신, 로그인 전 클릭 목적지 유지, 해제, 로그인 후 원래 결과 복귀, 잘못된 알림 ID/외부 리다이렉트 차단을 확인한다. 테스트용 저장소는 모의 객체를 사용한다. 실제 Android 종료 상태의 클릭 전달은 실기기에서 추가 검증해야 한다.

PostgreSQL 테스트는 실제 migration 2회 실행·upsert, advisory lock을 쓰는 enqueue와 rollback, FOR UPDATE SKIP LOCKED 동시 dispatcher 검증을 포함한다. 실행 명령은 PUSH_FEEDBACK.md에 있다. SQLite 테스트가 PostgreSQL 잠금 보장을 대신하지 않는다.

실행 환경: Windows PowerShell, Python 3.10.0 격리 venv, Node 26.13.0, JDK 21.0.11. 배포 이미지의 Python 3.11은 유지했다. pytest 9.2.0은 이 환경에서 수집 내부 오류가 발생해 테스트 의존성을 8.3.5로 고정했다. 기본 Java 8 및 Android Studio Java 25 빌드는 실패했으나 설치된 JDK 21로 성공했다. 시스템 전역 Java 설정을 바꾸지 않았다.

기존 Pydantic/Starlette의 deprecation, Python 3.10에 대한 Google SDK 지원 종료 경고, React Router v7 future flag 경고, Android flatDir/일부 native library strip 경고가 있었다. 최종 빌드/테스트는 성공했다. 추가한 Vitest는 감사 결과를 보고 4.1.11로 갱신했다. 최종 npm 감사에는 critical 0, high 5, moderate 7, low 1(총 13개)이 남아 있다. 상세 패키지는 docs/AUDIT_SUMMARY.json 및 산출물 audit-summary.json에 기록한다. 이 기능 범위 밖의 일괄 major 업그레이드는 하지 않았다.

생성된 로컬 debug APK는 Firebase 설정과 실제 VITE_API_BASE_URL 없이 만든 컴파일 확인용이다. 운영 설치용 산출물로 제공하지 않으며, 안내서의 실제 설정을 넣고 재빌드해야 한다.

운영 DB·볼륨·학습 파일·가중치·기존 Vercel 서비스를 변경하지 않았다. 원격 push나 자동 배포를 실행하지 않았다.
