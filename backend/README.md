# Backend

Run commands from `backend/`. Set `APP_ENV` in the process environment; only
development reads this directory's ignored `.env` file.

```sh
uv sync --locked
APP_ENV=development uv run --frozen alembic upgrade head
APP_ENV=development uv run --frozen python -m app.cli seed
APP_ENV=development uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
uv run --frozen ruff check .
uv run --frozen ruff format --check .
# One-time, explicit R15 acquisition outside version control (network required):
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
APP_ENV=development uv run --frozen python -m app.cli prepare-password-blocklist
# Tests below reuse that verified source offline:
APP_ENV=test uv run --frozen pytest
```

Tests that start the API provide their own temporary `DATABASE_PATH` and
`PUBLIC_ORIGIN`. The API refuses to start until an explicit migration leaves
the file at the current Alembic head.

The seed command adds only missing synthetic development rows to
`storage/development.sqlite3`. It requires that explicit migration and an
interactive terminal; when a seeded member is missing, one shared password is
read twice without echo and stored as a hash.

## T01 authentication preparation

The ordinary app keeps every authentication capability disabled. Only the
`APP_ENV=test` app factory's `auth_testing=True` boundary exercises preparation;
it implements T01–T03 only (see the sections below).

Migration `0003_auth_identity` preserves member/app IDs and ownership. For an
existing database, provide `AUTH_MEMBER_BACKFILL=/absolute/path/history.json`:
a JSON object keyed by member ID, containing verified `created_at`, `updated_at`
and `first_approved_at` timestamps with explicit UTC offsets. Pending members
require `first_approved_at: null`; approved/revoked members require the original
first approval time. Unknown password hashes additionally require the explicit
`password_hash_policy: "unusable"` classification; the stored value is preserved
and is never converted to a password. Missing history, invalid login IDs or
normalized collisions stop the migration transaction. Correct the source data
with an audited decision before retrying; do not invent dates or passwords.
Keep this backfill file and database backups outside version control.

Before serving a restored backup, run the following **against the restored,
verified database while the server is stopped**:

```sh
uv run --frozen python -m app.cli invalidate-restored-auth
```

This revokes every restored S/R/flow and cancels pending permits before readiness;
it neither replays transitions nor extends successful-session clocks. Reapply
subsequent member deletions according to the operating backup procedure. The
local contract test uses only a temporary SQLite file, not an operating backup.

## T02 member login, session restore and logout

On the same `APP_ENV=test` boundary, `POST /auth/login`, `GET /auth/me` and
`POST /auth/logout` are live; the ordinary app keeps every capability off. The
boundary advertises `auth_login`, `auth_logout` and `auth_password_change` as the
verified T01–T03 bundle.

Passwords are verified with pwdlib's recommended Argon2id profile (RFC 9106
low-memory: m=64 MiB, t=3, p=4) outside any write transaction, behind a gate of
2 concurrent and 4 queued hashes with a 1 s queue wait (saturation is
`503 AUTH_BUSY` + `Retry-After: 1`). These values are test candidates; real-host
timing is measured at the T07 operating gate, not assumed. Login failures are
counted per account+IP (10) and per IP (200) over a rolling 15 minutes in SQLite;
blocked requests add no events. A full session lasts at most 8 hours and 30
minutes of inactivity; `me`, `csrf` and `flow-state` never extend it.

Synthetic Argon2 members for tests live in `tests/support.py`
(`populate_auth_members`); the API E2E runner inserts them once with the other
fixtures. Their shared password is a test-only constant, never a seed default.


## T03 administrator credentials and own password change

First run the explicit migration to `0004_session_recent_auth`. Individually
prepare the fixed R15 list in a private path outside version control:

```sh
export APP_ENV=development
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
uv run --frozen python -m app.cli prepare-password-blocklist
uv run --frozen python -m app.cli bootstrap-admin
# Only for an existing administrator:
uv run --frozen python -m app.cli recover-admin
```

The list source/version/digest remain the fixed R15 metadata. API startup never
fetches it; `auth_testing=True` refuses a missing or corrupt list. Tests and the
API E2E runner require an explicitly prepared
`PASSWORD_BLOCKLIST_PATH`, validate the unchanged full source and copy it into
private test-owned temporary files. They never acquire it from the network.
Public backend contracts do not require the list. CI provisions it in a separate
setup step before tests; local runs use the one-time command above. Export the
same path before frontend `npm run test:e2e:api`. No list or derived
password material is committed or packaged. Redistribution rights remain U02
at T07. `PASSWORD_BLOCKLIST_PATH` defaults to `password-blocklist-ncsc.txt` next to
the database; always keep both outside version control.

The administrator CLI requires stdin/stdout TTY, reads/confirm passwords without
echo, asks for explicit `YES`, and supplies no credential argument/environment
option. Bootstrap requires zero administrators and rejects a login ID collision;
recovery targets only an existing administrator. The credential, member version,
recovery session revocations and minimal audit commit together; audit failure
rolls everything back. Running these commands against operating accounts is a
separate operator action, not authorized by the implementation ticket.

A temporary credential lasts 24 hours. Login issues only `change_only`, expiring
at the earlier of login+15 minutes or the credential deadline. Its Self omits
contact fields and recent auth. The existing password card submits no confirmation.
A successful own change consumes the credential, increments the member version,
revokes all restricted sessions and issues full S only to the completing browser.
Its 8-hour absolute/30-minute inactivity and administrator 15-minute recent-auth
windows begin at the change; ordinary later login does not open recent auth.
A lost reply uses the original transition and cookie observation, never replays
the change, and discards only that unreceived result S. Ordinary auth capabilities
stay off; administrator reauth/reset/deletion and signup stay unavailable.

### T04 가입과 최초 승인 대기 정리

가입 API는 T05 전까지 일반 실행에서 비활성이다. `APP_ENV=test`의 기존
prepared factory만 `auth_register`를 켜며 선택 이메일·연락처는 저장하지 않는다.
가입은 현재 익명 S/CSRF·흐름/순번/세대를 최종 commit에서 재검사하고 S를 유지한다.
실행권/인증 전환을 새로 만들지 않는다. Origin/CSRF를 통과한 요청은 필드 오류·중복도
포함해 IP당 rolling 100/시간 슬롯을 write lock에서 예약한다. 차단은 집계하지 않는다.

`0005_member_approval`은 이미 적용한 T03의 `0004_session_recent_auth` 뒤에 추가한다.
기존 회원/아카이브 앱/가입일/승인 이력은 고치지 않는다. 승인 작업키 schema만 준비하며
작업키 API·승인 실행·관리자 화면은 T05 범위다.

```sh
uv run --frozen alembic upgrade head
uv run --frozen python -m app.cli sweep-pending
```

정상 시작과 매 60초 유지관리에서도 같은 정리를 실행한다. 가입일부터 90달력일의
경계(UTC 가입 시각 + 90일)부터, 현재 pending·최초 승인 이력 없음·일반 회원만 삭제한다.
최종 `BEGIN IMMEDIATE` 안에서 후보를 읽으므로 승인 선확정은 보존한다. 승인 해제 회원은
최초 대기 삭제 대상이 아니다. 기한 도달 후 정리 전 로그인도 INVALID_CREDENTIALS다.

재삭제 원장은 운영 DB와 분리된 `<DATABASE_PATH stem>.deletions.sqlite3`(0600)다.
운영 DB write lock을 잡은 동안 독립 SQLite FULL commit으로 회원/앱 식별자와 intent
시각을 먼저 기록한다. intent만으로 삭제 성공이나 삭제 권한 확정을 선언하지 않는다
(R9 Q38, R24 §8). 미완료 intent replay도 같은 최종 lock 안에서 현재 최초 승인 이력·pending·
가입 기한·일반 회원 자격을 재확인한다. 승인 선확정 등으로 자격을 잃었으면 회원·앱·
세션/흐름/작업키를 건드리지 않고 원장 deletion_cancellations에 종류·ID·취소 시각·
안전한 사유 코드(APPROVAL_COMMITTED 등)만 감사 이력으로 기록하고 해당 활성 intent를
제거한다. 취소를 회원/앱의 영구 면제로 사용하지 않는다. 이후 sweep의 현재 상태가 다시
최초 대기 만료 자격이면 새 intent를 기록해 삭제한다(R9 Q16/Q40). 같은 ID의 반복 취소도
개별 감사 행으로 남기며 기존 고유 키 원장은 이력을 보존한 채 원자적으로 전환한다.
취소 당시 운영 member_deletions/app_deletions에는 삭제 성공을 기록하지 않고, 실제
완료된 삭제 원장과 mirror는 보존한다. 미완료 앱 intent는 현재 소유자가 같은 삭제 자격을
갖추거나 이미 없는 경우만 적용한다. 실제 운영 commit 이후 독립 completed_deletions에
최소 종류·ID만 완료 증명으로 기록하며, 둘 다 확정돼야 성공을 보고한다(R9 Q38).
완료 증명이 있는 회원·앱은 복원 시 현재 시계·만료 자격과 무관하게 재삭제한다(R9 Q40).

서비스와 운영자 CLI가 동시에 실행될 수 있다. 운영 DB 반영 실패 시 서비스 유지관리는
readiness를 거절하지만 별도 CLI 실패가 실행 중 서비스의 readiness를 자동 변경하지는
않는다. 따라서 이후 승인 commit을 포함한 현재 상태 재확인이 필수다. intent/취소
기록 실패는 운영 삭제 전에 실패한다. 완료 증명 기록 실패는 운영 commit 이후에도
가능하므로 CLI 실패여도 실제 삭제는 끝났을 수 있다. 이 경우 운영 DB를 복원하기 전에
현재 DB에서 sweep을 재실행한다. 운영 삭제 mirror로 완료 증명을 복구하며, 성공을
확인한 뒤에만 복원한다. 연락처·원문·비밀번호·토큰은 기록하지 않는다.

백업 복원은 운영 DB만 복원하고 **현재 독립 원장을 복원하거나 덮어쓰지 않는다**.
서비스를 중지한 상태에서 기존 `invalidate-restored-auth` 명령을 실행한다. 현재 원장이
없거나 검증 불능이면 거절한다. 재삭제를 적용한 후 모든 과거 인증 권한/허가를 폐기하고,
가입/세션의 원래 시계를 유지한다. 공급자 사본 전체 목록·30일 만료 증거가 확인된 뒤
7일을 계산하는 운영 절차는 T07 공개 gate다. 현재 증거가 없으므로 최소 재삭제 기록은
자동 제거하지 않는다. 운영 DB와 함께 원장까지 과거로 되돌리는 복원은 지원하지 않는다.

T07 운영 공개 전에 원장과 SQLite sidecar를 운영 DB의 디렉터리/볼륨 백업·복원 대상과
다른 저장소에 배치하고 접근 권한·복원 분리를 검증해야 한다. 기본 sibling 경로만으로
독립 저장소나 볼륨 snapshot rollback 탐지를 보장하지 않는다. 현재 경로의 원장은
독립 mount 등 운영 배치로 보존하며 해당 운영 검수를 로컬 green으로 대체하지 않는다.

### T05 실제 관리자 승인·승인 해제

T04의 `0005_member_approval` schema와 T01~T03의 full S/흐름/순번/세대/CSRF 경계를
재사용한다. `APP_ENV=test` prepared factory에서는 `auth_register`,
`admin_users_read`, `admin_approval`, `admin_summary`를 묶음으로 활성화한다.
일반 실행은 T07 공개 gate 전까지 인증을 열지 않는다. 새 phase flag는 없다.

현재 full 관리자는 `/admin/users`(페이지·전체 stats), `/admin/users/{id}`를 읽고,
`POST /write-operations`의 `kind=user_approval`로 별도 업무 키를 발급한다.
`PATCH /admin/users/{id}/approval`은 명시 승인값·expected_account_version과
Idempotency-Key가 발급 입력과 같아야 한다. 성공·거절 키의 재실행은
OPERATION_ALREADY_RESOLVED이며 원래 키를 조회한다. `GET /write-operations/{key}`와
`POST /write-operations/{key}/cancel`도 현재 full 관리자와 키 소유를 확인한다.
승인에는 recent-auth를 추가 요구하지 않는다. 관리자 대상은 보호한다.

회원 버전·최초 승인 이력·승인값·승인 해제 시 전체 대상 세션 폐기·최소 감사·성공
결과는 하나의 BEGIN IMMEDIATE/commit이다. 충돌은 rejected 결과를 기록하며,
감사/결과 저장 실패는 부분 승인이나 세션 폐기 없이 rollback한다. 같은 값의 새
승인도 버전을 증가시킨다. 업무 키는 발급 후 24시간부터 실행/조회/취소할 수 없고
기존 60초 유지관리에서 정리한다. 재시작은 키를 보존하고 백업 복원 무효화 CLI는
과거 업무 키도 제거한다. 결과/감사는 대상 회원 삭제 CASCADE에 귀속되지 않는다.

```sh
APP_ENV=test uv run --frozen pytest tests/contracts/test_admin_approval.py tests/test_approval_races.py
```

비밀번호 초기화·회원 삭제·관리자 재인증·아카이브 앱 관리 실행은 후속 범위다.
[T05 검수 원장](../docs/evidence/phase-3/issue119/2026-10-02/README.md)에 실제 HTTP,
파일 SQLite, 브라우저 쿠키, 응답 유실, 경합과 재현 명령을 기록한다.

### T07 credential retirement

Apply `0006_retired_credentials` explicitly with `uv run --frozen alembic upgrade head`
before starting the upgraded API. This migration preserves exact issued-cookie-name
fences after credential material is removed. It is irreversible: restore a separately
verified backup instead of downgrading. The scheduled sweep now also removes expired
or revoked S/R generations inside live flows within the R9 Q18 retention bound;
clearing an obsolete reference does not alter a newer pending transition or revision.
