# 스마트홈 기능 제거

스마트홈을 더 이상 사용하지 않는다는 요청에 따라 아래를 제거했다.

- 하단 스마트홈 탭 및 전용 화면/라우트/API 클라이언트/샘플 데이터.
- 홈 화면 온도·습도·조명 카드와 dashboard 환경 응답/DB 조회.
- /api/smart-home 및 /api/environment 백엔드 라우터.
- DeviceState / EnvironmentState 모델, 전용 스키마 및 seed 데이터.
- 기존 DB용 005_remove_smart_home.sql: device_states / environment_states 전용 테이블과 그 데이터 제거.

하단 메뉴는 홈·라이브·감정·알림·설정 5개다. 예전 /smart-home 링크는 기존 wildcard 라우팅을 통해 홈으로 이동한다. 푸시 등록용 push_devices는 스마트홈 기기가 아니므로 유지한다. 사용자·카메라·분석·피드백·학습·알림·가중치는 변경하지 않는다.

## DB 적용 주의

모델 제거는 새 설치에서 해당 테이블 생성을 막는다. **이미 운영 DB에 있는 테이블과 데이터는 SQL을 적용해야 실제로 삭제된다.** API 시작 시 자동 삭제하지 않는다.

005는 요청된 기능 데이터의 영구 삭제다. 적용 전 전체 PostgreSQL dump를 파일로 보관하고 복구 가능성을 검증한다. migration은 transaction, lock_timeout=10s, advisory lock을 사용하며 IF EXISTS로 재실행 가능하다. CASCADE를 쓰지 않으므로 예상하지 못한 외부 의존성이 있으면 두 DROP을 모두 rollback하고 조사한다. 데이터를 되살리려면 백업이 필요하다.

## 배포 PC

C:\deploy\baby-monitor에서 기존 Compose 프로젝트/환경/옵션을 그대로 유지한다. 로컬 변경과 현재 이미지/커밋을 보존한다. 운영 자동 재배포는 하지 않았다.

1. git fetch 후 검토한 커밋의 이 문서와 005 SQL을 확인한다.
2. DB dump를 컨테이너 내부 파일로 만들고 docker cp로 별도 백업 폴더에 보관한다. PowerShell 바이너리 파이프로 dump를 받지 않는다. pg_restore --list로 검증한다.
3. backend-api만 유지보수 시점에 정지한다. 현재 live 세션은 종료되므로 사용자에게 재접속을 안내한다. 분석/GPU 학습/알림 Worker, DB/Redis/Nginx는 이 변경을 이유로 정지하거나 재배포하지 않는다.
4. 검토한 정확한 커밋으로 checkout한다. 기존 API가 구버전 dashboard 쿼리를 실행하지 않는 상태에서 SQL을 DB 컨테이너에 복사하고 psql -v ON_ERROR_STOP=1 -f로 적용한다. 커스텀 DB/사용자 및 schema/search_path는 운영 설정을 확인한다.
5. 성공 여부를 확인한 뒤 backend-api 이미지만 build하고 up -d --no-deps backend-api로 갱신한다. 새 모델에는 제거된 테이블이 없으므로 create_all이 다시 만들지 않는다.
6. /health 및 인증된 /api/dashboard가 정상이고 environment 키가 없으며, 두 제거 API가 404인지 확인한다. DB에서 두 전용 테이블만 없어졌는지 확인한다. 기존 사용자·카메라·분석·알림·피드백·학습 데이터 수와 가중치를 유지했는지 확인한다.

SQL 실패 시 원인을 해결하기 전 새/이전 API를 무작정 시작하지 않는다. 이전 API로 rollback하려면 해당 버전은 환경 테이블을 조회하므로 먼저 백업에서 두 테이블과 데이터를 복구해야 한다. 전체 DB를 덮어쓰거나 새로 들어온 핵심 데이터를 없애는 복구는 하지 않는다. 볼륨 삭제/down -v/학습 상태 초기화는 금지한다.

## Android

v1.4(versionCode5)로 빌드한다. 로컬 assets형 앱은 새 APK가 필요하며 Vercel을 로드하는 wrapper는 웹 배포/새로고침 후 확인한다. APK 서명이 다르면 기존 키로 재빌드하고 앱을 임의 삭제하지 않는다.

## 검증

전체 backend/frontend 회귀 테스트, dashboard 계정 분리 및 모델/프로덕션 라우터 제거 확인, 웹·Capacitor·Android 빌드를 수행한다. PostgreSQL 전용 테스트에는 005 재실행, 핵심 데이터 보존, 외부 의존성 발견 시 CASCADE 없이 전체 rollback 검증을 추가했다. 개발 PC에 PostgreSQL/Docker가 없으므로 실제 SQL 테스트는 skip하며 운영 적용 전 별도 테스트 DB에서 검증해야 한다. 운영 DB에는 접근하지 않았다.

최종 검증: backend 112 passed / PostgreSQL 전용 9 skipped, frontend 45 passed / 12 files. Vite Android build / cap sync / JDK21 assembleDebug / aapt v1.4(versionCode5) 확인 / compileall / git diff --check 통과. 운영 SQL 실행 및 실기기 설치는 수행하지 않았다.
