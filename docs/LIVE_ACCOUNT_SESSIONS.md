# 스트리밍 계정 격리 및 세션 종료 수정

## 진단 결과

다음은 운영 로그에서 개인정보 침해를 확인했다는 뜻이 아니라, 기존 main의 실제 코드에서 확인한 결함이다.

| 위치 | 확인한 문제 | 수정 |
|---|---|---|
| live.py 목록/상세 | JWT는 받지만 current_user_id로 필터링하지 않음 | 목록·상세·종료 모두 사용자 소유권 검증 |
| WebSocket | 인증 없이 접속, 없는 세션도 자동 생성 | 첫 프레임 JWT 인증, 기존 세션/소유자/역할 검증, 자동 생성 금지 |
| 세션 생성 | camera_id가 다른 계정 것인지 검사하지 않음 | 현재 사용자의 카메라만 허용 |
| 역할 슬롯 | 같은 역할 접속 시 이전 소켓을 덮어씀 | 중복 역할 4409 거부, 실제 소켓 identity로 정리 |
| 종료 | 호스트가 나가도 viewer와 room이 남고 종료 API/기한 없음 | 소유자 DELETE, 호스트 종료 시 양쪽 종료, 유휴/대기 기한 및 수량 제한 |
| HomePage/LivePage | 시청 구현 중복, 일부 오류에서 peer만 남거나 연결 표시 유지 | 공통 controller/hook, 오류·이탈·계정 변경 때 통합 정리 |
| 연결 협상 | viewer-connected와 viewer-ready가 offer를 중복 생성, ICE가 SDP보다 먼저 적용될 수 있음 | 접속당 협상 ID, offer 중복 차단, ICE 대기열 및 메시지 순차 처리 |
| CameraHostPage | 소켓 종료 때 촬영 track 정리 부족, 시작/종료 비동기 경쟁 | 늦은 권한/세션 응답 취소, track/peer/socket/timer 정리 |
| 실시간 분석 | 중지 후 녹음·업로드·poll 결과가 살아남음 | AbortSignal 및 실행 세대 검사, AudioContext 정리 |
| 로그인/로그아웃 | 늦게 끝난 복원/로그아웃이 새 로그인 상태에 영향을 줄 수 있음 | 인증 세대·원래 토큰 검사, 먼저 live 리소스 정리 |
| Android Manifest | CAMERA/RECORD_AUDIO/MODIFY_AUDIO_SETTINGS 누락 | Capacitor WebView가 요구하는 권한 선언, 사용자 권한 요청 유지 |
| API Compose | --reload로 소스 변경 시 메모리 세션 초기화, worker 분산 가능 | 자동 reload 제거, --workers 1 명시 |

원격 영상 연결은 ICE 협상도 필요하다. [MDN의 addIceCandidate 문서](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate)는 remoteDescription이 없는 상태에서 호출하면 InvalidStateError가 발생함을 설명한다. 따라서 인증만 추가하는 대신 협상 순서도 수정했다.

## 계정과 연결 정책

- 같은 AppUser ID로 로그인한 기기끼리만 접속할 수 있다. 같은 계정의 서로 다른 JWT도 허용한다.
- 목록은 내 계정의 실제 host가 연결된 세션만 표시한다. 미접속 pending room은 목록에 표시하지 않는다.
- 다른 계정은 UUID를 알아도 상세/종료/소켓 연결을 할 수 없다. 존재하지 않는 room과 타인 room은 같은 404/4404로 처리한다.
- 기존 구조처럼 세션 하나에 host 1개와 viewer 1개이다. 다중 시청자는 이번 범위에 포함하지 않았다. 다른 viewer가 이미 연결되어 있으면 명확한 오류를 표시하며 기존 연결을 밀어내지 않는다.
- 영상·음성은 기존 WebRTC P2P로 전달한다. signaling 서버가 미디어를 저장하지 않는다.
- REST와 WebSocket은 같은 JWT/활성 사용자 검증을 공유한다. 소켓 인증 후 DB transaction을 바로 닫아 연결 내내 DB pool을 점유하지 않는다. 이후 약 30초마다 활성 상태를 재확인하며 JWT 만료도 강제한다.
- 기본 JWT 만료 시간은 기존처럼 1시간이다. 만료 시 로컬 미디어를 종료하고 재로그인을 요구한다. 자동 토큰 갱신은 추가하지 않았다.

## 프로토콜 v2 및 배포 호환

1. 인증된 GET /api/live/config가 protocolVersion=2와 iceServers를 반환한다.
2. 클라이언트는 연결 직전에 이 응답을 확인한다. 구버전 서버이면 socket을 만들거나 JWT를 보내지 않고 업데이트 필요 오류를 표시한다.
3. WebSocket URL은 기존 /api/live/ws/{session_id}/{host|viewer}이다. JWT를 query string에 넣지 않는다.
4. onopen의 첫 프레임은 {type:"authenticate", token:JWT}이다. 서버는 이 프레임을 소비하고 절대 relay하지 않는다.
5. 인증 완료 후 authenticated 응답을 받고 signaling을 시작한다. 허용된 offer/answer/candidate 필드만 전달하며 from/sessionId는 서버가 지정한다.
6. viewer가 접속할 때마다 새 negotiationId를 부여한다. 이전 연결의 SDP/ICE/종료 이벤트는 새 peer에 적용하지 않는다.

이 프로토콜 확인은 중요하다. 기존 서버가 첫 JWT 프레임을 일반 메시지로 다른 peer에게 전달하지 못하도록 새 클라이언트가 구버전 서버 접속을 거부한다. 서버 rollback 시에도 접속마다 버전을 다시 확인한다. 기존 구버전 클라이언트의 무인증 프로토콜은 새 서버에서 거부되므로 웹 새로고침/새 APK가 필요하다.

| 종료 코드 | 의미 |
|---|---|
| 4401 | 인증 누락·잘못된/만료된 JWT·비활성 계정 |
| 4404 | 없는 세션·타인 세션·host 미연결 |
| 4409 | host/viewer 역할이 이미 연결됨 |
| 4400 / 1009 | 허용되지 않은 signaling / 크기 제한 초과 |
| 1008 | 잘못된 역할 또는 허용하지 않은 Origin |
| 1012 | 서버 재시작 |

## 종료·재접속

- host 중지/이탈/로그아웃/소켓 오류: 카메라·마이크 track, peer, socket, heartbeat, 분석 interval, 녹음 AudioContext, 분석 fetch/poll을 정리한다. 원래 토큰으로 keepalive DELETE를 시도한다.
- 미디어 권한이나 세션 생성 응답이 종료 후 도착하면, 늦은 track을 즉시 stop하거나 늦게 생성된 room을 종료한다. 시작 중 중복 클릭도 막는다.
- host가 종료되면 room을 제거하고 viewer에게 종료를 통지한 후 socket을 닫는다.
- viewer만 종료되면 해당 peer만 정리하고 host는 촬영/분석을 유지하며 새 viewer를 기다린다.
- 클라이언트는 10초 간격 ping을 보낸다. 응답이 약 30초 이상 없으면 다음 확인 시 종료한다. 서버는 기본 45초 유휴 기한을 약 10초 주기로 확인한다.
- host가 연결되지 않은 room은 기본 60초 후 다음 정리 시 제거한다. 생성/목록/조회 및 socket timeout에서 정리하며 사용자당 기본 8개·전체 1024개로 제한한다.
- pagehide와 React unmount도 정리 경로에 포함한다. Android 백그라운드 상시 촬영용 foreground service를 구현한 것은 아니다. OS 절전/백그라운드 제한으로 연결이 종료되면 다시 시작해야 할 수 있다.
- 서버 종료 시 모든 메모리 room을 명시적으로 닫는다. 서버 재시작 후 이전 UUID를 자동 부활시키지 않으며 host를 다시 시작한다.

## 네트워크·운영 설정

```dotenv
LIVE_PENDING_TIMEOUT_SECONDS=60
LIVE_IDLE_TIMEOUT_SECONDS=45
LIVE_AUTH_TIMEOUT_SECONDS=8
LIVE_MAX_SESSIONS_PER_USER=8
LIVE_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"}]'
```

기본값은 기존 STUN이다. 서로 다른 네트워크에서 STUN으로 연결되지 않으면 운영자가 준비한 TURN 항목을 LIVE_ICE_SERVERS JSON에 추가한다. urls/username/credential은 실제 서비스 설정을 사용하며 가짜 주소를 넣지 않는다. 이 설정은 인증된 사용자에게 WebRTC 연결용으로 제공되므로 TURN 사용 정책도 운영자가 관리한다. 비밀값을 GitHub나 로그에 올리지 않는다. 실제 TURN 서비스는 이번 개발 PC 작업에서 구축하지 않았다.

CORS_ORIGINS에는 실제 Vercel/웹 도메인과 Android WebView의 https://localhost 등 사용할 Origin을 명시한다. WebSocket은 CORS middleware만으로 제한되지 않으므로 별도로 Origin을 확인한다. HTTPS/WSS와 기존 Nginx Upgrade 설정을 유지한다.

기존 in-memory signaling 구조를 유지하므로 **API는 단일 process/worker**여야 한다. Compose에 --workers 1을 명시하고 운영용 --reload를 제거했다. 여러 API replica로 확장하려면 별도 공유 signaling broker가 필요하다. 현재 변경이 수평 확장을 구현한 것은 아니다.

## DB·데이터와 배포 순서

스트리밍 수정 자체에는 **새 DB migration이 없다**. PostgreSQL 데이터, 피드백, 학습 Job, 가중치, FCM 키를 변경하지 않는다. 다만 이 커밋은 이전 학습 리팩터링 main을 포함하므로 이전 003 migration 적용 여부는 배포 PC에서 확인해야 한다. 미적용이면 기존 TRAINING_ELIGIBILITY.md의 백업/안전 전환 절차를 먼저 따른다. running 학습을 강제 종료하거나 예약을 초기화하지 않는다.

개발 PC에서 main push를 완료한 후 운영 PC에서는 별도 프롬프트의 정확한 커밋을 적용한다. 기존 API가 --reload로 동작 중이면 **checkout 전에 먼저 안전하게 정지**한다. API 재시작은 현재 live 연결을 종료하므로 유지보수 후 각 host를 다시 시작한다.

```powershell
Set-Location C:\deploy\baby-monitor
git status --short
git fetch origin main
# 현재 코드/이미지/환경 백업 및 이전 migration 확인 후 유지보수 시점에:
docker compose stop backend-api
# <검토한_커밋_SHA>를 제공한 실제 커밋으로 교체
git switch --detach <검토한_커밋_SHA>
docker compose build backend-api
docker compose up -d --no-deps backend-api
docker compose logs --tail 100 backend-api
```

기존 compose 프로젝트 이름, .env, Nginx, DB/Redis 볼륨과 학습/분석/알림 서비스는 유지한다. 스트리밍 변경만 적용할 때에는 관련 없는 GPU 작업을 재시작하지 않는다. 자동 backend 배포는 기존처럼 수동 workflow 전용이다.

검증은 먼저 테스트 계정/격리 환경에서 수행한다. 운영 사용자의 JWT를 임의로 만들거나 타인의 실제 영상을 열지 않는다. API /health와 비인증 /api/live/config의 403, 컨테이너의 --workers 1 및 reload 미사용을 확인한다. 실제 로그인한 두 기기에서는 아래를 확인한다.

1. 계정 A의 host에서 사용자가 카메라·마이크 권한을 허용한다.
2. 계정 A의 다른 기기에만 session이 보이고 영상이 수신된다.
3. 계정 B에서는 A의 session이 보이지 않고 직접 연결도 거절된다.
4. viewer 종료 후 host는 남고, 새 viewer가 재접속할 수 있다.
5. host 중지/로그아웃/페이지 이탈 후 viewer와 목록이 정리된다.
6. 네트워크 단절, 앱 강제 종료, JWT 만료, 빠른 시작/중지에서 ghost session과 로컬 capture가 남지 않는다.
7. Wi-Fi/셀룰러 조합에서 실패하면 계정 인증 오류와 ICE/TURN 연결 오류를 구분한다.

## Android

versionCode=3, versionName=1.2이다. CAMERA/RECORD_AUDIO/MODIFY_AUDIO_SETTINGS를 추가하고 camera/microphone hardware를 optional로 선언해 viewer 전용 기기도 허용했다. Capacitor 기본 WebChromeClient의 권한 처리에 연결되며 권한을 자동 승인하지 않는다.

Android Studio 프로젝트: C:\dev\graduate\app\babyeye-web\android.

```powershell
Set-Location C:\dev\graduate\app\babyeye-web
npm.cmd ci
npm.cmd test
npm.cmd run build -- --mode android
npx.cmd cap sync android
$env:JAVA_HOME="$env:USERPROFILE\.jdks\jbr-21.0.11"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\android\gradlew.bat -p android assembleDebug
```

실제 API 주소의 .env.android와 Firebase Android 설정은 로컬 ignore 파일로만 유지한다. 웹 배포나 캐시 삭제만으로 기존 APK의 Manifest 권한은 바뀌지 않으므로 **새 APK 설치가 필요**하다. 기존 서명과 다르면 앱을 삭제하지 말고 기존 서명키로 재빌드한다.

## 검증 결과와 남은 항목

- 백엔드 전체 95 passed / 기존 PostgreSQL 통합 7 skipped.
- 프런트엔드 37 passed / 9 files.
- 웹 빌드·Capacitor sync·JDK 21 Android assembleDebug 성공.
- aapt로 실제 APK의 CAMERA/RECORD_AUDIO/MODIFY_AUDIO_SETTINGS 포함 확인.
- 새 WebSocket 테스트 20개에서 실제 JWT/활성 사용자 검증, 계정 격리, 역할 충돌, host/viewer 종료, 재접속, malformed frame, TTL/idle/전송 실패 정리를 검증했다.
- JS 테스트는 모의 WebSocket/RTCPeerConnection/미디어를 사용하며, 실제 단말 간 영상·음성 전송 및 서로 다른 NAT/TURN 환경은 아직 미검증이다.
- 실제 운영 배포·운영 JWT·운영 영상에는 접근하지 않았다. 이 PC에는 Docker/PostgreSQL과 현재 연결된 Android 기기가 없어 해당 실환경 검증은 배포 후 진행해야 한다.

## 되돌리기

전환 전 커밋/이미지를 기록하고 실패 시 backend-api만 해당 버전으로 복구한다. 스트리밍의 새 DB 컬럼은 없으므로 데이터를 삭제하지 않는다. 이전 서버는 인증 없는 relay 결함이 있으므로 무심코 구버전으로 되돌려 외부 노출을 유지하지 말고, 필요하면 live WebSocket 접근을 일시 중지한 상태에서 원인을 해결한다. 새 클라이언트는 구버전 서버에 JWT를 보내지 않으며 업데이트 필요 오류를 표시한다. 이전 학습 migration을 이번 rollback과 함께 제거하지 않는다.
