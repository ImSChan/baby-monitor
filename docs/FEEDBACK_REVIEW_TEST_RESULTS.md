# 피드백 UX 검증 결과

개발 PC에서 수행. 운영 서버·DB·FCM 키·실제 아기 데이터·학습 가중치에는 접근하지 않았다.

| 검증 | 결과 |
|---|---|
| 전체 backend pytest | 110 passed / 7 skipped |
| 전체 frontend Vitest | 45 passed / 12 files |
| 실제 Edge 모바일 크기 브라우저 시나리오 | passed, JS page error 0 |
| Android 모드 Vite 빌드 | 성공 |
| Capacitor sync android | 성공 |
| JDK21 assembleDebug | 성공, v1.3 / versionCode4 |
| APK aapt 확인 | POST_NOTIFICATIONS / CAMERA / RECORD_AUDIO 등 권한 및 버전 확인 |
| git diff --check / Python compileall | 통과 |

## mock 알림 시나리오

1. 임시 SQLite/메타데이터에 mock 분석 21개를 생성했다. 안정 5 → 배고픔 8 → 졸림 5 → 안정 3 순서이다.
2. 실제 enqueue_notification이 상태 알림 2개를 만들었다. 3회 연속 이후 같은 상태의 4~8번째 분석에서는 중복 알림이 생기지 않았다. 안정 상태는 알림을 만들지 않았다.
3. 실제 notification-worker와 Firebase messaging.Message 생성 경로를 실행했다. 외부 SDK send만 capture로 대체하여 eventId/제목/클릭 데이터와 전송 결과 sent를 검증했다.
4. 실제 React 앱과 로컬 FastAPI를 연결한 Edge(390×844)에서 모의 native 수신 callback으로 PushCenter 배너가 나타나는지 확인했다. 배너 클릭 후 분석 결과 화면으로 이동했다.
5. ‘졸렸어요’ 한 번 선택 → 1개 저장 → 실행 취소 → 이전 응답 복구를 확인했다.
6. 슬라이더와 여기부터/여기까지로 5개 구간을 고르고 배고픔 일괄 적용을 확인했다.
7. 스케줄러로 정기 알림 1개를 만들고 동일한 전송 경로를 통과시켰다. native 클릭 callback은 그 알림의 정확한 12시간 돌아보기로 이동했다.
8. 돌아보기에서 미응답 졸림 사건과 응답 완료 배고픔 사건을 확인하고 정기 알림을 껐다.

브라우저 결과 JSON: analyses=21, immediateNotifications=2, scheduledNotifications=1, rangeFeedbackCount=5, singleFeedbackAndUndo=true, pageErrors=[]. 화면 캡처 4장을 전달 자료에 포함했다.

## 추가 회귀 검증

- 타인 계정/다른 카메라 분석 배제, JWT 없는 요청 및 잘못된 토큰 거부.
- 12시간 반개방 시간 범위, 명시적 시간대, 현지 예약 시각 변환, 기본 꺼짐과 시각/시간대 유효성 검사.
- 예약 중복 방지, 지난 예약 몰아보내기 방지, 모두 응답/빈 구간은 미발송, 일정 해제 후 queued 발송 취소.
- 단건/연속 구간 저장, UUID 멱등성, 타인 action 충돌, optimistic version 충돌, 기존 API 중복 제출 409 유지.
- 일부 항목이 reserved이면 일괄 저장/취소 전체 거부, uncertain은 excluded.
- 같은 사건의 여러 분석은 최소 클래스 수를 부풀리지 않음. 서로 다른 AI 사건을 한 번에 선택한 구간도 관찰 하나로 제한. 이미 사용한 관찰 그룹은 다음 스캔에서 재사용하지 않음.
- synthetic=True인 mock 피드백은 실제 개인화 학습 검증에서 제외.
- backfill 기본 dry-run, 적용/재실행 시 중복 없음, 새 알림을 만들지 않음.
- 기존 로그인/로그아웃, 알림 확인, 스트리밍 종료 및 학습 정책 테스트 포함.

## 아직 확인하지 않은 범위

실제 Android 단말의 OS 알림 표시·진동·소리 및 Firebase 네트워크 전달은 미검증이다. adb devices에 연결된 기기가 없었다. mock native bridge와 capture FCM을 사용했으므로 실제 휴대폰에 푸시가 울렸다고 해석하면 안 된다.

이 PC에는 Docker/PostgreSQL이 없어 TEST_POSTGRES_URL 기반 기존 통합 테스트 7개를 skip했다. PostgreSQL fixture에는 001~004 SQL 재실행과 구버전 learning_group 컬럼 없는 스키마 전환 경로를 포함했지만 실제 SQL 실행은 배포 전 테스트 DB에서 확인해야 한다. SQLite 테스트는 ORM 생성 스키마를 사용했다.

실제 운영 반영, 이전 운영 기록 backfill, 10시/22시 실제 경과 대기, 운영 GPU 재학습/모델 승격은 실행하지 않았다. 스케줄 테스트에서는 주입한 시각으로 검증했다. 기존 SDK 지원/Deprecation, Browserslist, Gradle flatDir 경고는 있었으며 최종 테스트/빌드 실패는 없다.
