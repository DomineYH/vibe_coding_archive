# Backend

명령은 `backend/`에서 실행한다. 처음 한 번 `.env.example`을 `.env`로 복사하고
값을 편집한다. 기존 `.env`는 덮어쓰지 않으며 이 파일은 버전 관리에서 제외한다.
개발과 운영 모두 `.env`를 읽고, 프로세스 환경 변수가 파일 값보다 우선한다.
프로세스 `APP_ENV`가 없거나 비어 있으면 파일의 `APP_ENV`를 사용하며 두 곳 모두
없으면 실행을 거절한다. 편집한 설정을 적용하려면 서버를 재시작한다.

```sh
# 기존 .env가 없을 때만 복사:
if [ ! -e .env ]; then cp .env.example .env; fi
uv sync --locked
uv run --frozen alembic upgrade head
# One-time, explicit R15 acquisition outside version control (network required):
# 사용자 지정 경로는 .env의 PASSWORD_BLOCKLIST_PATH에 절대 경로로 설정:
# PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
uv run --frozen python -m app.cli prepare-password-blocklist
uv run --frozen python -m app.cli seed
uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
uv run --frozen ruff check .
uv run --frozen ruff format --check .
# Tests below reuse that verified source offline:
APP_ENV=test uv run --frozen pytest
```

개발 `DATABASE_PATH`의 상대 경로는 저장소 루트 기준이다.
`PASSWORD_BLOCKLIST_PATH`의 상대 경로는 현재 작업 디렉터리 기준을 유지하므로
사용자 지정 경로는 절대 경로를 권장한다. uvicorn도 준비 명령과 같은 경로를
사용해야 하며 `.env`에 설정하면 두 명령에 함께 적용된다.

실사용 전환은 `.env`의 `APP_ENV=production`과 DB/origin을 함께
변경한다(`.env.example`의 주석 예시 참고). 운영 DB는 저장소 및 임시 디렉터리
밖의 절대 경로여야 하고, `PUBLIC_ORIGIN`은 비로컬 HTTPS origin이어야 한다.
명시적 migration은 계속 필요하며 자동 실행하지 않는다. 운영 API는 인증이
비활성인 동안 차단 목록을 읽지 않는다. 운영 API의 차단 목록 경로 설정과 준비는
운영 인증을 활성화할 때만 필요하다.
셸에 남은 환경 변수가 파일보다 우선하므로 전환 시 확인한다. 필요하면
`APP_ENV=development uv run --frozen ...`처럼 명령별로 덮어쓸 수 있다.

**주의:** `backend/.env`가 `APP_ENV=production`이면 접두어 없는 `alembic upgrade head`, `bootstrap-admin`, `recover-admin`, `sweep-pending`, `invalidate-restored-auth` 명령은 운영 DB를 대상으로 하므로 실행 전에 적용될 `APP_ENV`를 확인한다.

시험은 프로세스에 `APP_ENV=test`를 명시하며 `.env`를 읽지 않는다. 파일에만
`APP_ENV=test`를 쓰면 실행을 거절한다. 시험 DB/origin은 별도로 명시해야 한다.

Tests that start the API provide their own temporary `DATABASE_PATH` and
`PUBLIC_ORIGIN`. The API refuses to start until an explicit migration leaves
the file at the current Alembic head.

The seed command adds only missing synthetic development rows to
`storage/development.sqlite3`. It requires that explicit migration and an
interactive terminal; when a seeded member is missing, one shared password is
read twice without echo and stored as a hash.

개발 seed의 승인 회원 `seed-member-one`, `seed-member-two`는 위에서 입력한
공유 비밀번호로 로그인한다. 고정 기본 비밀번호는 없으며 기존 회원의 비밀번호는
갱신하지 않는다. 관리자가 필요하면 선택적으로
`uv run --frozen python -m app.cli bootstrap-admin`을 실행하고,
브라우저 로그인 뒤 본인 비밀번호를 변경한다.

## T01 authentication preparation

`APP_ENV=development`에서는 검증된 T01~T05 실제 인증을 기본 활성화한다.
`auth_login`, `auth_logout`, `auth_password_change`, `auth_register`,
`admin_users_read`, `admin_approval`, `admin_summary`, `apps_create`, `apps_update_own` 아홉 capability를 켠다.
`APP_ENV=test`는 기존 factory의 `auth_testing=True`일 때만 켜며 이 인자는
시험 환경에서만 허용한다. `APP_ENV=production`은 인증을 계속 비활성화한다.
T07/G01~G18 운영 공개 검수는 보류 상태다.

프런트는 `npm run dev:api`로 실행한다. 기본 `PUBLIC_ORIGIN`은
`http://localhost:5174`이며 다른 host/port를 쓰면 정확히 맞춰야 한다.
명시적 HTTP localhost/loopback만 개발 쿠키의 Secure 예외를 사용한다.
Origin/CSRF 검사는 유지하며 비 loopback HTTP에는 예외를 적용하지 않는다.
기동 후 인증 조정/정리 실패는 `/readyz` 503, 인증 capability 비활성 및 인증 API
503으로 닫힌다. `/healthz`와 공개 읽기는 유지한다. 개발에서도 실제 DB와 아래
재삭제 원장을 사용하므로 원장을 삭제하거나 DB와 함께 과거로 덮어쓰지 않는다.

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

개발 환경과 `APP_ENV=test`의 prepared 경계에서 `POST /auth/login`,
`GET /auth/me`, `POST /auth/logout`이 동작한다. `auth_login`, `auth_logout`,
`auth_password_change`는 검증된 T01~T05 묶음에 포함하며 운영 환경은 계속 끈다.

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
# .env: APP_ENV=development, PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
uv run --frozen python -m app.cli prepare-password-blocklist
uv run --frozen python -m app.cli bootstrap-admin
# Only for an existing administrator:
uv run --frozen python -m app.cli recover-admin
```

차단 목록의 출처/버전/digest는 고정 R15 메타데이터를 유지한다. API 기동은
목록을 내려받지 않는다. 개발 환경과 `auth_testing=True`는 차단 목록 누락·무결성
실패 시 기동을 거부한다. 개발자는 `backend/`에서
`uv run --frozen python -m app.cli prepare-password-blocklist`로
명시적으로 준비한다. Tests and the API E2E runner require an explicitly prepared
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
the change, and discards only that unreceived result S. 개발 및 prepared 시험 환경은
가입까지 활성화하며 운영 인증과 관리자 재인증/초기화/삭제는 계속 비활성이다.

### T04 가입과 최초 승인 대기 정리

개발 환경과 `APP_ENV=test`의 기존 prepared factory는 T01~T05 묶음으로
`auth_register`를 켜며 선택 이메일·연락처는 저장하지 않는다. 운영 환경은 계속 끈다.
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
재사용한다. 개발 환경과 `APP_ENV=test` prepared factory에서는 `auth_register`,
`admin_users_read`, `admin_approval`, `admin_summary`를 묶음으로 활성화한다.
운영 실행은 T07 공개 gate 전까지 인증을 열지 않는다. 새 phase flag는 없다.

현재 full 관리자는 `/admin/users`(페이지·전체 stats), `/admin/users/{id}`를 읽고,
`POST /write-operations`의 `kind=user_approval`로 별도 업무 키를 발급한다.
`PATCH /admin/users/{id}/approval`은 명시 승인값·expected_account_version과
Idempotency-Key가 발급 입력과 같아야 한다. 성공·거절 키의 재실행은
OPERATION_ALREADY_RESOLVED이며 원래 키를 조회한다. 승인 키의 `GET /write-operations/{key}`와
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

승인된 full 회원(관리자 포함)은 `POST /write-operations`의 `kind=app_create`와
`input=AppInput`으로 키를 발급하고, 같은 입력과 `Idempotency-Key`로 `POST /apps`를
실행한다. Origin·CSRF·flow·revision·세션 세대 검증을 거치며 작성자는 서버 세션에서
정한다. 앱·학년·초기 `unchecked` 연결 결과·성공 작업 결과는 같은 트랜잭션으로 저장한다.
등록은 같은 키·정규화된 입력의 재전송에 201과 같은 앱을 반환하고, 다른 입력은 409,
다른 회원의 키·모르는 키는 404, 만료된 소유 키는 410이다. 앱 키 조회는 현재 승인된
full 발급 회원만 가능하며 입력·해시를 공개하지 않는다. 작업 응답은 `private, no-store`,
생성·편집 응답은 `no-store`이다. 키는 24시간 유효하며 승인 키와 같은 정리·복원 무효화에 참여한다.
앱 키의 승인 실행·취소는 허용하지 않는다.

편집은 `kind=app_update`, `target_id`, `expected_version`, `input=AppPatch`로 키를 발급하고
같은 조건·부분 입력과 `Idempotency-Key`로 `PATCH /apps/{id}`를 실행한다. 승인 full 소유자만
가능하며 관리자도 자기 앱만 편집한다. 생략 필드는 유지하고 기술 스택의 명시적 null은
삭제한다. 같은 값·공개 여부만의 편집도 version을 1 증가시키며, 실행 충돌은 앱을 바꾸지
않고 `rejected` 최소 결과로 확정한다. 확정된 같은 요청의 재전송은 409
`OPERATION_ALREADY_RESOLVED`이며 기존 키 결과 조회로 복구한다. 응답 유실·일시 장애는
새 키로 자동 제출하지 않는다. URL 저장 문자열에서 fragment 이외가 바뀌면 url_version을
1 증가시키고 연결 결과를 unchecked·검사 시각/신선도 null로 초기화한다. fragment만의 변경은
연결 결과를 유지한다. 공개 전환은 같은 PATCH이며 공개 목록·상세 권한에 즉시 반영된다.

개발 환경에서는 로그인 후 `/apps/new`에서 공개 앱(예: `https://www.naver.com`)을 등록하고
상세·새로고침·비로그인 갤러리를 확인할 수 있다. 비공개 앱은 작성자·관리자만 상세를 볼 수
있고 공개 목록·검색·facets·total에는 나타나지 않는다. `/apps/{id}/edit`에서 편집·공개 전환을
확인한다. 운영 환경 등록·편집은 계속 비활성이고 Phase 4 전체 수락은 별도 검수다.
앱 생성·PATCH 본문과 `app_create`·`app_update` 발급 본문은 1MiB, 그 외 인증·관리자 쓰기 본문은 16KiB로
스트리밍 수신 단계에서 제한한다. 기본 포트(`http:80`, `https:443`)는 허용하고 사용자 정보,
localhost·사설 IP·다른 포트는 URL 파싱 후 거부한다. IPv4-mapped/compatible IPv6의 내장
IPv4에도 기존 IPv4 차단 대역을 적용하며 공개 내장 IPv4는 허용한다. 빈 사용자 정보는
파서가 authority로 해석하는 모든 표기에서 거부하되 경로·query·fragment의 `@`는 허용한다.
DNS·HTTP 연결 검사는 하지 않는다.

`0008_app_update` 마이그레이션은 기존 승인·등록 작업 행과 앱 데이터를 보존하며 편집의
버전 조건·최소 결과 제약을 추가한다. 병합 후 개발 DB는 서버와 쓰기 작업을 멈추고 유효한
SQLite 백업을 만든 뒤 `alembic upgrade head`로 갱신한다. `foreign_key_check`, head, 기존
데이터와 `/readyz`·`/meta`의 `apps_create`·`apps_update_own`을 확인한다. 실제 개발 DB는
테스트 대상으로 사용하지 않는다. head가 아니면 서버는 시작하지 않는다.
스키마 downgrade로 작업 이력을 버릴 수 없으며, 복구는 검증된 백업과 독립 삭제 원장,
기존 복원 인증 무효화 절차를 따른다.

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
