# 알림 켜기/끄기 · 동일 상태 3회 · 알림 확인

이 문서가 최신 알림 동작 기준이다. 이전 PUSH_FEEDBACK.md의 단일 분석 confidence/cooldown 조건과 알림 상세의 피드백 연결은 이번 변경으로 대체했다.

## 사용자 화면

- 하단 **알림** 탭, 각 화면의 종 아이콘, 설정의 **알림 설정**에서 같은 알림 화면으로 이동한다.
- **상태 알림** 스위치로 로그인한 계정의 모든 기기 알림을 활성화/비활성화한다. 기본값은 꺼짐이다.
- 웹에서도 스위치와 목록/확인을 사용할 수 있다. FCM 푸시는 Android에서 제공한다.
- Android에서는 활성화할 때 권한을 요청한다. 권한 거절 시 활성화하지 않고 이유를 표시한다.
- 계정 설정 저장 성공과 실제 FCM 연결 상태를 구분한다. 푸시 연결 오류에는 재연결 버튼을 제공한다.
- 목록에서 미확인/확인 완료 상태를 표시한다. 알림을 열고 **확인 완료**를 누르면 서버에 확인 시각을 저장하고 목록으로 돌아간다.
- 알림 상세에서 피드백을 입력하지 않는다. 기존 별도 피드백 화면/API/학습 파이프라인은 유지한다.
- 새 서버가 적용되지 않았으면 설정/목록에 서버 적용 필요 메시지가 표시된다. 성공한 것처럼 표시하지 않는다.

## 감지 규칙

같은 사용자·같은 카메라에서 완료된 분석 순서로 동일한 non-stable 상태가 세 번 연속 나오면 한 번 알린다. confidence 임계치와 300초 cooldown은 더 이상 사용하지 않는다.

예시:

| 분석 순서 | 알림 |
|---|---|
| feeding, feeding | 없음 |
| feeding, feeding, feeding | 세 번째에 1건 |
| feeding 6회 연속 | 세 번째에만 1건, 같은 상태 지속 중 추가 발송 없음 |
| feeding, feeding, stable, feeding | 없음, stable에서 연속 횟수 초기화 |
| feeding 3회, care 3회 | 각 상태의 세 번째에 1건씩 |
| stable 10회 | 없음 |

카메라가 다른 분석을 합쳐 세지 않는다. 카메라 없는 업로드는 사용자별 별도 그룹이다. stable/normal/안정/안정 상태는 안정으로 정규화한다. 알림을 다시 켜면 새 분석부터 세 번을 센다. 동일 request_id가 재처리되어도 횟수를 더하지 않는다.

관측 기록과 outbox를 분석 트랜잭션에 함께 저장하며 PostgreSQL advisory lock으로 사용자별 동시 처리를 직렬화한다. 알림을 끄면 대기 중 전송도 Worker에서 취소한다. 다시 켜도 이전 활성화 시점 이전의 전송은 보내지 않는다. 이미 FCM에 전달된 푸시는 서버에서 회수할 수 없다.

PUSH_ENABLED는 이제 **서버의 FCM 발송 master switch**이다. 앱 내 알림 생성/목록은 사용자 설정으로 제어한다. 실제 푸시에는 PUSH_ENABLED=true와 Android 토큰 등록이 모두 필요하다.

## API/DB 변경

- GET/POST /api/push/preferences: 현재 사용자의 enabled 설정. POST 본문은 {"enabled": true 또는 false}.
- GET /api/push/events?limit=20&offset=0: 현재 사용자 목록과 unreadCount.
- POST /api/push/events/{id}/read: 소유자만 확인 완료, 반복 호출 가능.
- 기존 GET /api/push/events/{id}에 createdAt/readAt 추가. 이전 feedback 필드는 호환을 위해 유지한다.
- NotificationPreference와 NotificationObservation 신규 테이블, notification_events.read_at nullable 컬럼 추가.
- 기존 PostgreSQL 데이터·피드백·가중치는 삭제하지 않는다.

## 배포 PC의 추가 적용

기존 001_push.sql까지 적용된 서버에서도 **002_notification_inbox.sql을 추가 적용해야 한다**. 소스 bind mount 및 reload가 있으므로 코드 전환 전에 관련 서비스부터 안전하게 정지한다. 아래 명령은 운영자가 직접 수행하며 자동 배포하지 않는다.

1. 기존 안내대로 현재 커밋·서비스/이미지 상태를 기록하고 DB와 weights/training-data/uploads를 저장소 밖에 백업·검증한다. 진행 중 학습은 강제 종료하지 않는다. DB/Redis는 유지한다.
2. 아래 순서로 새 feature 커밋을 적용한다. 기존 로컬 변경이 있으면 덮어쓰지 않는다.

```powershell
Set-Location C:\deploy\baby-monitor
git status --short
git fetch origin codex/push-feedback-ux
docker compose -f docker-compose.yml -f docker-compose.push.yml stop backend-api backend-worker notification-worker
# 아래 자리표시자를 이번에 검토한 실제 커밋 SHA로 교체
git switch --detach <새_커밋_SHA>
docker cp .\backend\migrations\002_notification_inbox.sql baby-monitor-db:/tmp/002_notification_inbox.sql
docker compose exec -T db psql -U baby_user -d baby_monitor -v ON_ERROR_STOP=1 -f /tmp/002_notification_inbox.sql
if ($LASTEXITCODE -ne 0) { throw 'Migration failed; do not deploy' }
docker compose -f docker-compose.yml -f docker-compose.push.yml build backend-api backend-worker notification-worker
docker compose -f docker-compose.yml -f docker-compose.push.yml up -d --no-deps backend-api backend-worker notification-worker
docker compose -f docker-compose.yml -f docker-compose.push.yml ps
```

初기 설치라면 001과 002를 순서대로 적용한다. 기존 .env/Firebase 외부 키/볼륨 이름은 유지한다. PUSH_ENABLED=true, PUSH_TTL_SECONDS=3600, PUSH_MAX_ATTEMPTS=5를 사용한다. 기존 PUSH_MIN_CONFIDENCE/PUSH_COOLDOWN_SECONDS는 있어도 무시된다. down -v, volume prune, 기존 데이터 삭제는 금지한다.

배포 후 기존 계정으로 로그인 → 알림 탭 → 스위치 켜기 → 푸시 연결 완료를 확인한다. 실제 분석을 같은 카메라에서 세 번 수행하고 목록/푸시/확인 완료를 검증한다. 운영 DB에 테스트 분석/알림을 임의 삽입하지 않는다.

## Android Studio에서 테스트

프로젝트 경로는 **C:\dev\baby-monitor-push\babyeye-web\android**이다. 원래 C:\dev\baby-monitor의 Android 프로젝트를 열면 이전 UI가 실행될 수 있다.

```powershell
Set-Location C:\dev\baby-monitor-push\babyeye-web
npm.cmd test
npm.cmd run build -- --mode android
npx.cmd cap sync android
$env:JAVA_HOME="$env:USERPROFILE\.jdks\jbr-21.0.11"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\android\gradlew.bat -p android assembleDebug
```

Firebase 설정과 .env.android는 로컬 파일로만 유지한다. versionCode=2, versionName=1.1이다. 새 APK에도 서버 002 적용이 필요하다. 로그인 후 하단 알림 탭이 보이면 새 UI이다.
