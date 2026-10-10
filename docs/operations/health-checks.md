# Phase 6 연결 검사 실행과 활성화

구현 범위는 [계획](../plans/phase-6-health-checks.md), 최종 정책은
[#14](https://github.com/DomineYH/vibe_coding_archive/issues/14)를 따른다.
API는 작업 접수·조회만 하고 실제 HTTP는 같은 Linux 호스트의 별도 worker가
실행한다. SQLite migration `0012_health_checks`가 필요하다. 자동 정기 검사는 없다.
로컬 결합 검증은 [검증 기록](../evidence/phase-6/verification.md)에 기록한다.

## 개발 중 기대 상태와 검증

개발 API(`APP_ENV=development`)의 기본 재검사 비활성은 의도된 안전 제한이다.
기능 미구현이나 외부 사이트 장애를 뜻하지 않는다. `/api/v1/meta`의
`health_check`·`health_batch`는 `enabled=false`, 사유는 `operational_restriction`이다.
development 지정만으로 실제 송신을 허가하지 않으며, 승인 증거 없는 개발 우회는 없다.

화면·상태 흐름 시연은 [프로젝트 시작 안내](../../README.md)의 `frontend/`에서
`npm run dev`로 실행하는 기존 mock 모드를 쓴다. 연결 결과는 외부 요청 없는 합성
데이터로, 실제 외부 사이트 관찰이 아니다. API 모드의 실패를 mock 성공으로 바꾸지 않는다.

API·큐·worker는 기존 `APP_ENV=test` 하네스로 검증한다. `backend/`에서 아래
명령을 실행한다. 인증 API 시험은 [백엔드 안내](../../backend/README.md)의 검증된
R15 비밀번호 차단 목록을 미리 준비하고 `PASSWORD_BLOCKLIST_PATH`로 지정해야 한다.
시험은 `.env`를 읽지 않고 전용 임시 DB와 합성 fixture·통제 I/O를 사용한다.

```sh
APP_ENV=test HEALTH_CHECKS_ENABLED=false uv run --frozen pytest \
  tests/contracts/test_health_api.py tests/test_health_worker.py tests/test_health_worker_process.py
```

`test_health_api.py`는 실제 인증·검사 접수·작업/배치 조회 계약을,
`test_health_worker.py`는 영속 큐와 통제 probe를,
`test_health_worker_process.py`는 별도 프로세스·잠금·로컬 Unix 소켓의 종료를 확인한다.
`create_app(..., health_testing=True)`와 worker의 `testing_probe`는 `APP_ENV=test`에만
허용하며 development 서버에 적용하지 않는다. 테스트 fixture와 승인 템플릿은
실제 호스트 승인 증거가 아니다.

`HEALTH_CHECKS_ENABLED=true` 하나나 worker 실행만으로 접수가 열리지 않는다.
[설정과 승인 기록](#설정과-승인-기록)의 조건과 API/worker의 동일 실행 설정,
인증 준비가 필요하다. worker는 같은 boot의 ready heartbeat가 15초 미만이어야
하며 다른 boot/worker 또는 만료된 lease의 `running` 작업이 없어야 한다.
`build_digest()`는 `backend/app/**/*.py`, `backend/alembic/**/*.py`,
`backend/pyproject.toml`, `backend/uv.lock`을 포함한다. 해당 코드·잠금·프로젝트 설정이나
승인 구성이 바뀌면 기록이 불일치하여 접수가 닫힌다. `--reload` 개발 루프에서도
승인 기록은 자동 갱신되지 않는다.

비활성일 때 현재 권한·Origin·CSRF 등 요청 조건을 통과한 새 개별/전체 검사 접수는
`503 FEATURE_UNAVAILABLE`로 닫힌다. 기존 연결 결과·검사 작업·배치 진행은
현재 권한에 따라 계속 조회할 수 있다. 실제 호스트 검증·송신 활성화 승인은
[#204](https://github.com/DomineYH/vibe_coding_archive/issues/204)의 사람 작업 범위다.
관리자 버튼의 비활성 사유 UI 보완은 [#210](https://github.com/DomineYH/vibe_coding_archive/issues/210)에서 다룬다.

## 설정과 승인 기록

API와 worker에 동일한 DB·DNS·차단 목록·UID·잠금 경로·승인 기록을 제공한다.
기본 `HEALTH_CHECKS_ENABLED=false`에서는 접수 capability가 꺼지며 요청은
503이다. 기존 연결 결과 조회는 가능하다. 활성화에는 아래 모든 값이 필요하다.

| 변수                      | 값                                                              |
| ------------------------- | --------------------------------------------------------------- |
| `HEALTH_CHECKS_ENABLED`   | 승인 뒤에만 `true`                                              |
| `HEALTH_DNS_SERVERS`      | 지정 DNS 서버 IP, 쉼표 구분; OS resolver·hosts 파일 미사용      |
| `HEALTH_DENIED_IPS`       | 자체 호스트·서비스의 공개 IP와 추가 금지 IP/CIDR, 쉼표 구분     |
| `HEALTH_WORKER_UID`       | 실제 worker의 비특권 Linux UID, 0 불가                          |
| `HEALTH_WORKER_LOCK_PATH` | worker 소유의 절대 경로; 기본 `/run/eduvibe/health-worker.lock` |
| `HEALTH_ACTIVATION_PATH`  | 승인 기록 JSON의 절대 경로                                      |

승인 후보 빌드와 설정으로 `backend/`에서 템플릿을 생성한다.

```sh
uv run --frozen python -m app.health_runtime > /absolute/private/path/health-activation.pending.json
```

이 명령은 승인하지 않는다. 템플릿의 `approved_by`, `approved_at`은 비어 있고
8개 검증 그룹은 `not_run`이다. 운영자 DomineYH가 해당 빌드·의존성 잠금·송신
설정의 실제 증거를 검토한 뒤 기록을 완성한다. 시간은 시간대가 있는 ISO 8601로
기록하고, 각 그룹은 실제 통과를 나타내는 `pass`와 증거 위치가 필요하다.
코드·migration·`pyproject.toml`·`uv.lock` 또는 송신/DB/UID/잠금 설정이 바뀌면
기록이 일치하지 않아 실행이 꺼진다. 인증의 운영 공개 검수는 별도 계약이다.

## supervisor와 자원 수명

승인 후의 실행 명령은 `uv run --frozen python -m app.health_worker`이다.
API 프로세스 안에 worker를 시작하거나 여러 replica를 실행하지 않는다.
worker는 전체 수명 동안 `flock`을 보유하며 두 번째 프로세스는 claim 전에
실패한다. 잠금 파일은 실행 중 또는 재시작 사이에 삭제하지 않는다.

호스트 supervisor는 다음 조건을 적용한다.

- 비특권 전용 계정, 승인된 UID, migration DB와 SQLite 보조 파일을 읽고 쓸
  최소 권한, 비공개 승인 기록, 같은 잠금 inode를 유지하는 디렉터리.
- 지정 DNS로의 질의와 승인된 HTTP(S) 송신만 허용하고 사설·예약·메타데이터·
  자체 서비스 주소를 차단하는 송신망 정책. 사용자 정의 NAT64 대역은
  `HEALTH_DENIED_IPS`와 송신망에 함께 반영한다.
- SIGTERM 수신부터 강제 종료까지 최대 15초. 기존 검사 기한은 늘리지 않고
  queued 작업을 보존한다. OS가 이전 프로세스의 종료를 확인한 뒤에만 재시작한다.
- 자원 종료를 확인하지 못하면 worker는 잠금을 가진 채 즉시 종료 코드 70으로
  OS 종료한다. supervisor는 정상 종료의 15초 유예를 재적용하지 않고 종료를
  확인한 뒤 재시작한다. 프로세스 전체와 자식도 함께 종료한다.

worker는 최대 3개 검사와 전용 DB 스레드 1개를 사용한다. lease는 갱신 없는
30초이며 heartbeat는 5초, 15초 경과 시 접수를 닫는다. 복구는 종료 확인 후
같은 작업 ID에 최대 2회만 허용하고 claim부터 실제 60초 cooldown을 유지한다.
SIGTERM과 달리 **명시적 기능 중지**는 실행·대기 작업을 취소한다. 승인 기록을
철회하면 실행 중인 worker와 API 정리 루프가 이를 감지한다. 환경 설정으로
중지하려면 false로 전환한 API를 재시작하여 대기 작업을 취소하고 worker도
종료한다. `.env` 파일 편집만으로 실행 중 프로세스의 설정은 바뀌지 않는다.
다시 켜도 취소된 작업을 되살리지 않고 새 요청을 받는다. 이전 연결 결과는 보존한다.

## 활성화 전 실제 호스트 검증

| 기록의 검증 그룹               | 필요한 실제 증거                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `egress_dns_tls`               | 지정 A/AAAA, DNS 고정·재바인딩, TLS Host/SNI·인증서, 자체/금지/변환 주소 송신 차단    |
| `http_headers_deadline`        | HEAD→GET·redirect, HTTPS 복호화 후 누적 32 KiB 헤더 상한, DNS 포함 전체 10초·연결 3초 |
| `resource_cleanup_concurrency` | timeout·취소·비정상 종료의 DNS/HTTP/소켓 종료, 실제 동시 실행 최대 3개                |
| `supervisor_single_worker`     | 중복 worker 거부, 정상 종료 최대 15초, 강제 종료·OS exit 확인 후 재시작               |
| `clock_suspend`                | 실제 VM suspend/reboot 뒤 이전 실행·늦은 저장 차단, 종료 확인 후 복구                 |
| `database_fencing_recovery`    | DB busy·저장 중단·미확정 commit, attempts/lease/url_version fencing과 복구 제한       |
| `api_batch_retention`          | 현재 권한·CSRF·제한·배치 공유·URL/삭제 경합·7일 보관의 배포 구성 결합                 |
| `disable_reenable`             | 명시 중지의 자원 종료·전체 취소·이전 결과 보존과 재활성화 시 비부활                   |

통제 DNS/소켓 테스트는 실제 호스트 증거를 대신하지 않는다. AnyIO/TLS의 이미
대기 중인 호출이 suspend 후 OS I/O를 재개하기 전에 Python 검사에 제어를 넘긴다는
보장도 로컬 테스트로 주장하지 않는다. 실제 VM·송신망 검증 전에는 활성화하지 않는다.

인증 후보의 별도 승인 경계는 [auth-candidate.md](auth-candidate.md)를 따른다.

For service units, persistent locks and manual migration maintenance, see [explicit migration and service lifecycle](migrations.md).

운영 점검·명시 중지·reset HMAC 교체와 수동 재개는 [운영 점검 runbook](operational-checks.md)을 따른다.
