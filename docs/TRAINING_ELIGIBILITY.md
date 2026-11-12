# 학습 가능 조건 기반 Job 생성

## 개발 PC에서 완료한 변경

개발 경로는 `C:\dev\graduate\app`이다. 해당 경로가 없어서 최신 main(`2bef1ea`) 기준 worktree와 `codex/eligible-training-jobs` 브랜치를 만들었다. 기존 `C:\dev\baby-monitor`와 `C:\dev\baby-monitor-push`의 소스를 덮어쓰지 않았다. 운영 PC·DB·모델에는 접근하지 않았다.

| 항목 | 이전 | 변경 후 |
|---|---|---|
| Job 생성 | 사용자별 pending 20건 단위 | 모달리티별 학습 조건을 만족할 때만 |
| Audio | 단순 파일 유무와 총개수 | feeding→hungry, sleep→tired, 실제 오디오 |
| Vision | 예약 후에 클래스 분포 확인 | care→unhappy, stable→normal은 명시적 opt-in |
| 새 Job 최소 조건 | 생성 20건, 실행/분할은 클래스당 4건 | 서로 다른 타깃 ≥2개, 각 TRAINING_MIN_PER_CLASS 이상(기본 3) |
| 예약 | 20건 일괄 reserved | 클래스별 최소 수량만 균형 선택, 나머지는 pending |
| 실행 범위 | 데이터로 audio/vision 모두 추론 | 새 Job에 기록한 modalities만 실행 |
| 데이터 검증 | 생성기/학습기 파일 필드와 라벨이 다름 | 공통 서비스에서 동일 검증 |
| 동시성 | 생성기 advisory lock | 기존 lock 유지 + 예약/피드백 수정 row lock |
| 기존 Job 사전검사 실패 | 일부는 failed로 변경 | NULL 정책의 기존 Job은 queued 유지, 원인 로그 |
| 학습 결과 | 후보 후 명시적 승인 | 동일. 자동 승격·운영 가중치 변경 없음 |

### 실제 예약 규칙

- 기본 Audio는 hungry 3건 + tired 3건으로 Job 1개를 만든다. hungry 6/tired 2는 만들지 않는다. hungry 6/tired 3은 각 3건씩만 예약하고 hungry 3건은 pending으로 둔다.
- Vision은 stable 매핑을 켠 경우 unhappy 3 + normal 3으로 별도 Job을 만든다. 기본 false에서는 현재 매핑에 Vision 타깃이 unhappy 하나뿐이므로 Vision Job이 생기지 않는다.
- 카테고리별 오래된 피드백부터 선택한다. 여러 균형 배치가 있으면 배치마다 별도 Job을 만든다.
- Audio가 가능해도 Vision을 실행하지 않는다. 양쪽이 각각 가능하면 모달리티별 Job 2개를 만든다.
- 한 피드백은 한 Job에만 연결한다. 현재 두 모달리티의 정답 라벨 집합은 서로 겹치지 않는다. 원본에 오디오와 이미지가 함께 있어도 해당 정답이 매핑되는 모달리티에서만 사용한다. `training_job_feedback.feedback_id` PK는 변경하지 않는다. 향후 매핑이 겹쳐도 먼저 선택된 피드백은 다른 Job 후보에서 제거한다.
- 이미 reserved이거나 기존 Job에 연결된 피드백은 재사용하지 않는다. 실패한 Job의 예약도 자동 해제하지 않는다.
- Job과 reserved/연결 row는 같은 DB transaction에서 commit한다. manifest는 commit 후 원자적으로 쓴다. DB 연결 정보가 기준이며 executor는 manifest에 의존하지 않는다. 디스크 실패로 manifest가 없더라도 예약을 잃거나 재예약하지 않는다.

### 공통 검증

`training_data_service.py`는 피드백 타입·상태·정답, 활성 실제 사용자, canonical UUID, 메타데이터 request_id/user_id/completed, Mock/synthetic 표시, 요청 디렉터리 내부의 실제 비어 있지 않은 파일을 검증한다. nested Mock 표시도 제외한다. 한글/영문 라벨 매핑은 기존 학습기의 명시적 alias를 공통화했다. 불명확한 임의 문자열은 제외한다.

오디오는 converted_audio_path → model_audio_path → audio_path 순으로 **실제로 사용 가능한 파일까지 fallback**한다. 이미지는 selected_frame_path → model_frame_paths → frame_paths를 확인한다. 한 피드백의 여러 프레임을 여러 샘플로 부풀리지 않는다. 외부 경로와 경로 탈출, 잘못된 파일 확장자, 비어 있는 파일은 제외한다.

파일이 존재해도 디코딩·특징 추출 성공을 보장하지 않는다. 학습기는 디코딩 후에도 같은 최소 클래스 조건을 재검사하고 실패 시 후보를 쓰지 않는다. stratified_split의 최소 샘플 및 2클래스 예외를 유지한다. 클래스당 3건은 train 2/validation 1 수준의 파이프라인 실험이며 운영 성능 개선을 보장하지 않는다.

## 설정과 기존 Job 호환

```dotenv
TRAINING_MIN_PER_CLASS=3
AUTO_TRAIN_STABLE_VISION_AS_NORMAL=false
TRAINING_TRIGGER_ENABLED=false
```

TRAINING_MIN_PER_CLASS는 3 이상 정수이다. Job 생성기/실행기/학습 분할 모두 공통 정책을 사용한다. 새 Job은 정책 version=1, 클래스별 최소 수량, stable opt-in을 JSON으로 저장한다. 나중에 환경변수가 바뀌어도 해당 Job의 정책과 모달리티는 바뀌지 않는다.

기존 Job은 modalities와 training_policy가 모두 NULL인 상태로 보존한다. 기존 실행 조건이 더 느슨해져 예전 부족 Job이 갑자기 실행되지 않도록 **기존 Job에만 최소 4건의 호환 하한**을 유지한다(공통 설정이 4보다 크면 그 값을 따른다). 구버전 Job의 모달리티는 기존처럼 유효 데이터에서 판정한다. 데이터 부족/소유권/파일 오류가 있으면 원인을 로그에 남기고 queued 및 reserved를 유지한다. running/completed/failed Job은 스캔 대상이 아니며 변경하지 않는다. 새 Job의 사전검사 실패는 queued→running→failed로 기록한다.

TRAINING_TRIGGER_ENABLED=false이면 생성기는 DB 세션조차 열지 않는다. 이 플래그는 **기존 queued Job의 executor 실행을 막는 스위치가 아니다.** 검증 전에는 executor를 시작하지 않는다. Compose는 해당 .env 값을 존중하도록 수정했으며 값이 없을 때의 기존 true 기본 동작은 유지했다. 새 설치 예시는 false이다. TRAINING_THRESHOLD는 제거했다.

기존 GPU 예약·공유 볼륨·Head-only 학습·CUDA 관련 실행 설정을 유지했다. 생성기와 실행기 사전검사는 torch를 import하지 않는다. 학습만 기존 WavLM/EfficientNet 특징을 추출하고 CPU의 분리된 head를 갱신한다. 승인/버전 관리 코드는 출력 라벨 상수를 공통화한 것 외에는 유지했다.

## DB 마이그레이션

`backend/migrations/003_training_eligibility.sql`은 training_jobs에 nullable JSON 컬럼 `modalities`, `training_policy`만 추가한다. 기존 row를 업데이트하거나 Job/피드백/가중치를 삭제하지 않는다. started_at/completed_at을 그대로 사용하며 finished_at은 추가하지 않는다. 반복 실행 가능하다.

소스 bind mount와 API reload가 있으므로 **새 코드 checkout 전에 관련 프로세스를 안전하게 정지하고, 새 서비스를 시작하기 전에 migration을 적용**한다. 운영자가 현재 커밋·이미지·서비스 상태를 기록하고 DB dump와 weights/training-data/uploads를 저장소 밖에 백업·검증한 후 실행한다.

```powershell
Set-Location C:\deploy\baby-monitor
docker cp .\backend\migrations\003_training_eligibility.sql baby-monitor-db:/tmp/003_training_eligibility.sql
docker compose exec -T db psql -U baby_user -d baby_monitor -v ON_ERROR_STOP=1 -f /tmp/003_training_eligibility.sql
if ($LASTEXITCODE -ne 0) { throw 'Migration failed; do not start new services' }
```

## 개발 PC 테스트

권장하는 독립 환경 설정:

```powershell
Set-Location C:\dev\graduate\app
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.training-test.txt
.\.venv\Scripts\python.exe -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
.\.venv\Scripts\python.exe -m pytest backend\tests -q
```

이번 실행에는 기존 개발용 격리 환경 `C:\dev\baby-monitor-push\work-test-venv`의 Python 3.10, CPU torch 2.5.1을 사용했다. 실제 결과는 TRAINING_TEST_RESULTS.md를 참고한다. torch/Pillow가 없는 환경에서는 Head 학습 테스트가 명시적으로 skip된다.

## 실제 PostgreSQL 격리 검증

`docker-compose.training-test.yml`은 별도 DB/네트워크, tmpfs 데이터, 고정 테스트 계정만 사용한다. 운영 .env, DB 볼륨, 미디어, 모델을 마운트하지 않고 호스트 포트를 열지 않는다. 후보/승인 파일은 /tmp에서만 쓴다. 모델 backbone은 테스트에서 대체하며 운영 checkpoint를 읽지 않는다.

배포 PC에서는 운영 checkout을 바꾸기 전에 새 커밋의 **별도 validation worktree**에서 실행한다. 이미 정상 실행 중인 학습 이미지가 있다면 그 이미지를 사용해 불필요한 GPU 라이브러리 재설치를 피한다.

```powershell
Set-Location C:\deploy\validation\babyeye-training
$env:TRAINING_TEST_IMAGE = docker inspect --format '{{.Image}}' baby-monitor-training
docker compose -p babyeye-training-validation -f docker-compose.training-test.yml up --no-build --abort-on-container-exit --exit-code-from test-runner
$testExit = $LASTEXITCODE
docker compose -p babyeye-training-validation -f docker-compose.training-test.yml down
Remove-Item Env:TRAINING_TEST_IMAGE
if ($testExit -ne 0) { throw 'Isolated tests failed; do not deploy' }
```

기존 이미지가 없다면 TRAINING_TEST_IMAGE를 지정하지 않고 동일 up 명령에서 --no-build 대신 --build를 사용한다. 이 스택은 CPU 테스트이며 GPU 예약을 사용하지 않는다. PostgreSQL migration 반복 실행·동시 예약·동시 claim·피드백 수정 경합을 검증한다.

## 배포 PC 서비스 명령

배포 PC 전용 프롬프트에 상세 전환·백업·검증 순서를 제공한다. 아래는 그 순서 중 서비스 갱신 명령이다. 실행 중 학습을 강제 종료하지 말고, 유지보수 시점에 running Job이 없는 안전한 전환을 확인한다.

```powershell
Set-Location C:\deploy\baby-monitor
# 신규 Job 예약부터 중단한다.
docker compose stop training-worker
# 진행 중 학습이 안전하게 끝난 뒤에만:
docker compose --profile auto-training stop training-executor
# 코드 bind mount를 사용하는 다른 앱 프로세스도 전환 전에 정지한다.
docker compose -f docker-compose.yml -f docker-compose.push.yml stop backend-api backend-worker notification-worker

# 백업 검증 → 검토한 커밋 checkout → 003 migration → 아래 빌드 순서
docker compose --profile auto-training build backend-api training-worker training-executor

# .env에 TRAINING_TRIGGER_ENABLED=false를 먼저 명시한다.
docker compose -f docker-compose.yml -f docker-compose.push.yml up -d --no-deps backend-api backend-worker notification-worker training-worker
# import/설정 확인이며 Job을 생성하거나 실행하지 않는다.
docker compose exec -T training-worker python -c "from app.services.training_policy import TrainingPolicy; from app.workers import training_worker; print(TrainingPolicy.from_env().snapshot()); assert not training_worker.TRIGGER_ENABLED"
```

기존에 알림 overlay를 운영하지 않으면 그 overlay/notification-worker만 생략한다. .env/Firebase 키/원래 compose 프로젝트 이름과 볼륨을 유지한다. 검증 후 기존 운영 정책상 예약을 활성화하려면 TRAINING_TRIGGER_ENABLED=true로 바꾸고 training-worker만 재생성한다. executor는 기존에 사용 중이던 경우에만, 운영자가 후보 학습 실행을 승인한 뒤 시작한다.

```powershell
docker compose up -d --no-deps training-worker
docker compose --profile auto-training up -d --no-deps training-executor
docker compose logs --tail 100 training-worker
docker compose --profile auto-training logs --tail 100 training-executor
```

운영 DB에 가짜 피드백/Job을 삽입하지 않는다. 기존 불충분 Job을 재구성하거나 reserved를 초기화하지 않는다. 후보 .pt의 독립 검증과 기존 --approve 절차 전에는 활성 head를 바꾸지 않는다.

## 되돌리기

전환 전 커밋·이미지 ID와 실행 서비스를 기록한다. 실패 시 생성기/실행기를 안전하게 중지하고 이전 코드/이미지로 필요한 서비스만 복구한다. 003의 두 컬럼은 남겨 둔다. 기존 코드가 nullable 추가 컬럼을 무시하므로 데이터 삭제가 필요 없다.

새로 예약한 3건/클래스 Job은 이전 실행기의 4건 조건을 만족하지 않을 수 있다. **rollback 후 학습 서비스는 검토 전까지 중지 상태로 유지**하고 자동으로 예약 해제/Job 변환/재실행하지 않는다. DB 전체 복원, down -v, volume prune, 기존 .pt 덮어쓰기를 실행하지 않는다.

## 변경 파일과 이유

| 파일 | 이유 |
|---|---|
| app/services/training_policy.py | 공통 출력 클래스·정답 alias·최소 조건·Job 정책 해석 |
| app/services/training_data_service.py | 소유권·Mock·실제 모달리티 파일·Job 연결 검증 공통화 |
| app/workers/training_worker.py | 20건 예약 제거, 최소 균형 배치/독립 모달리티/원자적 예약 |
| app/workers/auto_training_executor.py | 저장된 모달리티/정책 실행, 기존 queued 보존, torch 없는 사전검사 |
| app/workers/train_personalized_heads.py | 공통 데이터 로딩, 디코딩 전후·분할에 같은 정책 적용 |
| app/services/personalized_head_store.py | 출력 클래스 상수만 공통화, 승인 동작 유지 |
| app/models.py | nullable modalities/training_policy 컬럼 |
| app/routers/feedback.py | 예약과 수정 사이 row lock으로 경쟁 방지 |
| migrations/003_training_eligibility.sql | additive migration |
| tests/training_helpers.py | 격리된 실제 WAV/프레임 fixture |
| tests/test_training_eligibility.py | 생성·예약·소유권·필드·기존 Job·실패 상태 검증 |
| tests/test_head_training.py | CPU 후보 학습·승인 파일 보존·분할·실제 이미지 디코딩 실패 |
| tests/test_training_postgres.py | 실제 PostgreSQL upgrade·동시성·수정 경합 |
| requirements.training-test.txt | 개발/격리 검증 의존성 |
| docker-compose.yml | 공통 정책과 trigger 환경변수 반영, GPU/볼륨 유지 |
| docker-compose.training-test.yml | 운영과 분리한 PostgreSQL/CPU 테스트 스택 |
| .env.example | 공통 최소 조건·stable opt-in·초기 trigger 예시 |
| .gitignore | work scratch 제외 |
| docs/TRAINING_ELIGIBILITY.md | 설계·운영 적용·복구 안내 |
| docs/TRAINING_TEST_RESULTS.md | 테스트 결과와 한계 |

표의 app/migrations/tests/requirements 경로는 backend 하위이다.
