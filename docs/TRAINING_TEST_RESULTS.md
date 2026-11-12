# 학습 가능 조건 리팩터링 검증 결과

검증일: 2026-11-12, 개발 PC Windows PowerShell.
기준 main: 2bef1ea. 작업 위치: C:\dev\graduate\app.

## 실행 결과

| 검증 | 결과 |
|---|---|
| 전체 백엔드 pytest | **75 passed, 7 skipped** |
| Python compileall | 성공 |
| git diff --check | 성공 |
| 생성기·실행기 사전검사 import | torch를 import하지 않음을 별도 프로세스에서 확인 |
| Compose 정적 검사 | YAML 파싱 성공, 기존 GPU 예약·공유 볼륨 유지 확인 |
| 격리 테스트 Compose 검사 | 운영 env_file·미디어·가중치·DB 볼륨 마운트 및 호스트 포트/GPU 예약 없음 확인 |

실행 명령:

```powershell
Set-Location C:\dev\graduate\app
C:\dev\baby-monitor-push\work-test-venv\Scripts\python.exe -m pytest backend\tests -q
C:\dev\baby-monitor-push\work-test-venv\Scripts\python.exe -m compileall -q backend\app
git diff --check
```

환경: Python 3.10.0, torch 2.5.1+cpu, NumPy 1.26.4, Pillow 11.3.0, pytest 8.3.5. 운영 Dockerfile의 기존 PyTorch/CUDA 이미지는 변경하지 않았다. 테스트 데이터·후보·승인 파일은 격리된 임시 디렉터리에만 생성했다.

## 확인한 동작

- hungry 6 / tired 2는 Job을 만들지 않고 pending 유지.
- hungry 6 / tired 3은 Audio Job 1개, 각 3건만 예약하고 나머지 pending 유지.
- Vision unhappy 3 / normal 3은 stable opt-in일 때만 생성.
- 오디오 없는 피드백의 이미지를 Audio 샘플로 세지 않으며, 이미지 없는 피드백의 오디오도 Vision 수량으로 세지 않음.
- 사용자별 분리, uncertain·excluded·reserved·Mock/synthetic·지원하지 않는 라벨·비활성/Mock 사용자 제외.
- 이미 Job에 연결된 피드백 재예약 금지, 중복 스캔 중복 생성 금지, 모달리티 간 피드백 중복 연결 금지.
- 예약 중 예외 발생 시 Job/연결/예약 상태의 transaction rollback.
- 모든 실제 오디오·프레임 메타데이터 필드의 공통 처리, 유효 경로 fallback, 소유권/UUID/completed/경로 범위 검증.
- TRAINING_TRIGGER_ENABLED=false이면 DB 세션 자체를 열지 않음.
- 클래스별 최소 수량 설정 변경 및 새 Job 정책 snapshot 고정.
- 기존 queued/running/completed/failed Job과 예약 연결 보존.
- 부족한 기존 queued Job은 원인만 로그에 기록하고 상태·예약을 변경하지 않음. 유효한 기존 Job은 기존 최소 4건의 호환 정책으로 실행 가능.
- 새 Job은 저장된 모달리티만 실행하고 queued→running→completed/failed 및 started_at/completed_at 사용.
- 학습 subprocess 실패와 새 Job 사전검사 실패는 failed로 기록하되 reserved를 자동 해제하지 않음.
- manifest 파일 쓰기 실패 시에도 commit된 예약은 보존되고 DB 연결로 실행기 데이터 조회 가능.

## 실제 CPU 학습과 디코딩 검증 범위

테스트에서는 작은 결정적 특징 Tensor를 사용해 **실제 PyTorch optimizer로 head를 학습하고 후보 .pt와 report JSON을 생성**했다. 기존 활성 .pt, 보관 버전 .pt, current.json의 해시가 모두 동일하게 유지되는 것을 확인했다. 후보 재생성 시 기존 파일 덮어쓰기도 거부했다. 승인 함수는 호출하지 않았다.

실제 PIL 이미지 디코딩에 실패하는 파일을 넣어 샘플 수가 줄어들면, 디코딩 후 정책 검사에서 중단하고 후보 .pt를 쓰지 않는 것을 검증했다. 이때 EfficientNet checkpoint/backbone은 작은 테스트 모델로 대체했다. 모델 다운로드·WavLM/EfficientNet 전체 특징 추출·운영 데이터 성능 검증은 수행하지 않았다.

stratified_split은 클래스당 3건에서 각 클래스가 train/validation 양쪽에 포함되고 인덱스가 겹치지 않는지 확인했다. 클래스 부족·단일 클래스·설정 최소 미달의 예외를 유지했다. 이 작은 validation으로 운영 성능 개선을 주장하지 않는다.

## 미실행 검증과 배포 PC 작업

이 개발 PC에는 Docker/psql이 없어 실제 PostgreSQL 테스트 **7개를 skip**했다.

- 기존 알림 관련 PostgreSQL 테스트 3개.
- 신규 학습 관련 PostgreSQL 테스트 4개: 구 스키마에 003 migration 반복 적용, 동시 스캔 예약 중복 방지, 동시 executor claim, 피드백 수정과 예약의 row-lock 경합.

이 검증은 SQLite 테스트가 대신할 수 없다. 배포 PC에서는 **운영과 분리된 docker-compose.training-test.yml**로 실행해야 한다. 정상 동작 중인 기존 학습 이미지를 테스트 runner에 재사용할 수 있다. 정확한 명령은 TRAINING_ELIGIBILITY.md와 별도 배포 프롬프트에 있다.

실제 NVIDIA GPU/운영 WavLM·EfficientNet 가중치·실제 사용자 미디어로 후보 학습하는 작업, 운영 migration, Job 상태 변경, 가중치 승인/승격/롤백은 수행하지 않았다. 운영 PC나 운영 DB에 직접 접근하지 않았다.

기존 Starlette/Pydantic deprecation과 Python 3.10에 대한 Google SDK 지원 종료 경고는 있었으며, 테스트 실패는 없었다. 이 작업에서는 학습 리팩터링과 무관한 프런트엔드/APK를 다시 만들지 않았다.
