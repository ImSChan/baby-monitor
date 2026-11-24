# 회원가입 및 아이 월령 적용 (2026-11-24)

로그인 화면 → 회원가입 → 이메일 형식의 아이디, 비밀번호(8~128자), 아이 별명, 현재 월령(0~71개월) 입력 → 가입 완료 → 로그인. 이메일 인증은 없다. 기존 이메일 로그인/JWT/해시·역할/활성 사용자 검증을 재사용한다. 가입은 보호자 역할로만 생성하며 계정과 CareProfile을 하나의 트랜잭션으로 저장한다. 중복 아이디 409, 유효하지 않은 입력 422, 운영자가 가입을 끈 경우 403을 화면에 안내한다. 비밀번호는 공백까지 원문 그대로 해시하며 로그·응답에 포함하지 않는다.

로그인 전에 열었던 알림 결과 경로는 가입과 로그인 이후에도 유지한다. 외부 URL은 허용하지 않는다. 가입 후 자동 로그인하지 않으며 성공 화면에 아이디만 채워 준다.

기존 사용자는 육아 기록 → 아이 정보 입력/수정, 또는 설정 → 프로필 관리로 이동한다. 아이 이름과 월령은 현재 계정만 조회·수정한다. 참고 설정을 끈 상태에서 아이 정보를 수정해도 켜지지 않는다. 여러 아이 기능은 없다.

## 실제 판단 변경

10개월 고정을 제거하고 care-age-v2로 변경했다. 입력일(KST)을 기준으로 매달 추정 월령이 증가한다. 생년월일을 받지 않으므로 정확한 생일 기반 월령이 아니며 화면과 분석 스냅샷에 추정임을 표시한다. 월말 입력은 다음 달의 마지막 날을 해당 월의 기준일로 사용한다.

- 6개월 미만: 수유 기록만 식사 간격 보정에 사용한다.
- 6~35개월: 수유/이유식을 지원하되 같은 종류끼리 개인 간격을 계산한다. 간식은 제외한다.
- 개인 간격은 같은 성장 단계의 기록으로 계산한다. 새 단계의 자료가 부족하면 시간 경과로 후보를 높이지 않는다.
- 0~3개월, 36개월 이상, 월령 미입력: 시간 점수 보정 없이 기존 영상·소리 모델 판단을 유지한다. 이 범위는 제품의 보수적 적용 범위다.
- 최소 4개 유효 간격, 기존 후보 증거, stable/quiet 유지, 최대 +6/-4%p 보정, 스냅샷 불변, 기록에서 학습 정답을 만들지 않는 정책은 유지한다.
- 월령별 WHO/CDC/NIH의 하루 식사 횟수·수면 범위는 화면의 참고 정보다. 하루 기준을 시간 간격으로 환산하거나 미기록 시간을 수면 부족으로 해석하지 않는다. 상세 근거는 CARE_RECORDS.md.

## 변경 파일과 이유

| 파일 | 변경 이유 |
|---|---|
| backend/app/routers/auth.py | 공개 가입에 필수 아이 정보 검증, 계정·프로필 원자 저장 |
| backend/app/models.py, migrations/007_child_profile.sql | 기존 행 보존, nullable 아이 정보·월령 기준일 추가 |
| backend/app/services/child_profile_service.py | 월령 추정/단계·참고 범위 공통 처리 |
| backend/app/routers/care.py | 인증된 내 아이 프로필 API 및 summary 동적 월령 |
| backend/app/services/care_context_service.py | 실제 보정에 월령/동일 단계/동일 식사 종류 반영 |
| babyeye-web/src/pages/RegisterPage.jsx, LoginPage.jsx, routes/AppRouter.jsx | 가입 입력/오류/로그인/원래 알림 경로 복귀 |
| babyeye-web/src/components/care/ChildProfileForm.jsx, pages/CarePage.jsx | 기존 계정 입력 및 월령별 안내 |
| babyeye-web/src/components/care/CareContextNote.jsx, pages/SettingsPage.jsx | 분석 시점 추정 월령 및 실제 프로필 관리 경로 |
| backend/tests/test_signup_age.py, test_care.py, test_postgres.py, conftest.py | 가입/소유권/암호/월령/보정/마이그레이션 검증 |
| babyeye-web/src/pages/RegisterPage.test.jsx, LoginPage.test.jsx, CarePage.test.jsx | 가입 UX, 딥링크 복귀, 프로필 수정 검증 |
| backend/tools/review_demo.py | 임시 SQLite에서 실제 가입·프로필 API 재현 |
| .env.example | ALLOW_REGISTRATION opt-in 명시 |
| babyeye-web/android/app/build.gradle | v1.9 / versionCode 10 |
| docs/CARE_RECORDS.md, 이 문서, DEPLOY_PC_SIGNUP_PROMPT.md | 최신 판단 정책 및 배포 분리 |

## 운영 적용

DB 마이그레이션 006 완료 상태에서 007을 먼저 적용해야 한다. create_all은 기존 테이블 컬럼을 추가하지 않는다. 기존 계정 월령은 NULL로 유지하므로 로그인 후 육아 기록에서 입력해야 한다. 새 프로필 데이터를 만들었다는 이유로 학습 자료나 기존 결과를 수정하지 않는다.

API의 환경에 ALLOW_REGISTRATION=true를 설정해야 공개 가입이 된다. 기본값 false는 유지한다. 환경 변경은 restart만으로 반영되지 않으므로 API 컨테이너 recreate가 필요하다. 상세 절차와 검증 요청은 DEPLOY_PC_SIGNUP_PROMPT.md를 배포 PC Codex에 전달한다. 개발 PC에서 운영 DB·서비스는 변경하지 않았다.

Android는 최신 소스를 받아 npm.cmd ci, npm.cmd run build -- --mode android, npx.cmd cap sync android 후 Android Studio에서 실행한다. 기존 google-services.json/.env.android/서명을 보존한다. APK를 갱신해도 서버의 007/새 API·분석 Worker 적용은 별도로 필요하다. 웹은 GitHub main 연동 Vercel 배포 완료를 확인한다.

## 검증 결과

결과는 최종 검증 후 아래에 기록한다. PostgreSQL 실행 환경이 없는 개발 PC에서는 실제 PostgreSQL 마이그레이션 실행 및 동시성 테스트를 실행하지 않았으며 배포 PC의 격리 시험 DB에서 검증해야 한다.

- 백엔드 전체: 166 passed / 12 skipped. PostgreSQL 전용 시험은 TEST_POSTGRES_URL 부재로 skip했다.
- 프런트엔드: 22 files / 87 passed.
- 실제 로컬 Edge 브라우저(390×844): 실제 API로 가입 201/로그인, 프로필 저장 후 재조회, 7개월→14개월 안내 변경, 가로 overflow 없음 확인. 임시 SQLite만 사용했다.
- 기존 Worker 통합 시험: 합성 입력 3회로 보정된 상태 알림 1회 생성 및 모의 FCM 발송/중복 방지 확인(test_care.py). 실제 사용자에게 푸시를 발송하지 않았다.
- Vite android build / cap sync / Gradle assembleDebug 성공. v1.9(versionCode 10), APK 5,905,398 bytes. SHA-256 a807e8519c1fe33a5632e5b5eae05593c91e50454c5eb8beb2b6e8f2f5f5a252. 실기기 설치·실제 FCM 수신은 미실행이다.
- git diff --check 통과. 운영 DB/서비스 배포는 미실행이다.
