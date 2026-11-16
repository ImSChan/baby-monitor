# 육아 기록 검증

- 전체 backend: 132 passed / PostgreSQL 전용 11 skipped.
- 전체 frontend: 67 passed / 18 files.
- 실제 Edge 브라우저, 임시 SQLite/FastAPI: 식사 저장, 수면 드래그, 수정, 삭제/취소, 320px 화면 가로 넘침 없음, JS page errors 0.
- mock 모델의 feeding 0.50 / sleep 0.48에 최근 식사 기록을 적용하면 feeding 0.46 / sleep 0.48로 순위 변경. 실제 Worker가 sleep으로 저장하고 세 번 연속 결과에서 기존 알림을 생성한 것을 확인.
- 같은 기록에서 참고를 끄면 feeding 결과 유지. 기존에 보정된 분석 스냅샷은 이후 삭제/설정 변경에도 유지.
- FCM은 capture이며 실제 휴대폰에 OS 알림이 울렸다는 검증은 아님. 영상/소리 모델도 mock이므로 실제 예측 정확도 개선은 미검증.
- Vite Android 모드 build / Capacitor sync / JDK21 assembleDebug 성공. APK v1.6/versionCode7. 실기기 설치는 수행하지 않음.
- 기존 스트리밍 비활성 사용자 재검사 테스트에서 SQLite 단일 연결의 스레드 동시 transaction 충돌을 발견해 해당 테스트 모듈만 파일 SQLite/별도 연결로 격리했다. 운영 스트리밍 동작은 변경하지 않았다.

PostgreSQL SQL/동시성 테스트는 TEST_POSTGRES_URL이 없어 skip했다. 실제 006 SQL 실행은 운영 전 격리 DB에서 별도로 확인해야 한다. 테스트에서 쓰는 임시 스키마를 운영 DB에 만들지 않는다. 운영 DB/피드백/학습 가중치/활성 모델은 변경하지 않았다. 배포 전 사용자별 데이터·키·볼륨 backup과 API/분석 Worker 갱신이 필요하다.
