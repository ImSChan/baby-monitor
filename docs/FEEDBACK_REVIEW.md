# 피드백 돌아보기 및 구간 일괄 응답

## 사용자 흐름

알림 → 지난 12시간 돌아보기에서 안정 상태를 제외하고 동일 상태가 3회 연속 감지되어 실제 알림 이벤트가 생긴 상황을 모아 본다. 현재 알림 정책처럼 같은 상태가 이어지는 동안 반복 알림을 만들지 않는다. 이전 12시간으로 이동할 수 있으며 한 화면은 최근 100건까지 표시한다. 개별 알림 상세에도 같은 피드백 UI가 있다.

- 당시 상태를 선택하면 한 번의 터치로 저장한다. 미리 선택하거나 자동 제출하지 않는다.
- 배고픔 / 졸림 / 돌봄 필요 / 편안함 / 잘 모르겠어요를 제공한다.
- 알림 확인과 학습용 피드백은 별개다. 무응답이나 알림 닫기를 정답으로 만들지 않는다.
- 알림 시점 중심으로 같은 사용자·카메라의 앞 10개 / 뒤 10개 분석을 시간순으로 보여준다. 기록이 부족하면 실제 있는 만큼만 보여준다.
- 가로 스크롤과 슬라이더로 시점을 고르고 당시 대표 이미지/오디오를 확인한다. 원본 영상 파일은 기존 구조에 저장되지 않으므로 대표 프레임과 녹음 자료를 재사용한다. 오디오는 자동 재생하지 않는다.
- 기본 저장 범위는 선택한 분석 1개다. 구간 선택 → 여기부터 / 여기까지 → 실제 상태 → 선택한 N개에 적용으로 일괄 저장한다.
- 기존 응답을 덮어쓰는 개수와 선택 구간을 보여준다. 학습 중·반영 완료이거나 원본 완료 메타데이터가 없는 분석이 하나라도 포함되면 전부 저장하지 않는다.
- 저장 후 실행 취소가 가능하다. 그 사이 수정/학습 예약이 일어나면 취소를 거부하며 일부만 되돌리지 않는다. 기존 pending/excluded 피드백 수정 규칙을 유지한다.

## 정기 알림

돌아보기 화면 아래 ‘정기 돌아보기 알림 설정’을 열어 켠다. 기본값은 **꺼짐**, 첫 시간은 **10:00 / 두 번째는 22:00**, 시간대는 Asia/Seoul이다. 첫 시간을 바꾸면 두 번째 시간은 12시간 뒤의 현지 시각으로 정해진다. IANA 시간대와 ‘현재 기기 시간대 사용’을 지원한다. 서버 OS 시각/시간대에 의존하지 않는다.

기존 notification-worker 안에서 30초마다 스케줄을 확인하며 별도 Windows 작업 스케줄러는 필요 없다. 사용자 상태 알림 설정도 켜져 있어야 한다. 실제 기기 푸시는 PUSH_ENABLED 및 기존 Firebase 키/기기 등록/OS 권한도 필요하다. 웹에서는 목록과 피드백을 쓸 수 있지만 웹 브라우저 FCM 구독은 이번 범위에 추가하지 않았다.

- 각 예약 시각 직전 12시간을 [시작, 종료) 범위로 조회한다. API는 시간대가 있는 ISO 문자열을 사용하고 기존 DB의 naive KST 저장 규칙은 유지한다.
- 해당 시간의 상태 알림이 없거나 모두 응답했다면 정기 알림을 보내지 않는다. 돌아보기 화면에서는 이미 응답한 사건도 확인·수정할 수 있다.
- 설정 활성화 이전 예약은 보내지 않는다. Worker가 멈췄다가 돌아오면 최근 1시간 안의 마지막 예약만 복구하고 오래된 알림을 몰아서 보내지 않는다.
- 사용자+예약 시각 기반 고정 UUID와 PostgreSQL 사용자 advisory lock으로 여러 Worker가 같은 예약을 중복 생성하지 않는다.
- 기존 NotificationEvent/PushDelivery의 재시도·만료·토큰 해제·계정 재할당·Android tag를 재사용한다. 설정을 끄거나 시간을 변경하면 이전 예약의 대기 발송은 취소된다.
- FCM 자체는 exactly-once가 아니다. 전송 성공 직후 DB commit 전에 장애가 나면 재전송할 수 있으며 기존 Android tag로 같은 이벤트의 표시를 합친다.
- 일광절약시간 변경일에는 현지의 두 시각 사이가 11/13시간일 수 있으나 각 돌아보기의 조회 길이는 실제 경과 12시간이다. 이미 응답한 같은 사건을 중복 학습하지 않는다.

## API와 데이터

| 경로 | 기능 |
|---|---|
| GET /api/reviews?end=시간대포함ISO&offset=0&limit=20 | 직전 12시간의 상태 알림과 앵커 피드백 |
| GET /api/reviews/events/{id}/context | 소유한 사건의 같은 카메라 앞뒤 최대 10개 |
| GET /api/reviews/schedule | 사용자별 일정 |
| POST /api/reviews/schedule | enabled / first_time / timezone 저장 |
| POST /api/reviews/feedback | 연속 구간 원자적 저장, action UUID와 expected_versions 필수 |
| POST /api/reviews/feedback/{action_id}/undo | 저장 단위 원자적 실행 취소 |

모든 API는 기존 JWT와 활성 사용자 검증을 사용한다. 구간 ID를 직접 조작해도 타인/다른 카메라/표시 범위 밖/불연속 구간은 저장할 수 없다. 원본 완료 메타데이터 소유권을 다시 검사한다. 기존 /api/feedback의 중복 제출 409와 reserved/학습 완료 데이터 변경 금지도 유지한다.

004 migration은 review_analyses(영구 탐색 색인), review_schedules, review_actions(저장 전 버전과 취소 기록), inference_feedback.learning_group을 추가한다. 기존 테이블·데이터를 삭제하거나 이름을 바꾸지 않는다. API 시작의 create_all만으로 기존 컬럼이 추가되지는 않으므로 **운영에서는 SQL migration이 먼저 필요**하다.

분석 Worker의 기존 enqueue_notification 경로에서 같은 트랜잭션으로 모든 상태를 색인한다. 알림을 꺼도 앞뒤 맥락용 색인은 생기며 이것만으로 학습에 동의한 것으로 취급하지 않는다. 이전 기록은 명시적인 backfill 명령을 사용한다. backfill은 기존 완료 메타데이터/EmotionEvent를 연결할 뿐 새 알림·피드백·학습 Job을 생성하지 않는다.

## 개인화 데이터 품질

- 명시적인 실제 상태 선택만 pending, ‘잘 모르겠어요’는 excluded이다.
- 같은 사용자·카메라에서 같은 AI 상태가 이어지고 인접 분석 간격이 15분 이내인 구간에 episode_key를 부여한다. 상태가 바뀌거나 간격이 길면 별도 사건 그룹이다. 이는 연속 장면 중복을 줄이는 보수적인 규칙이며 실제 아기 상태의 경계를 완벽히 추정하는 것은 아니다.
- 일괄 응답은 각각의 분석에 저장하되 learning_group으로 원래 사건을 보존한다. 개별 기존 피드백 API로 제출해도 색인이 있으면 같은 그룹을 붙인다.
- 새 Job은 같은 사건·정답 라벨 조합에서 유효한 샘플 하나만 선택한다. 서로 다른 AI 상태 사건을 한 번에 같은 실제 상태로 일괄 응답한 경우도 연결된 하나의 관찰 그룹으로 센다. 이미 어떤 Job에 연결된 조합은 이후 스캔에서도 다시 세지 않는다. 나머지 피드백은 pending으로 남을 수 있다. 선택된 샘플은 기존 media 검증·모달리티별 최소 클래스 수·예약/실행 검사를 그대로 거친다.
- 관찰 그룹의 대표 샘플이 Job에 연결된 뒤에는 해당 그룹을 새 구간 응답으로 합치거나 변경하지 않는다. 일부 주변 피드백이 pending이어도 서버가 거부할 수 있으며, 이미 예약된 Job의 독립 표본 수를 뒤늦게 바꾸지 않기 위한 보호다.
- executor도 한 Job 내 중복 사건을 거부한다. 이전 그룹 없는 legacy 데이터/기존 Job은 재라벨링하거나 예약을 바꾸지 않는다.
- synthetic/mock 메타데이터는 기존 provenance 검증으로 학습에서 제외한다. 기존 자동 모델 승격 정책을 변경하지 않았다.

## 배포 PC 적용

기본 경로는 C:\deploy\baby-monitor. 운영 반영은 이 문서를 검토한 뒤 수동으로 수행한다. main push가 backend를 자동 재배포하지 않는다.

1. 현재 커밋/이미지/Compose 파일·프로젝트/환경과 서비스 실행 여부를 기록하고 DB dump를 보존한다. 볼륨·업로드·가중치·Firebase 키를 유지한다. 001~003 적용 여부도 확인한다.
2. API 신규 요청을 멈춘 뒤 기존 분석 큐/처리 중 요청을 비운다. 학습 executor는 실행 중 Job이 끝날 때까지 기다린다. running/reserved를 수동으로 초기화하거나 GPU 프로세스를 강제 종료하지 않는다.
3. 코드 bind mount에 영향을 받는 API/분석/학습 생성기 및 알림 Worker를 안전한 시점에 정지한다. executor는 원래 실행 중이었으면 idle에서 정지하고, 원래 꺼져 있었다면 켜지 않는다.
4. 검토한 정확한 커밋으로 이동한 후 **004_feedback_review.sql을 ON_ERROR_STOP=1로 먼저 적용**한다. lock_timeout=10s이므로 잠금 충돌 시 transaction 전체 실패를 확인하고 원인을 해결해 재시도한다. 실패 후 앱을 먼저 시작하지 않는다.
5. API 서비스의 일회성 컨테이너로 backfill을 먼저 dry-run하고 수량을 검토한 다음 --apply로 실행한다. 이때 분석 ingestion은 멈춰 둔다. 순서는 다음과 같다.

```powershell
# 기존 운영의 -f / --project-name / --env-file 옵션은 동일하게 유지
docker compose run --rm --no-deps backend-api python -m app.services.review_backfill
docker compose run --rm --no-deps backend-api python -m app.services.review_backfill --apply
```

6. 변경된 API/분석/notification-worker/training-worker 이미지와, 기존 활성화되어 있던 executor 이미지를 빌드해 갱신한다. notification-worker는 docker-compose.push.yml overlay가 필요하다. DB/Redis/Nginx는 재생성하지 않는다. 학습 executor의 기존 profile/켜짐 여부를 보존하고 새 자동 학습이나 승격을 켜지 않는다.
7. health, 인증된 reviews/schedule/context, 계정 분리, 새 분석 색인, 피드백/수정/취소 및 Worker 로그를 확인한다. 실제 사용자 계정으로 앱의 상태 알림과 정기 알림을 켜고 OS 권한/기기 등록을 확인한다.

DB dump는 PowerShell의 바이너리 파이프로 받지 말고 컨테이너 안 파일로 생성 후 docker cp로 보관한다. SQL 파일도 docker cp 후 psql -f로 적용하면 인코딩/파이프 문제를 줄일 수 있다. 구체적인 배포 PC 프롬프트에는 적용 커밋과 명령을 별도로 제공한다.

되돌릴 때 004 테이블/컬럼을 삭제하지 않는다. 이전 이미지·코드로 필요한 서비스만 복구하되, 새 피드백이 존재하는 동안 이전 학습 생성기를 그대로 켜면 사건 중복 제한이 적용되지 않으므로 생성기는 중지하고 수정 버전으로 복구한다. 스트리밍 무인증 결함이 있던 4ab2949 이전 코드로 되돌리지 않는다.

## 개발 및 mock 알림 테스트

운영 키나 실제 토큰 없이 아래 테스트를 실행한다.

```powershell
Set-Location C:\dev\graduate\app
$env:PYTHONPATH='backend'
python -m pytest backend/tests -q
Set-Location babyeye-web
npm.cmd ci
npm.cmd test
npm.cmd run build -- --mode android
npx.cmd cap sync android
$env:JAVA_HOME="$env:USERPROFILE\.jdks\jbr-21.0.11"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\android\gradlew.bat -p android assembleDebug
```

로컬 실화면 테스트는 터미널별로 실행한다. review_demo.py는 127.0.0.1에만 열리며 DB/JWT 설정을 강제로 임시 값으로 바꾼다. 운영 Docker나 실제 사용자 데이터로 실행하지 않는다. 종료 시 임시 DB/오디오를 정리한다.

```powershell
# 터미널 1: backend requirements가 설치된 Python
python backend/tools/review_demo.py --port 8791
# 터미널 2
Set-Location babyeye-web
$env:VITE_API_BASE_URL='http://127.0.0.1:8791'
npm.cmd run dev -- --host 127.0.0.1 --port 5179 --strictPort
# 터미널 3: 저장소 root. Playwright는 제품 의존성과 별도로 설치
npm.cmd install --prefix work/review-browser --no-save playwright
node babyeye-web/tests/review-browser.mjs
```

브라우저 테스트는 설치된 Microsoft Edge를 사용한다. **새 mock 서버에서 한 번 실행**하는 시나리오이므로 반복할 때 서버를 재시작한다. 21개 mock 분석 → 3회 연속 상태 알림 2개 → 실제 Worker/FCM 메시지 생성 → mock native 수신 배너·클릭 → 단건 피드백·취소 → 구간 5개 저장 → 정기 알림 1개 → 해당 시간 돌아보기 → 알림 끄기를 검증한다. 결과 JSON/화면 캡처는 ignored work/review-browser/results에 저장한다.

여기서 FCM 네트워크와 Capacitor native bridge는 모의 처리한다. 실제 단말에 OS 알림·소리가 울렸다는 검증은 아니다. 실기기 FCM은 배포 PC의 기존 Firebase 설정과 사용자 소유의 등록 기기로 별도 확인한다. mock seed/발송 엔드포인트는 tools/review_demo.py에만 있으며 운영 app.main에는 포함되지 않는다.

Android 버전은 1.3 / versionCode 4이다. 빌드 결과는 babyeye-web/android/app/build/outputs/apk/debug/app-debug.apk. 기존 서명이 다르면 앱을 삭제하지 말고 기존 서명키로 재빌드한다. Vercel을 실제로 로드하는 wrapper는 main 웹 배포를 확인하고, 로컬 assets를 포함하는 APK는 새 APK를 설치한다.
