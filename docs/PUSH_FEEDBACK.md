# BabyEye 푸시·피드백 구현 및 적용

## 작업 기준

- 최신 `origin/main`의 `1c3dcc2`에서 `codex/push-feedback-ux` 브랜치를 만들었다.
- 구현 위치는 `C:\dev\baby-monitor-push`이다. 원래 `C:\dev\baby-monitor`의 기존 수정 5개는 보존했다.
- 원격 push, PR 생성, 운영 배포, 운영 DB 변경, Firebase 키 생성, 학습 실행은 하지 않았다.
- 기존 main은 push 시 운영을 자동 배포한다. 이번 브랜치의 workflow는 수동 실행 전용으로 바꿨다. 이 변경을 포함해 검토하기 전 main에 push하지 않는다.

## main 구조와 재사용

| 영역 | 기존 구현 | 연결 방식 |
|---|---|---|
| React/Vite | AppRouter, AuthContext, sessionStorage JWT | 보호된 결과 경로와 로그인 후 복귀 |
| Capacitor Android | com.babyeye.monitor, Capacitor 8, SDK 36 | 공식 Push Notifications 8 플러그인 |
| FastAPI/SQLModel | main.py 라우터, get_session | /api/push 추가 |
| 인증 | auth.py의 HS256 JWT 및 활성 사용자 검증 | 기존 get_current_user_id 재사용 |
| 분석 입력 | inference.py 업로드 → UUID별 메타데이터 → Redis 큐 | 요청 ID를 공통 식별자로 사용 |
| 분석 Worker | 오디오 전처리 → 사용자별 모델 → quiet audio 안정 상태 보정 → EmotionEvent → 메타데이터/Redis 완료 | EmotionEvent와 알림 outbox를 같은 트랜잭션에 저장 |
| 모델 | model_runtime.py, model_pt.py, 사용자별 head 로드 | 모델 로직 유지 |
| 기존 알림/대시보드 | Alert 모델, alerts/dashboard 라우터 | 기존 화면 유지, 전송 이력은 별도 outbox |
| 피드백 | inference_feedback의 request_id 유일 제약, 메타데이터 소유권 확인 | 기존 POST/PATCH와 FeedbackCard 재사용 |
| 학습 예약 | training_worker.py, 실제 미디어/사용자/라벨 검증, 사용자별 20건 | 같은 pending/excluded 상태로 진입 |
| 학습 실행 | auto_training_executor.py, train_personalized_heads.py | 기존 예약·클래스 분포 검증 유지 |
| 가중치 승격 | personalized_head_store.py의 명시적 승격 | 자동 승격하지 않음 |
| 인프라 | Windows Docker Desktop, PostgreSQL 16 named volume, Redis, API/분석/학습, Nginx | 선택적 compose overlay로 알림 Worker 추가 |
| 웹 서비스 | Vercel SPA와 기존 API 주소 | Vercel 설정 유지, 웹에서는 native 푸시 호출 안 함 |

## 동작과 보장 범위

1. PUSH_ENABLED=true이고 need가 feeding/sleep/care이며 confidence ≥ 0.8인 경우만 후보로 삼는다. quiet audio/안정 상태는 제외한다.
2. 사용자별 기본 300초 cooldown을 PostgreSQL advisory transaction lock으로 직렬화한다. request_id 유일 제약으로 중복 outbox를 차단한다.
3. 결과 스냅샷과 알림 이벤트를 EmotionEvent와 함께 commit한다. 분석 Worker에서는 Firebase를 호출하지 않는다.
4. 별도 Worker가 메타데이터 completed를 확인한 뒤 활성 기기별 전송 row를 만든다. 미완료 메타데이터는 30초 후 재확인한다. 기본 이벤트 TTL은 1시간이다.
5. FOR UPDATE SKIP LOCKED LIMIT 1로 작업을 확보한다. 기기 row도 잠그고 계정·토큰·활성 여부를 재검증한다.
6. 일시 실패는 기본 60/120/240/480초 간격, 총 5회 시도한다. 만료 시 취소한다. Unregistered 토큰은 비활성화한다. 잘못된 요청/권한/프로젝트 불일치는 영구 실패로 처리한다. 다른 기기의 성공 전송은 재시도하지 않는다.
7. FCM payload에는 eventId/requestId와 일반 안내문만 넣는다. 상세 상태·미디어는 인증 API에서 확인한다.
8. 클릭 → /notifications/:eventId → 소유자별 결과/피드백 조회 → 기존 피드백 API. 미로그인/JWT 만료 시 로그인 후 같은 결과로 복귀한다.
9. foreground에서는 앱 내 결과 확인 버튼, background/종료 상태에서는 Android 시스템 알림을 사용한다. 권한 요청은 사용자의 ‘알림 켜기’ 동작으로 시작한다. 기존 허용 기기는 로그인 시 재등록한다.
10. 로그아웃 전에 서버 기기를 해제하고 표시된 알림을 제거한다. 서버 해제 실패 시 로그아웃을 완료하지 않고 재시도 오류를 표시한다. 계정 전환·토큰 갱신 후 이전 전송은 취소한다.
11. correct/incorrect는 기존 pending, uncertain은 excluded이다. 중복 409와 reserved 이후 수정 제한을 유지한다. 유효 미디어·클래스 분포·기존 executor 설정 조건이 충족되어야 학습되며 가중치 승격은 기존 절차를 따른다.

FCM과 DB는 하나의 트랜잭션을 공유하지 않는다. FCM 수락 직후 DB commit 전 장애에는 재전송 가능성이 있다. 같은 eventId의 Android tag/collapse key로 표시 중복을 완화하지만 정확히 한 번 전달을 보장하지 않는다. FCM 수락은 실제 단말 수신·열람 확인을 뜻하지 않는다. 전송 상태는 push_deliveries가 기준이다. notification_events의 queued는 전송 row 생성 완료, no_devices는 당시 등록 기기가 없음을 뜻하며 소급 발송하지 않는다. OS에 이미 전달된 알림을 서버에서 회수할 수는 없지만 결과 API의 소유권 검증은 유지된다.

## API

모두 기존 Bearer JWT가 필요하며 user_id를 클라이언트에서 받지 않는다.

- POST /api/push/devices: installation_id(UUID), token. 설치 단위 upsert·계정 전환·토큰 갱신. 다른 설치에 같은 토큰이 있으면 409. 토큰은 20~2048자의 FCM 식별자 문자만 허용한다.
- POST /api/push/devices/{installation_id}/revoke: 현재 사용자 소유 설치만 비활성화, 반복 호출 가능.
- GET /api/push/events/{event_id}: 소유자의 스냅샷, requestId, 기존 피드백. 타인은 404.
- 피드백 저장/수정은 기존 /api/feedback와 /api/feedback/{id}를 사용한다.

## Firebase 설정

1. Firebase Console에 Android 패키지 com.babyeye.monitor를 등록한다.
2. Android 설정 파일을 babyeye-web/android/app/google-services.json에 로컬 배치한다. gitignore에 포함된다. 이 파일은 Admin 비밀키와 다른 클라이언트 설정이다.
3. 해당 프로젝트의 Firebase Cloud Messaging API(HTTP v1)를 활성화하고 전송 권한이 있는 서비스 계정을 준비한다.
4. Admin 서비스 계정 JSON은 저장소 밖 C:\deploy\secrets\babyeye-firebase-admin.json 등에 두고 운영 계정만 읽도록 ACL을 설정한다. private_key/토큰을 GitHub나 로그에 올리지 않는다.
5. .env에 다음 값을 설정한다. 개발 PC에서는 외부 키 파일 경로를 개발용으로 바꾼다.

```dotenv
PUSH_ENABLED=true
PUSH_MIN_CONFIDENCE=0.8
PUSH_COOLDOWN_SECONDS=300
PUSH_TTL_SECONDS=3600
PUSH_MAX_ATTEMPTS=5
FIREBASE_CREDENTIALS_FILE=C:/deploy/secrets/babyeye-firebase-admin.json
```

알림 Worker에만 JSON을 read-only mount하고 GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-admin.json을 제공한다. API/분석 Worker에는 키가 필요 없다. Android 설정과 서버 Firebase 프로젝트가 다르면 SenderIdMismatch로 실패한다. 아웃바운드 HTTPS 접근이 필요하다. 기본 .env.example은 PUSH_ENABLED=false이다.

공식 참고: [Capacitor Firebase 안내](https://capacitorjs.com/docs/guides/push-notifications-firebase), [Firebase Python messaging API](https://firebase.google.com/docs/reference/admin/python/firebase_admin.messaging).

## 개발 PC 검증 명령 — PowerShell

현재 개발 폴더의 수정 보존을 위해 별도 worktree에서 작업했다.

```powershell
Set-Location C:\dev\baby-monitor-push
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.test.txt
.\.venv\Scripts\python.exe -m pytest backend\tests -q
Set-Location babyeye-web
npm.cmd ci
npm.cmd test
npm.cmd run build
npx.cmd cap sync android
```

Python 3.11이 없으면 설치 후 사용한다. Docker 이미지는 기존 Python 3.11을 유지한다. 테스트에는 Firebase 비밀키가 필요 없다.

검토 후 feature 브랜치 공유 명령(실행하지 않음):

```powershell
git -C C:\dev\baby-monitor-push push -u origin codex/push-feedback-ux
```

별도 깨끗한 개발 PC의 C:\dev\baby-monitor에서는 원격 공유 후 git fetch origin 및 git switch --track origin/codex/push-feedback-ux로 적용할 수 있다. 현재 수정이 있는 원래 개발 폴더에서는 바로 전환하지 말고 기존 변경과 먼저 비교한다.

## 실제 PostgreSQL 테스트

운영 DB 대신 개발 PC의 별도 일회성 PostgreSQL 16 컨테이너를 사용한다.

```powershell
docker run -d --name babyeye-push-test-db -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=babyeye_push_test -p 127.0.0.1:55432:5432 postgres:16
docker exec babyeye-push-test-db pg_isready -U postgres -d babyeye_push_test
# ready 확인 후
$env:TEST_POSTGRES_URL='postgresql://postgres:test-only@localhost:55432/babyeye_push_test'
Set-Location C:\dev\baby-monitor-push
.\.venv\Scripts\python.exe -m pytest backend\tests -q
Remove-Item Env:TEST_POSTGRES_URL
# 테스트 전용 컨테이너만 정리
docker rm -f -v babyeye-push-test-db
```

통합 테스트는 무작위 babyeye_push_test_* schema만 생성·제거한다. 마이그레이션 2회 실행, PostgreSQL upsert, cooldown/advisory lock, outbox rollback, 동시 dispatcher를 검증한다. TEST_POSTGRES_URL이 없으면 skip한다.

## 배포 PC 적용 — 검토 후 운영자가 직접 실행

아래 명령은 제공용이며 실행하지 않았다. 기존 compose 프로젝트 이름과 PostgreSQL 볼륨 이름을 유지한다. down -v, volume prune, 가중치/미디어 디렉터리 삭제를 하지 않는다.

1. 검토한 feature 커밋을 원격 공유한 뒤 배포 폴더에 로컬 수정이 없는지 확인한다. 현재 compose는 소스 bind mount와 API reload를 사용하므로, 유지보수 시간에 API/분석/학습 프로세스를 정지한 후 코드를 전환한다. 활성 학습 작업의 안전한 종료 여부를 먼저 확인한다. DB/Redis는 계속 실행하고 .env와 외부 키를 유지한다.

```powershell
Set-Location C:\deploy\baby-monitor
git status --short
git fetch origin codex/push-feedback-ux
docker compose stop backend-api backend-worker training-worker
# executor 운영 시에만: docker compose --profile auto-training stop training-executor
# 아래 자리표시자를 검토한 실제 커밋 SHA로 교체
git switch --detach <검토한_커밋_SHA>
```

2. DB/학습 자료를 백업한다. 활성 학습 작업의 안전한 종료 여부를 먼저 확인하고, 기존에 실행 중이던 학습 서비스만 정지한다.

```powershell
$backupDir = 'C:\deploy\backups\babyeye-before-push-' + (Get-Date -Format yyyyMMdd-HHmmss)
New-Item -ItemType Directory -Path $backupDir
docker compose stop training-worker
# executor를 운영하던 경우에만: docker compose --profile auto-training stop training-executor
docker compose exec -T db pg_dump -U baby_user -d baby_monitor -Fc -f /tmp/babyeye-before-push.dump
docker cp baby-monitor-db:/tmp/babyeye-before-push.dump "$backupDir\database.dump"
Copy-Item -LiteralPath .\backend\weights -Destination "$backupDir\weights" -Recurse
Copy-Item -LiteralPath .\backend\training-data -Destination "$backupDir\training-data" -Recurse
docker compose stop backend-worker
Copy-Item -LiteralPath .\backend\uploads -Destination "$backupDir\uploads" -Recurse
```

없는 디렉터리는 신규 설치일 때만 복사를 생략한다. DB dump는 컨테이너 파일을 docker cp로 복사해 PowerShell의 바이너리 stdout 리다이렉션 문제를 피한다. 백업 실패 상태에서는 다음 단계로 진행하지 않는다.

3. 새 Worker를 시작하기 전에 additive migration을 적용한다. 기존 테이블·컬럼·피드백을 수정/삭제하지 않는다. 실패 시 transaction rollback된다.

```powershell
docker cp .\backend\migrations\001_push.sql baby-monitor-db:/tmp/001_push.sql
docker compose exec -T db psql -U baby_user -d baby_monitor -v ON_ERROR_STOP=1 -f /tmp/001_push.sql
if ($LASTEXITCODE -ne 0) { throw 'Migration failed; do not deploy' }
```

4. 외부 Firebase 키와 .env 설정 후 해당 서비스만 갱신한다. 아래 명령은 DB/Redis/Nginx/Vercel을 재생성하지 않는다.

```powershell
docker compose -f docker-compose.yml -f docker-compose.push.yml build backend-api backend-worker notification-worker
docker compose -f docker-compose.yml -f docker-compose.push.yml up -d --no-deps backend-api backend-worker notification-worker
docker compose start training-worker
# 기존 executor 운영 시에만: docker compose --profile auto-training start training-executor
docker compose -f docker-compose.yml -f docker-compose.push.yml ps
docker compose -f docker-compose.yml -f docker-compose.push.yml logs --tail 100 notification-worker
```

기존 training-worker는 Firebase 모듈을 import하지 않아 기존 이미지로 학습 동작을 유지한다. 수동 GitHub Actions는 기존 주요 서비스만 갱신한다. 새 알림 Worker와 migration은 위 명령으로 관리한다.

5. 실기기 smoke test: 권한 허용 → 등록 → 조건 충족 분석 → 전송 row 확인 → background/종료 클릭 → 미로그인 복귀 → 피드백 저장/중복 409 → 사용자별 학습 후보 확인. 타인 계정의 결과 조회는 404여야 한다.

토큰 자체를 조회하지 않는 상태 확인 SQL:

```sql
SELECT status, COUNT(*) FROM notification_events GROUP BY status;
SELECT status, error_code, COUNT(*) FROM push_deliveries GROUP BY status, error_code;
SELECT training_status, user_id, COUNT(*) FROM inference_feedback GROUP BY training_status, user_id;
```

## 중단·복구

알림 중단은 먼저 notification-worker를 stop하고 PUSH_ENABLED=false로 바꾼 뒤 API/분석/알림 서비스를 같은 overlay로 재생성한다. 코드 복귀 시 이전 검토 커밋으로 돌아가 필요한 서비스만 rebuild한다. 새 테이블은 남겨 기존 피드백·가중치·발송 이력을 보존한다. destructive down migration은 제공하지 않는다. 구버전 API와 새 APK의 배포 순서를 조정한다.

## Android APK 재빌드

Capacitor 8은 Java 21을 사용한다. 이 PC의 기본 Java 8은 실패했고 Android Studio의 Java 25도 Gradle 8.14.3과 호환되지 않았다. 설치된 JDK 21을 프로세스 환경 변수로 선택한다.

```powershell
Set-Location C:\dev\baby-monitor-push\babyeye-web
$env:JAVA_HOME="$env:USERPROFILE\.jdks\jbr-21.0.11"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
# google-services.json을 android/app에 로컬 배치
$env:VITE_API_BASE_URL='https://<실제_API_도메인>'
npm.cmd ci
npm.cmd test
npm.cmd run build
npx.cmd cap sync android
.\android\gradlew.bat -p android assembleDebug
```

출력: android\app\build\outputs\apk\debug\app-debug.apk. 다른 PC는 설치된 JDK 21 경로를 지정한다. adb install -r로 시험하거나 Android Studio에서 설치한다. 운영 배포는 기존 서명키로 Signed APK/Bundle을 만들고 versionCode를 증가시킨다. 서명키도 저장소 밖에 둔다.

로컬 APK 빌드만으로 FCM 수신을 검증할 수 없다. 실제 Firebase 설정과 공개 HTTPS API 주소가 들어간 APK로 권한 거절/허용, foreground/background/종료 클릭, JWT 만료, 로그아웃/계정 전환, 오류 재시도를 확인한다. Android force stop 상태는 재실행 전 수신이 제한될 수 있다.

## 변경 파일 목록·이유

| 파일 | 이유 |
|---|---|
| backend/app/models.py | 기기·이벤트·전송 모델과 유일 제약 |
| backend/app/config.py | push 설정·범위 검증, 잘못된 CORS tuple 기본값 수정 |
| backend/app/main.py | push 라우터 등록 |
| backend/app/routers/push.py | JWT 기반 등록/해제/소유자별 결과 |
| backend/app/services/notification_service.py | 조건·cooldown·transactional outbox |
| backend/app/services/firebase_service.py | Admin SDK·최소 payload·TTL/tag |
| backend/app/workers/analysis_worker.py | 분석 결과와 outbox 함께 commit |
| backend/app/workers/notification_worker.py | 독립 전송·잠금·TTL·기기별 재시도 |
| backend/migrations/001_push.sql | additive 테이블·인덱스 |
| backend/requirements.txt | Firebase Admin SDK |
| backend/requirements.test.txt | 테스트 의존성 |
| backend/tests/conftest.py | 독립 DB·JWT·API fixture |
| backend/tests/test_push.py | 인증·소유권·피드백·학습 후보·재시도 검증 |
| backend/tests/test_postgres.py | 실제 PostgreSQL migration·upsert·outbox·동시성 검증 |
| babyeye-web/package.json, package-lock.json | Capacitor core/push 및 테스트 의존성 |
| babyeye-web/src/App.jsx | push 수명주기 연결 |
| babyeye-web/src/components/common/PushCenter.jsx | 권한·등록·수신·클릭·해제 UI |
| babyeye-web/src/services/pushService.js | 설치 ID·등록/해제 순서 제어 |
| babyeye-web/src/utils/pushRoute.js | 알림 ID와 로그인 복귀 경로 검증 |
| babyeye-web/src/routes/AppRouter.jsx | 결과 보호 경로·복귀 state |
| babyeye-web/src/pages/LoginPage.jsx | 로그인 후 원래 결과 복귀 |
| babyeye-web/src/pages/NotificationResultPage.jsx | 소유자별 결과와 피드백 표시 |
| babyeye-web/src/pages/FeedbackPage.jsx | 기존 FeedbackCard export·재사용 |
| babyeye-web/src/pages/SettingsPage.jsx | 로그아웃 해제 실패 오류 표시 |
| babyeye-web/src/contexts/AuthContext.jsx | 기기 해제 후 로그아웃·세션 만료 |
| babyeye-web/src/api/client.js, feedbackApi.js | 401 세션 만료 이벤트 |
| babyeye-web/src/components/common/PushCenter.test.jsx | 권한·토큰·수신·클릭·해제 테스트 |
| babyeye-web/src/pages/LoginPage.test.jsx | 인증 후 복귀 테스트 |
| babyeye-web/src/utils/pushRoute.test.js | 목적지·외부 리다이렉트 차단 테스트 |
| babyeye-web/vitest.config.js | DOM 테스트 환경 |
| babyeye-web/android/app/src/main/AndroidManifest.xml | 알림 권한 |
| babyeye-web/android/app/capacitor.build.gradle | cap sync가 생성한 플러그인 의존성 |
| babyeye-web/android/capacitor.settings.gradle | cap sync가 생성한 플러그인 모듈 |
| docker-compose.push.yml | 선택적 Worker·외부 키 read-only mount |
| .env.example | 비밀값 없는 설정 예시 |
| .gitignore | 키·로컬 설정·빌드/테스트 산출물 제외 |
| .github/workflows/deploy-backend.yml | 자동 배포 제거·수동 개별 서비스 갱신 |
| docs/PUSH_FEEDBACK.md | 구조 분석·Firebase·적용·복구·APK 안내 |
| docs/TEST_RESULTS.md | 실행 검증과 미검증 범위 |
| docs/AUDIT_SUMMARY.json | npm 의존성 감사의 잔여 항목 |
