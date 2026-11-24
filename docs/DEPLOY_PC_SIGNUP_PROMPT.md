# 배포 PC Codex에게 전달할 프롬프트

BabyEye 회원가입/아이 월령 기능을 배포 PC에서 적용해줘. 저장소 C:\deploy\baby-monitor, remote https://github.com/ImSChan/baby-monitor.git. docs/SIGNUP_CHILD_AGE.md와 CARE_RECORDS.md, 실제 Compose/AGENTS를 읽고 작업해. 계획만 제시하지 말고 아래 범위의 백업·마이그레이션·설정·필요한 서비스 갱신·검증·결과 보고까지 진행해.

목표: 로그인의 회원가입에서 이메일 형식 아이디/비밀번호/아이 별명/현재 월령으로 가입하고, 새 API 및 분석 Worker가 실제 월령에 맞는 육아 기록 보조 판단을 하도록 한다. 이메일 인증은 없다. 기존 계정의 월령은 입력 전 NULL을 유지한다.

## 반드시 보존할 것
운영 PostgreSQL 볼륨·사용자·분석/피드백·학습 데이터·가중치·Redis 큐·업로드·SSL·Firebase 키·Android 서명을 보존한다. down -v, prune, 초기화, reset --hard, clean, 강제 push, 학습 모델 승격은 금지한다. 비밀값·계정 비밀번호·인증 토큰을 출력/보고서/Git에 남기지 않는다. 변경 범위는 이 기능의 007 마이그레이션/API·분석 Worker 및 ALLOW_REGISTRATION 설정뿐이다. 다른 운영 기능을 임의 재배포하지 않는다.

## 사전 확인
1. git status와 remote/main 차이, Docker context/Compose project/overlay를 확인한다. 운영 checkout은 API/Worker에 바인드 마운트되어 있으므로 git pull부터 하지 않는다. 로컬 변경이 있거나 다른 기능 커밋이 섞이면 덮어쓰지 말고 차이를 보고한다.
2. git fetch origin main 후 별도 신규 임시 폴더에 필요한 007 SQL을 준비한다. git show origin/main:backend/migrations/007_child_profile.sql의 출력을 UTF-8로 저장한다. 006이 실제 DB에 적용됐는지 care_profiles/care_records/emotion_events.care_context로 확인한다. 006이 없으면 이 작업에서 임의로 넘어가지 말고 선행 적용 필요를 보고한다.
3. 실제 db 컨테이너/DB/role을 확인한다. 기본 Compose 값은 db / baby_monitor / baby_user지만 실제 구성이 우선이다. SQL이나 환경 파일의 비밀번호는 출력하지 않는다.
4. 운영 DB의 pg_dump 사용자 형식 백업을 파일로 만들고 pg_restore --list로 읽히는지 확인한다. PowerShell stdout 리다이렉션으로 바이너리를 쓰지 말고 컨테이너 내부 pg_dump -Fc -f 후 docker cp로 host의 신규 backup 경로에 복사한다. 호스트 백업 크기/해시/테이블 목록을 확인한다. 기존 가중치를 변경하지 않는다.
5. 가능하면 별도 임시 PostgreSQL 시험 DB/고유 schema에 006까지의 스키마와 합성 구형 care_profiles 행을 준비해 007을 두 번 적용한다. 이전 행 NULL/기존 토글 유지, 새 월령 저장, CHECK 위반 거부를 검증한다. 운영 연결을 TEST_POSTGRES_URL로 사용하지 않는다. backend/tests/test_postgres.py의 새 테스트는 전용 시험 DB에서만 실행한다.

## 적용 순서
1. 실제 운영 트래픽/분석 중 작업 상태를 확인하고 신규 분석 요청을 안전하게 차단하거나 사용자에게 중지를 안내한다. 진행 중 분석/기존 care-10m-v1 메타데이터 작업이 끝나도록 큐를 비운 뒤 API와 backend-worker만 정상 정지한다. 큐 삭제/학습 작업 강제 종료는 하지 않는다. 장시간 학습이 진행 중이면 안전한 적용 시간을 판단하고 보고한다.
2. 준비한 007 SQL을 db 컨테이너의 신규 임시 경로로 docker cp 한다. psql -v ON_ERROR_STOP=1 -f로 적용한다. 예시(실제 DB 설정에 맞춰 변경):
   docker compose exec -T db psql -U baby_user -d baby_monitor -v ON_ERROR_STOP=1 -f /tmp/babyeye-007.sql
   SQL은 BEGIN/COMMIT, lock_timeout 10초, advisory lock, 컬럼 IF NOT EXISTS, CHECK 존재 검사로 재실행 가능하다. 실패하면 원인을 확인하고 이전 코드를 정상 재개하며, 실패한 상태로 git 소스를 갱신하지 않는다.
3. 새 컬럼 child_name / child_age_months / age_recorded_on과 ck_care_profile_age를 확인한다. 기존 행 수·데이터/토글은 유지되고 월령은 NULL이어야 한다. 운영 행의 임의 일괄 10개월 채우기는 하지 않는다.
4. 깨끗한 checkout과 fast-forward 가능 상태를 확인하고 git merge --ff-only origin/main 등으로 검토한 코드를 적용한다. 원래 브랜치/커밋을 기록한다. 적용 코드를 main의 의도한 변경과 대조한다.
5. 운영 .env의 ALLOW_REGISTRATION을 정확히 하나의 true로 설정한다. 다른 설정과 비밀값을 보존한다. API는 env_file을 읽으므로 단순 restart 대신 기존 운영 overlay를 포함한 동일 Compose 구성으로 backend-api와 backend-worker만 up -d --no-deps --force-recreate 한다. 현재 이 두 서비스는 backend/app 바인드 마운트를 사용하지만 실제 구성이 다르면 코드가 포함된 이미지를 먼저 준비한다. DB/Redis/training 서비스를 재생성하지 않는다.
6. API health, API·Worker 오류, 새 컬럼 조회를 확인하고 신규 요청 차단을 해제한다. 초기 서비스 재기동이 실패하면 새 컬럼을 남긴 채 이전 API/Worker 코드로 되돌려 서비스를 복구한다. DB 컬럼 DROP이나 가중치 복구 덮어쓰기는 하지 않는다.

## 검증
- 가입 기능의 ALLOW_REGISTRATION=true 적용 여부를 값 노출 없이 확인한다.
- 실제 운영 계정을 임의 생성하지 말고, 격리 시험 환경에서 가입 201 → 중복 409 → 로그인 200 → /me → /care/summary의 아이 정보와 월령을 확인한다. 비밀번호/토큰은 출력하지 않는다. 운영에서 end-to-end 가입 확인이 필요하면 명확히 합의한 시험 계정만 사용한다.
- 격리 환경에서 기존 계정은 /care/profile 입력 전 월령 NULL/보정 없음, 입력 후 기준 반영, 사용자 간 프로필 분리, 꺼둔 참고 토글 보존을 확인한다.
- 월령 5의 이유식 기록은 보정에서 제외, 10의 동일 기록은 참조, 같은 성장 단계·같은 식사 종류의 개인 간격만 사용, 0~3/36개월 이상은 보정 없음, stable 보호, 기존 피드백·학습 정답 경로 유지까지 확인한다.
- Vercel 최신 main 배포 상태와 /login → /register 경로를 확인한다. 운영 배포 설정/도메인을 임의 변경하지 않는다. 기존 Android는 자산을 내장한 Capacitor 빌드일 수 있으므로 새 v1.9 APK 설치/Android Studio 재빌드가 필요하다는 점을 안내한다.

## 결과 보고
적용 commit, 백업 경로·검증, 007 적용/재실행 검증, 갱신한 서비스, 회원가입 활성화, 수행한 테스트와 미실행 사유, DB/가중치 보존 여부, 남은 사용자 조치를 짧게 요약한다. 가입 성공만으로 실제 AI 정확도 향상이 입증됐다고 보고하지 않는다. 운영 검사에 사용할 비밀값은 보고서에서 제거한다.
