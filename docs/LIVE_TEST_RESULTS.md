# 스트리밍 계정 격리·종료 관리 검증

검증일: 2026-11-12 (Asia/Seoul). 기준 main 75883c3.
개발 위치: C:\dev\graduate\app. 작업 브랜치: codex/account-live-lifecycle.

| 검증 | 결과 |
|---|---|
| 전체 백엔드 pytest | 95 passed, 기존 PostgreSQL 7 skipped |
| 신규 signaling/세션 테스트 | 20 passed |
| 프런트엔드 Vitest | 37 passed, 9 files |
| 웹 빌드 (Android mode) | 성공 |
| Capacitor sync android | 성공 |
| JDK 21 Gradle assembleDebug | 성공, versionName 1.2 / versionCode 3 |
| 실제 APK의 aapt permissions 검사 | CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS 포함 확인 |
| Python compileall / git diff --check | 성공 |
| Compose 파싱·비교 | API --workers 1, reload 제거, 기존 volume 및 학습 서비스 보존 확인 |

백엔드는 격리된 SQLite와 실제 JWT/활성 사용자 의존성, FastAPI TestClient WebSocket을 사용했다. 다음을 확인했다.

- 인증 없는 REST와 legacy 무인증 WebSocket 거부.
- 잘못된/만료/exp 없는 JWT 거부 및 연결 후 비활성 계정 재확인.
- 타인 session 목록/상세/종료/host/viewer 접근 차단과 타인 camera_id 차단.
- 같은 계정의 signaling 전달, from/sessionId 서버 지정, JWT/추가 필드 relay 금지.
- 같은 역할 중복 접속 거부 후 기존 socket 유지.
- 소유자의 종료 API가 양쪽 peer를 닫고 반복 호출 가능.
- viewer만 나가면 host는 유지, 재접속 시 새 협상 ID 및 이전 ICE 무시.
- 잘못된 Origin/JSON/메시지 형태 차단과 host room 정리.
- pending TTL, idle 기한, JWT 만료, 수량 제한, shutdown 정리.
- 옛 socket의 finally가 새 viewer 연결을 제거하지 않음.
- 수신이 실패한 peer의 room을 제거하고 상대편까지 종료.

프런트엔드는 모의 WebSocket/RTCPeerConnection/미디어 및 DOM 테스트를 사용했다. 이전 알림/로그인 테스트도 포함한다.

- 첫 프레임 인증, URL에 토큰 미포함, 구서버 프로토콜 거부.
- SDP 전 ICE 대기, 답변 1회, offer 중복 차단, 이전 협상 메시지 무시.
- 역할 점유 오류 표시, 서버 종료·응답 중단·인증 timeout 때 capture/peer/socket 정리.
- pagehide/unmount/로그아웃/계정 전환 시 원래 계정으로 room 종료 및 media track stop.
- 늦은 getUserMedia/room 생성 결과 정리와 시작 중복 방지.
- 녹음 AudioContext 즉시 종료, 업로드 signal 취소, 늦은 분석 결과 무시.
- 늦은 세션 복원/로그아웃/로그인이 새 계정을 복원하거나 로그아웃시키지 않음.

미검증: 실제 두 기기 사이 영상·음성, Android 권한 허용·거절 실기기 동작, 서로 다른 NAT/셀룰러/TURN 환경, 운영 서버 반영. 현재 adb에 연결된 기기가 없어 새 APK를 단말에 설치·실행하지 않았다. 기존 PostgreSQL 통합 7개는 이 PC에 Docker/PostgreSQL이 없어 skip했으며 이번 스트리밍 수정은 DB schema를 추가하지 않는다. 이전 학습 003 migration 적용 여부는 배포 PC에서 별도 확인한다.

실행 환경: Windows, Python 3.10 개발 venv, Node 26.13.0, JDK 21. 기존 Pydantic/Starlette/Google SDK 지원 경고, Browserslist 오래된 데이터 및 Android flatDir/native strip 경고가 있었으며 최종 테스트/빌드 실패는 없었다. Firebase Android 설정과 실제 공개 API 주소는 로컬 ignore 파일로만 사용했고 Admin 비밀키는 사용하지 않았다.

운영 DB·영상·학습 가중치·활성 모델에는 접근하지 않았다. 코드 검증 성공이 운영에서 이미 계정 격리가 적용됐다는 의미는 아니며, backend-api와 새 클라이언트를 함께 적용해야 한다.
