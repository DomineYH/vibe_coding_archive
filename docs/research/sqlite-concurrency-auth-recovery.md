# SQLite 동시성·인증 저장·복구 아키텍처 및 제약 조사 보고서

## 1. 개요 및 조사 목적

본 보고서는 Issue #4 및 [PRD v1.0](../../PRD/PRD_EduVibe_Archive_v1.0.md)에서 채택된 기술 스택(FastAPI, SQLAlchemy 2 계열, Alembic, Python `sqlite3`, SQLite)을 기반으로, 단일 호스트 환경에서 세션 폐기, 원자적 앱 쓰기, 지속형 백그라운드 검사 작업, 온라인 백업을 안전하게 병행 운용하기 위한 외부 1차 검증 자료(Primary Sources) 기반의 기술적 제약, 동작 조건 및 복구 절차를 정의한다. Python 3.12.3과 SQLite 3.45.1은 조사 시 검증 환경이지 PRD가 확정한 최소 버전이 아니다.

본 조사는 SQLite를 다른 분산 RDBMS로 교체하지 않는다는 전제하에 진행되었으며, 모든 기술적 주장은 SQLite, Python, SQLAlchemy, FastAPI, Alembic, OWASP, IETF RFC 등의 공식 1차 출처에 근거한다.

---

## 2. 런타임 호환 버전: 기능 요구 하한과 검증 환경

특정 패치 버전을 공식 근거 없이 임의의 필수 하한으로 규정하지 않으며, 본 보고서에서는 공식 1차 출처로 기능 도입 시점이 입증된 **공식 근거 기능 최소 하한(Proven Functional Minimum)**과, PRD가 채택한 사양(SQLAlchemy 2 계열), 그리고 공식 문서상 경계가 특정되지 않아 구현 단계에서 확정할 **미확정 / 후속 lockfile 후보 버전**을 명확히 구분하여 정의한다.

| 구성 요소 | 공식 근거 기능 최소 하한 | 검증 환경 및 lockfile 후보 | 주요 기능 요구 및 버전 근거 (1차 출처) |
|---|---|---|---|
| **Python** | 3.7+ (권장: 3.12+) | 3.12.3 | [Python sqlite3 공식 문서](https://docs.python.org/3/library/sqlite3.html)<br>- 3.7+: `sqlite3.Connection.backup()` 온라인 백업 API 공식 내장<br>- 3.12+: PEP 249 트랜잭션 호환 `autocommit` 매개변수 도입 |
| **SQLite (C-API)** | 3.8.0+ | 3.45.1 | [SQLite WAL](https://www.sqlite.org/wal.html), [SQLite Partial Index](https://www.sqlite.org/partialindex.html)<br>- 3.7.0+: WAL 모드 지원<br>- 3.8.0+: 활성 작업 격리를 위한 Partial Index 지원<br>- 3.24.0+: UPSERT 지원 |
| **SQLAlchemy** | 2.0 계열 (PRD §5 채택 고정) | 2.0.35+ | [SQLAlchemy 2.0 SQLite Dialect](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html)<br>- PRD §5 채택 사양: 2.0 스타일 명시적 트랜잭션 제어, `connect` 리스너를 통한 Per-connection PRAGMA 주입, `version_id_col` 낙관적 락 지원 |
| **FastAPI** | 미확정 (공식 최소 경계 미입증, 후속 lockfile 고정) | 0.115.x (후보) | [FastAPI SQL Databases 튜토리얼](https://fastapi.tiangolo.com/tutorial/sql-databases/), [FastAPI Async](https://fastapi.tiangolo.com/async/)<br>- 동기 핸들러(`def`)의 AnyIO 워커 스레드풀 분기 및 Depends 세션 라이프사이클 격리 |
| **Alembic** | 미확정 (공식 최소 경계 미입증, 후속 lockfile 고정) | 1.14.x (후보) | [Alembic Batch Migrations](https://alembic.sqlalchemy.org/en/latest/batch.html)<br>- SQLite `ALTER TABLE` 제약 극복을 위한 `render_as_batch=True` ("move and copy") 워크플로우 지원 |
| **pwdlib & argon2-cffi** | 미확정 (공식 최소 경계 미입증, 후속 lockfile 고정) | pwdlib 0.2.1 / argon2-cffi 23.x (후보) | [pwdlib GitHub 공식 저장소](https://github.com/frankie567/pwdlib), [argon2-cffi 파라미터](https://argon2-cffi.readthedocs.io/en/stable/parameters.html)<br>- Argon2id 바인딩 및 패스워드 해싱 구현체 |

---

## 3. SQLite 동시성 제어 및 트랜잭션 동작 모델

### 3.1 WAL(Write-Ahead Logging) 모드 특성 및 한계
- **원리 및 읽기/쓰기 분리**:
  - [SQLite WAL 공식 문서](https://www.sqlite.org/wal.html)에 명시된 바와 같이, WAL 모드(`PRAGMA journal_mode=WAL;`)에서는 변경 사항이 기본 DB 파일 대신 별도의 `-wal` 파일에 기록됩니다.
  - **읽기 작업은 쓰기 작업을 차단하지 않으며, 쓰기 작업 또한 읽기 작업을 차단하지 않습니다(Readers do not block writers, and writers do not block readers)**.
- **단일 쓰기 스레드 제약 (Single Writer)**:
  - WAL 모드에서도 SQLite는 **동시에 오직 하나의 쓰기 트랜잭션**만 허용합니다. 둘 이상의 연결이 동시에 쓰기를 시도하면 락 경합이 발생합니다.
- **네트워크 파일시스템(NFS/SMB) 미지원**:
  - [SQLite WAL 공식 문서](https://www.sqlite.org/wal.html)는 "WAL does not work over a network filesystem"이라고 명시하고 있습니다.
  - WAL 모드는 공유 메모리(`-shm`)와 로컬 POSIX 파일 잠금에 의존하기 때문에 모든 접근 프로세스가 동일 호스트에 위치해야 하며, 공식적으로 네트워크 파일시스템 환경은 지원되지 않습니다. 따라서 단일 호스트의 로컬 파일시스템(NVMe/SSD)에서 운용해야 합니다.

### 3.2 `busy_timeout` 동작과 `BEGIN IMMEDIATE`의 역할 및 한계
- **락 에스컬레이션과 교착 상태(Deadlock) 방지**:
  - [SQLite Locking 공식 문서](https://www.sqlite.org/lockingv3.html) 및 [SQLite Transaction 공식 문서](https://www.sqlite.org/lang_transaction.html)에 따르면, 기본 트랜잭션 시작문인 `BEGIN`은 `BEGIN DEFERRED`로 동작합니다.
  - 두 트랜잭션(Tx1, Tx2)이 `BEGIN DEFERRED` 상태에서 각각 `SELECT`를 수행하면 둘 다 `SHARED` 락을 획득합니다.
  - 이후 Tx1이 `UPDATE`를 실행하여 `RESERVED` 락으로 승격한 후 커밋을 시도(`EXCLUSIVE` 락 필요)할 때, Tx2가 여전히 `SHARED` 락을 유지하고 있고 Tx2 또한 `UPDATE`를 시도하는 순간 상호 잠금 대기가 발생합니다.
  - `BEGIN DEFERRED` 도중 락 승격(Lock Escalation) 과정에서 발생하는 교착 상태는 `PRAGMA busy_timeout`의 대기 로직을 우회하여 즉시 `sqlite3.OperationalError: database is locked`를 반환합니다.
- **`BEGIN IMMEDIATE`의 역할과 런타임 한계**:
  - 트랜잭션 시작 시 `BEGIN IMMEDIATE`를 명시하면 시작 즉시 `RESERVED` 락을 획득하므로 락 승격 교착 상태를 예방하고, 후행 트랜잭션이 `busy_timeout` 동안 정상 대기하도록 유도합니다.
  - **그러나 `BEGIN IMMEDIATE + busy_timeout`이 경합이나 `SQLITE_BUSY` 발생을 완전히 방지하지는 못합니다**. 선행 쓰기 트랜잭션이 길어져 대기 시간이 `busy_timeout`(예: 5000ms) 상한을 초과하면 여전히 `SQLITE_BUSY` 오류가 발생합니다.
- **짧은 트랜잭션 원칙과 503/재시도 방어 계약**:
  - 외부 HTTP 호출(연결 검사), 비밀번호 해싱 연산 등 시간 소요가 큰 작업은 쓰기 트랜잭션 밖에서 수행하고, DB 쓰기 트랜잭션은 수 밀리초 이내로 극히 짧게 유지하여 즉시 커밋해야 합니다.
  - `busy_timeout` 초과로 잠금 획득에 실패했을 때 무한 대기나 예기치 않은 500 오류 대신, 애플리케이션 계층에서 통제된 `HTTP 503 Service Unavailable` 및 `Retry-After` 헤더를 반환하여 클라이언트가 적절한 백오프(Backoff) 후 재시도하도록 안내하는 설계가 필수적입니다.

### 3.3 Python `sqlite3` 및 SQLAlchemy 2.0 연결/풀링 설정
- **Per-connection PRAGMA 주입**:
  - SQLite의 `foreign_keys` 및 `busy_timeout` 설정은 연결 단위(Per-connection)로 적용됩니다.
  - [SQLAlchemy 2.0 SQLite Dialect](https://docs.sqlalchemy.org/en/20/dialects/sqlite.html) 공식 권장에 따라 Engine의 `connect` 이벤트 리스너를 통해 모든 새 연결에 PRAGMA를 주입해야 합니다:
    ```python
    from sqlalchemy import event, create_engine
    from sqlalchemy.engine import Engine

    @event.listens_for(Engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA busy_timeout = 5000")
        cursor.close()
    ```
- **스레드 모델에 따른 `check_same_thread=False` 한정 요건**:
  - Python `sqlite3.threadsafety`는 3(Serialized)이지만, 기본 드라이버는 생성 스레드에서만 연결을 사용하도록 `check_same_thread=True`로 보호합니다([Python sqlite3](https://docs.python.org/3/library/sqlite3.html)).
  - 본 프로젝트에서 FastAPI의 동기 라우트 핸들러(`def`)가 AnyIO 워커 스레드풀을 통해 서로 다른 스레드에서 실행되면서, SQLAlchemy의 커넥션 풀(`QueuePool` 등)이 관리하는 동일한 DBAPI 연결을 요청 간에 스레드를 넘나들며 공유·재사용하는 세션/스레드 풀링 모델을 채택할 때에 한해 `connect_args={"check_same_thread": False}` 설정이 필요합니다([FastAPI SQL Databases](https://fastapi.tiangolo.com/tutorial/sql-databases/)).
- **SQLAlchemy 트랜잭션 제어**:
  - SQLAlchemy 2.0에서는 자동 `BEGIN` 처리를 커스텀하여 쓰기 세션 진입 시 `BEGIN IMMEDIATE`를 발행하도록 설정할 수 있습니다.

---

## 4. 데이터 무결성 보장 및 원자적 연산 한계

### 4.1 가입 중복 및 정규화 키 보장
- **제약 및 한계**:
  - SQLite의 `UNIQUE` 제약([SQLite Foreign Keys and Constraints](https://www.sqlite.org/foreignkeys.html))은 바이트 또는 바이너리/NOCASE照合(Collation) 단위로 작동합니다.
  - 유니코드 정규화(NFC) 및 한국어/다국어 대소문자 구분을 DB 레벨의 단순 `UNIQUE(login_id)`로 완벽히 보장할 수 없습니다.
- 테이블에 원본 `login_id` 외에 애플리케이션 레벨에서 `unicodedata.normalize('NFC', raw_id).casefold().strip()` 처리된 `login_id_key` 컬럼을 생성하고, `login_id_key VARCHAR(64) UNIQUE NOT NULL` 제약을 적용하여 동시 가입 시도의 경쟁 조건(Race Condition)을 원자적으로 차단합니다.

### 4.2 생성 멱등성 (Idempotency Key) 보장 및 동시성 한계
- **보장 범위 및 UNIQUE 제약**:
  - 네트워크 재시도로 인한 동일 요청의 다중 생성을 방지하기 위해 `idempotency_keys` 테이블을 운용합니다([RFC 9110 HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)).
  - `(user_id, key) UNIQUE` 복합 제약을 통해 동일 사용자의 중복 키 요청 시 오직 한 트랜잭션만 `INSERT`에 성공합니다.
- **동시 인플라이트(in-flight) 요청의 한계와 필수 계약**:
  - 단순히 `(user_id, key) UNIQUE` 제약만으로는 선행 요청이 아직 커밋되지 않고 처리 중인 시점에 유입된 동시 요청에 대해 기존 `app_id`의 즉시 반환을 보장할 수 없습니다. 두 번째 트랜잭션이 `IntegrityError`를 포착하더라도, 선행 트랜잭션이 아직 롤백될 수 있거나 DB에 `app_id`가 커밋되기 전이므로 안전한 조회가 불가능합니다.
  - 따라서 다음과 같은 세부 제어 계약이 병행되어야 합니다:
    1. **페이로드 정합성 검증 (`request_hash`)**: 동일 키로 상이한 본문이 요청된 경우 `409 Conflict`를 즉시 반환.
    2. **명시적 진행 상태 관리 (`status`)**: `in_progress`와 `completed` 상태를 구분 기록.
    3. **진행 중 응답 계약**: 선행 요청이 `in_progress`인 동안 유입된 중복 요청에는 미완성 데이터를 반환하지 않고, `409 Conflict` 또는 `202 Accepted` 등 후속 API 계약에서 결정할 명시적 진행 중 상태 코드를 반환합니다. 이때 `Retry-After` 헤더를 부가하여 클라이언트의 재시도를 안내할 수 있으나, 클라이언트 라이브러리의 `Retry-After` 준수 및 적절한 지수 백오프(Exponential Backoff) 구현 여부는 클라이언트 연동 검증 대상(Client Verification Target)으로 남겨야 합니다. 선행 요청이 성공 커밋되어 `status='completed'`로 확정된 이후의 재시도에 한해 저장된 동일 결과(`201 Created` DTO)를 안전하게 반환합니다.

### 4.3 낙관적 동시성 제어 (Optimistic Locking) 및 조건부 UPDATE/DELETE
- **`expected_version` 검증**:
  - 애플리케이션 정보 수정 시 두 클라이언트가 동일 버전을 기반으로 덮어쓰는 Lost Update를 방지하기 위해 조건부 쿼리를 실행합니다([SQLAlchemy Versioning](https://docs.sqlalchemy.org/en/20/orm/versioning.html), [SQLite UPDATE](https://www.sqlite.org/lang_update.html)):
    ```sql
    UPDATE apps
    SET name = :name, ..., version = version + 1, updated_at = :now
    WHERE id = :app_id AND version = :expected_version;
    ```
  - `cursor.rowcount == 1`이면 성공, `cursor.rowcount == 0`이면 충돌(다른 요청에 의해 버전이 이미 변경됨)로 판정하고 HTTP 409 Conflict를 반환합니다.
- **조건부 DELETE 보장**:
  - 앱 삭제 시에도 동일하게 `DELETE FROM apps WHERE id = :app_id AND version = :expected_version;`을 수행하고 `rowcount`를 검증합니다.
  - `rowcount == 0`인 경우 이미 삭제되었거나 수정된 상태이므로 HTTP 409 또는 404를 반환하여 잘못된 삭제 연산을 차단합니다.

### 4.4 활성 작업(Health Job) 중복 방지: Partial Unique Index
- **문제 정의**:
  - 동일한 앱(`app_id`)에 대해 이미 실행 대기(`queued`) 또는 실행 중(`running`)인 검사 작업이 존재할 때 새로운 작업이 중복 추가되면 안 되지만, 과거 완료(`completed`), 실패(`failed`), 취소(`cancelled`)된 작업 이력은 동일 테이블에 보존되어야 합니다(PRD §8.5, §9.1).
- **해결책**:
  - [SQLite Partial Indexes 공식 문서](https://www.sqlite.org/partialindex.html)에 명시된 부분 고유 인덱스를 사용합니다:
    ```sql
    CREATE UNIQUE INDEX idx_health_jobs_active_app
    ON health_jobs(app_id)
    WHERE status IN ('queued', 'running');
    ```
  - 이 인덱스는 상태가 `queued` 또는 `running`인 행에 대해서만 고유성을 강제하므로, 완료·실패·취소된 작업 이력을 유지하면서도 활성 작업의 중복 생성을 DB 레벨에서 원자적으로 차단합니다.

### 4.5 작업 리스(Lease Claim) 획득, 장애 복구 및 원자적 경쟁 안전성
- **경쟁 상태 없는 원자적 클레임 및 상한 전이**:
  - 워커 프로세스가 비정상 종료되거나 리스가 만료되었을 때, 복수의 워커가 동시에 개입할 수 있으므로 리스 만료 확인, `attempts` 상한 검증, 실패 전이 처리가 경쟁 상태(Race Condition) 없이 원자적으로 안전(race-safe)해야 합니다.
- **원자적 실패 전환 (attempts 상한 초과 작업)**:
  - 재시도 상한(`max_attempts`, PRD §8.5에 따라 1회 재시도 허용 시 attempts >= 1인 상태에서 만료)에 도달한 작업은 재클레임되지 않고 단일 쿼리로 원자적으로 실패 처리되어야 합니다:
    ```sql
    UPDATE health_jobs
    SET status = 'failed',
        failure_code = 'LEASE_TIMEOUT_EXCEEDED',
        finished_at = :now
    WHERE id = :job_id
      AND status = 'running'
      AND lease_until < :now
      AND attempts >= :max_attempts;
    ```
    `cursor.rowcount == 1`이면 해당 워커가 실패 전이를 독점 확정합니다.
- **원자적 클레임 쿼리 (신규 또는 상한 미만 만료 작업)**:
  - 신규 대기 작업(`queued`)이거나, 실행 중 만료되었으나 재시도 상한 미만(`attempts < :max_attempts`)인 작업만 원자적으로 클레임하여 `running` 상태로 전이합니다:
    ```sql
    UPDATE health_jobs
    SET status = 'running',
        lease_until = :new_lease_time,
        started_at = :now,
        attempts = attempts + 1
    WHERE id = :job_id
      AND ((status = 'queued')
           OR (status = 'running' AND lease_until < :now AND attempts < :max_attempts));
    ```
  - `cursor.rowcount == 1`을 통해 소유권을 독점 획득하며, 0인 경우 이미 다른 프로세스가 처리 중이거나 리스 갱신/실패 전이가 완료된 것으로 간주합니다.

### 4.6 외래키(Foreign Keys) 무결성 및 CASCADE 동작
- **연결별 검증 필수**:
  - [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html)에 따르면 외래키 제약은 기본적으로 비활성화되어 있습니다.
  - 활성화(`PRAGMA foreign_keys = ON;`) 시 `app_grades`, `app_health`, `health_jobs`는 `app_id REFERENCES apps(id) ON DELETE CASCADE`를 통해 상위 앱 삭제 시 관련 자식 레코드가 원자적으로 연쇄 삭제됩니다.
  - 단, 감사 로그(`audit_logs`)는 피감사 대상이 삭제되어도 행위 증적이 남아야 하므로 외래키 제약을 걸지 않거나 `ON DELETE SET NULL`을 사용해야 합니다.

---

## 5. 인증 상태 저장, 세션 생명주기 및 보안 스펙

### 5.1 서버 저장형 세션 아키텍처 및 토큰 보호
- **토큰 원문 저장 금지**:
  - [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 권고에 따라 클라이언트에게 전달하는 세션 토큰은 256비트 엔트로피를 가진 난수(`secrets.token_urlsafe(32)`)로 생성합니다([Python secrets](https://docs.python.org/3/library/secrets.html)).
  - DB의 `sessions` 테이블에는 세션 토큰의 SHA-256 해시값(`token_hash`)만을 저장합니다([Python hashlib](https://docs.python.org/3/library/hashlib.html)).
  - DB 파일이 유출되거나 백업본이 탈취되어도 공격자가 유효한 세션 쿠키를 복원할 수 없습니다.
- **세션 테이블 권장 스키마**:
  ```sql
  CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      user_id TEXT, -- 익명 CSRF 세션의 경우 NULL 허용
      kind TEXT NOT NULL DEFAULT 'standard', -- 'standard', 'password_change', 'anonymous_csrf'
      csrf_token TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL,
      authenticated_at TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_sessions_user_expires ON sessions(user_id, expires_at);
  ```

### 5.2 쿠키 스펙 및 RFC 6265bis `__Host-` 접두사
- **`__Host-` 접두사 규칙**:
  - [RFC 6265bis Cookies](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis)에 따라 `__Host-` 접두사가 붙은 쿠키는 브라우저 수준에서 다음 요건을 강제합니다:
    1. 반드시 `Secure` 속성이 포함되어야 함 (HTTPS 전용).
    2. `Domain` 속성이 없어야 함 (서브도메인 공유 차단, 오직 발급 호스트에만 고정).
    3. 반드시 `Path=/` 속성을 가져야 함.
- **쿠키 설정**:
  - 운영 쿠키명: `__Host-eduvibe_session`
  - 속성: `HttpOnly=True; Secure=True; SameSite=Lax; Path=/`
  - 유효기간: 절대 유효기간 8시간(PRD §6.2). 로컬 HTTP 개발 환경에서는 접두사 없는 `eduvibe_session_dev`로 분기 처리.

### 5.3 세션 폐기(Revocation) 및 회전(Rotation) 트리거
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)에 따라 다음과 같은 상태 변경 시 즉시 DB 세션을 폐기합니다:
  1. **로그아웃**: 현재 세션의 `revoked_at`을 현재 시각으로 설정하거나 행 삭제.
  2. **로그인 성공 (권한 승격)**: 세션 고정 공격(Session Fixation) 방지를 위해 기존 세션을 폐기하고 새 세션 식별자를 발급.
  3. **비밀번호 변경 및 관리자 임시 초기화**: 해당 사용자의 모든 활성 세션을 즉시 무효화 (`UPDATE sessions SET revoked_at = :now WHERE user_id = :uid AND revoked_at IS NULL`).
  4. **관리자에 의한 승인 취소/회원 탈퇴**: 해당 사용자의 모든 세션 무효화. 매 요청 시 세션 조회와 함께 `users.approved` 상태를 동기적으로 검증.
  5. **비밀번호 변경 강제 세션**: 임시 비밀번호 로그인 시 15분 유효기간의 `kind='password_change'` 전용 세션만 발급하며 일반 리소스 접근 차단.

### 5.4 CSRF 방어 계층
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)에 따라 다층 방어를 적용합니다:
  - **SameSite=Lax**: 최신 브라우저의 교차 출처 단순 요청 차단.
  - **Synchronizer Token / Session-Bound CSRF Token**:
    - 모든 상태 변경 HTTP 요청(POST, PUT, PATCH, DELETE) 시 클라이언트는 헤더(`X-CSRF-Token`)에 세션 발급 시 제공된 CSRF 토큰을 동봉해야 함.
    - 서버는 세션에 저장된 `csrf_token`과 상수 시간 비교(`hmac.compare_digest`)로 일치 여부를 검증.
  - **Origin / Referer 헤더 검증**:
    - 요청의 `Origin` 또는 `Referer`가 서버의 허용 도메인과 정확히 일치하는지 서버 미들웨어에서 사전 검증.

### 5.5 속도 제한(Rate Limiting) 저장 및 개인정보 보호
- **테이블 스키마 및 인덱스**:
  - `rate_limits` 테이블은 `key`(식별 해시: 클라이언트 IP 해시 또는 `login_id_key:IP` 해시), `bucket_start`, `count`, `expires_at`만 저장.
  - 비밀번호, 연락처, 세션 토큰 등 민감 개인정보는 절대 기록하지 않음.
  - 만료 데이터 정리를 위해 `CREATE INDEX idx_rate_limits_expires ON rate_limits(expires_at);` 인덱스 구성 후 주기적 `DELETE FROM rate_limits WHERE expires_at < :now;` 수행.

### 5.6 Argon2id 권장 파라미터 및 단일 호스트 실측 기준
- **표준 권장 파라미터**:
  - [RFC 9106 Section 7.4](https://www.rfc-editor.org/rfc/rfc9106.html) 및 [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)에 따른 권장값:
    - 알고리즘: **Argon2id** (측면 채널 공격과 GPU 병렬 크래킹에 동시 저항)
    - OWASP 최소 권장값: Memory $m = 19\text{ MiB}$ ($19456\text{ KiB}$), Iterations $t = 2$, Parallelism $p = 1$.
    - RFC 9106 메모리 제약 환경 권장값: $m = 64\text{ MiB}$ ($65536\text{ KiB}$), $t = 3$, $p = 4$.
- **단일 호스트(2 vCPU / 4GB RAM) 환경 고려 및 실측 벤치마크 결정**:
  - 2 vCPU 환경에서 $p = 4$를 적용할 경우 가용 물리 코어를 초과하는 병렬 스레드로 인해 컨텍스트 스위칭 오버헤드와 CPU 경합이 발생할 수 있습니다.
  - 다만 하드웨어의 클록, 캐시 및 메모리 대역폭에 따라 실제 거동이 상이하므로, $p = 4$가 무조건 100% CPU 포화를 유발한다고 임의로 단정할 수는 없습니다.
  - 따라서 실제 배포 대상 하드웨어에서 **실측 벤치마크(Benchmark)**를 수행하여 단일 해싱 소요 시간($150\text{ms} \sim 300\text{ms}$)과 동시 요청 시 CPU 점유율을 측정하고, 그 결과에 근거하여 병렬도($p=1$ 또는 $p=2$), 반복 횟수($t=2 \sim 3$), 메모리($m=19\text{ MiB} \sim 64\text{ MiB}$)를 최종 결정해야 합니다.
- **CPU 기아 및 타이밍 공격 방어**:
  - 해싱 연산은 AnyIO의 워커 스레드풀에서 수행하되, 최대 동시 해싱 작업 수를 제어하기 위해 **세마포어(Semaphore, 최대 2개 동시 실행)**를 적용.
  - 존재하지 않는 `login_id`로 로그인 시도 시에도 사전에 계산된 더미 해시(Dummy Hash)를 상대로 검증을 수행하여 응답 시간 차이로 인한 사용자 존재 여부 탐색(User Enumeration Timing Attack) 차단([OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)).

---

## 6. 온라인 백업, 스키마 마이그레이션 및 복구 절차

### 6.1 온라인 백업 API vs 파일 단순 복사(`cp`)의 위험성
- **단순 파일 복사의 위험성**:
  - [SQLite Online Backup API 공식 문서](https://sqlite.org/backup.html) 및 [SQLite WAL 공식 문서](https://www.sqlite.org/wal.html)에 명시된 바와 같이, 애플리케이션이 쓰기 중인 상태에서 `cp app.db backup.db`를 수행하는 것은 치명적입니다.
  - WAL 모드에서는 최신 변경 사항이 `-wal` 파일에 기록되므로 주 DB 파일만 복사하면 데이터가 누락되거나 체크포인트 도중 복사 시 페이지 찢김(Torn Page)에 의한 DB 파일 손상이 발생합니다.
  - `-shm` 파일은 프로세스 간 공유 메모리 메타데이터이므로 이를 외부로 복사하면 잠금 상태 불일치를 유발합니다.
- **공식 온라인 백업 절차 (`Connection.backup`)**:
  - [Python sqlite3.Connection.backup](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup) 메서드는 SQLite의 C-API `sqlite3_backup_*`을 호출합니다.
  - 읽기 락을 짧게 쪼개어 페이지 단위(`pages=100`)로 복사하며, 복사 도중 외부 트랜잭션이 발생하면 자동으로 해당 페이지를 갱신합니다.
  - 서비스 중단 없이 페이지 수준의 일관성을 갖춘 스냅샷 DB 파일을 생성합니다:
    ```python
    import sqlite3

    def perform_online_backup(src_conn: sqlite3.Connection, backup_filepath: str):
        dst_conn = sqlite3.connect(backup_filepath)
        with dst_conn:
            src_conn.backup(dst_conn, pages=100, sleep=0.01)
        dst_conn.close()
    ```

### 6.2 WAL 체크포인트와 Alembic 마이그레이션 운영
- **Alembic Batch Mode 필수**:
  - SQLite는 외래키 변경, 제약조건 삭제, 컬럼 속성 변경 등 대부분의 `ALTER TABLE` 구문을 기본적으로 지원하지 않습니다.
  - [Alembic Batch Migrations](https://alembic.sqlalchemy.org/en/latest/batch.html)의 `render_as_batch=True` 또는 `with op.batch_alter_table(..., recreate='always')`를 적용하여 테이블 재생성, 데이터 복사, 인덱스 재생성 단계를 명시해야 합니다.
- **마이그레이션 전후 절차**:
  1. **사전 백업**: 마이그레이션 실행 직전 온라인 백업 수행.
  2. **체크포인트 수행**: `PRAGMA wal_checkpoint(TRUNCATE);`([SQLite wal_checkpoint_v2](https://www.sqlite.org/c3ref/wal_checkpoint_v2.html))를 발행하여 `-wal` 파일의 모든 내용을 주 파일로 플러시하고 크기를 0으로 초기화.
  3. **단독 프로세스 실행**: 애플리케이션 서비스가 기동되기 전 독립 CLI 명령(`alembic upgrade head`)으로 단독 수행. 서비스 기동 코드 내에서 자동 마이그레이션을 실행하지 않음.

### 6.3 DB 복구(Restore) 후 필수 정합성 복원 절차
백업본으로부터 DB 파일을 복원한 직후, 시스템을 운영에 재투입하기 전에 반드시 다음 5단계 절차를 수행해야 합니다:

```
[1. 물리 무결성 검증] ──> [2. 세션 전체 강제 폐기] ──> [3. 미완료 작업 실패 정리] ──> [4. 삭제 데이터 재확인] ──> [5. 단일 워커 기동]
```

1. **물리적 무결성 검증과 업무 의미 완전성의 한계**:
   - 복원된 DB에 연결하여 `PRAGMA integrity_check;` 및 `PRAGMA foreign_key_check;`를 실행하여 0건의 오류를 확인([SQLite Pragmas](https://www.sqlite.org/pragma.html)).
   - **중요 한계**: `PRAGMA integrity_check`는 B-Tree 구조 및 페이지 체인 등 파일 시스템 및 저장 엔진 레벨의 **물리적 무결성**만을 검증합니다. 백업 시점에 미완료된 비즈니스 트랜잭션, 분산 작업 상태, 세션 동기화, 사용자 계정 삭제 반영 여부와 같은 **애플리케이션 계층의 '업무 의미 완전성(Semantic completeness)'까지 보증하는 것은 아닙니다**.
   - 따라서 물리 검증 통과 후 반드시 아래 2~5단계의 비즈니스 정합성 복원 절차가 병행되어야 합니다.
2. **모든 세션 무효화 (Session Purge)**:
   - 백업 시점과 복원 시점 사이의 세션 불일치 및 자격증명 변경 사항을 무효화하기 위해 기존 세션을 전수 폐기:
     ```sql
     UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
     ```
   - 모든 사용자는 복원 직후 재로그인을 수행해야 하며, 이를 통해 승인 취소자나 탈퇴자의 부활 접근을 차단([OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)).
3. **인플라이트 작업 상태 초기화**:
   - 백업 시점에 `running` 상태였던 검사 작업은 프로세스가 존재하지 않으므로 즉시 실패 처리:
     ```sql
     UPDATE health_jobs
     SET status = 'failed', failure_code = 'RESTORE_ABORT', finished_at = CURRENT_TIMESTAMP
     WHERE status = 'running';
     ```
4. **개인정보 및 삭제 상태 재적용(Re-apply Purge)**:
   - GDPR/개인정보보호 원칙에 따라, 백업 생성 이후 사용자가 요청했던 계정 삭제/앱 삭제 기록(별도 저장소 또는 오딧 로그 기반)이 있다면 복원된 DB에 삭제 연산을 즉시 재집행.
5. **단일 백그라운드 워커 기동**:
   - API 서버와 워커 프로세스를 시작하고 WAL 모드 활성화 상태를 최종 확인.

---

## 7. 테스트 환경 재현 시나리오 및 검증 항목

단일 호스트 SQLite 운영의 안정성을 보증하기 위해 자동화 테스트(pytest)에서 검증해야 하는 7대 핵심 시나리오입니다:

| 시나리오 번호 | 테스트 명칭 | 재현 방식 | 검증 기준 및 통과 조건 |
|---|---|---|---|
| **TC-01** | 동시 쓰기 락 경합 및 bounded 대기/타임아웃 검증 | 두 스레드에서 동시에 쓰기 트랜잭션 수행 (`BEGIN IMMEDIATE` 적용) | 선행 트랜잭션이 짧은 시간(예: 100ms) 내 완료될 때 후행 트랜잭션이 `busy_timeout` 내에서 정상 직렬화되어 성공함을 확인하고, 선행 트랜잭션이 `busy_timeout`을 초과하여 장기 점유할 때 후행 트랜잭션에서 예측 가능한 `OperationalError: database is locked`가 발생하여 통제된 HTTP 503 처리로 격리되는 bounded 결과를 검증 |
| **TC-02** | 외래키 무결성 강제 검증 | 존재하지 않는 `owner_id`로 `apps` 레코드 `INSERT` 시도 | `sqlite3.IntegrityError` (FOREIGN KEY constraint failed) 발생 |
| **TC-03** | 낙관적 동시성 충돌 (409) | 동일한 `expected_version=1`을 가진 두 클라이언트가 동시에 `UPDATE` 요청 | 첫 번째 요청은 `rowcount==1` 성공, 두 번째 요청은 `rowcount==0`으로 감지되어 HTTP 409 Conflict 반환 |
| **TC-04** | 멱등성 키 동시 생성 차단 및 진행 중 상태 검증 | 동일한 `(user_id, idempotency_key)`로 동시 POST 요청 | 단 1개의 앱만 생성되며, 선행 요청 처리 중 도착한 두 번째 요청은 `in_progress` 상태 감지로 409/202 등 진행 중 응답으로 처리되고, 선행 커밋 완료 후 재시도 시 동일 201 응답 수신 확인 |
| **TC-05** | 부분 고유 인덱스 활성 작업 차단 | 동일 `app_id`에 대해 `status='queued'`인 작업이 있는 상태에서 추가 작업 `INSERT` 시도 | DB 레벨에서 `UNIQUE constraint failed: health_jobs.app_id` 발생 차단 확인 (완료/실패/취소 상태는 중복 허용) |
| **TC-06** | 워커 장애 리스 타임아웃 및 원자적 재클레임/실패 전이 | `running` 상태인 작업의 `lease_until`을 과거로 조작 후 새 워커 클레임 실행 | 리스 만료 작업이 경쟁 안전하게 재클레임되어 `attempts`가 증가하며, 재시도 상한(`max_attempts`) 초과 시 원자적으로 `status='failed'` 전이됨을 확인 |
| **TC-07** | 쓰기 부하 중 온라인 백업 정합성 | 초당 50회 `INSERT`가 발생하는 WAL 모드 DB에 대해 `Connection.backup()` 실행 | 백업이 에러 없이 완료되고, 복사된 DB에 대해 `PRAGMA integrity_check` 물리 무결성이 `['ok']` 반환됨을 확인 |

---

## 8. 1차 출처 참고 문헌 (Primary Sources Reference List)

아래는 보고서가 사용한 공식 1차 출처 중 핵심 22개입니다. 표와 본문에 직접 연결된 추가 공식 출처도 함께 근거로 사용했습니다.

1. **SQLite 공식 문서: Write-Ahead Logging (WAL)** — `https://www.sqlite.org/wal.html`
   *(WAL 동시성, 읽기/쓰기 비차단 원리, 단일 쓰기 제약, 네트워크 파일시스템 미지원)*
2. **SQLite 공식 문서: sqlite3_busy_timeout C-API** — `https://www.sqlite.org/c3ref/busy_timeout.html`
   *(잠금 발생 시 대기 핸들러 설정 및 밀리초 단위 타임아웃 메커니즘)*
3. **SQLite 공식 문서: Foreign Key Support** — `https://www.sqlite.org/foreignkeys.html`
   *(외래키 제약 기본 비활성화, 연결별 PRAGMA foreign_keys=ON 설정, CASCADE 삭제)*
4. **SQLite 공식 문서: File Locking And Concurrency In SQLite Version 3** — `https://www.sqlite.org/lockingv3.html`
   *(SHARED, RESERVED, PENDING, EXCLUSIVE 잠금 상태 및 락 에스컬레이션 데드락)*
5. **SQLite 공식 문서: SQL As Understood By SQLite - BEGIN TRANSACTION** — `https://www.sqlite.org/lang_transaction.html`
   *(DEFERRED, IMMEDIATE, EXCLUSIVE 트랜잭션 모드 정의 및 쓰기 경합 방지)*
6. **SQLite 공식 문서: SQLite Online Backup API** — `https://sqlite.org/backup.html`
   *(온라인 백업 API 아키텍처, 파일 단순 복사 시의 정합성 훼손 위험)*
7. **SQLite 공식 문서: Partial Indexes** — `https://www.sqlite.org/partialindex.html`
   *(WHERE 절을 포함한 부분 인덱스 생성 및 상태별 고유성 강제)*
8. **SQLite 공식 문서: PRAGMA Statements** — `https://www.sqlite.org/pragma.html`
   *(journal_mode, busy_timeout, foreign_keys, integrity_check, foreign_key_check)*
9. **SQLite 공식 문서: WAL Checkpoint C-API** — `https://www.sqlite.org/c3ref/wal_checkpoint_v2.html`
   *(PASSIVE, FULL, RESTART, TRUNCATE 체크포인트 모드 및 WAL 비우기)*
10. **SQLite 공식 문서: Using SQLite In Multi-Threaded Applications** — `https://www.sqlite.org/threadsafe.html`
    *(Single-thread, Multi-thread, Serialized 스레딩 모드 및 동시성 정책)*
11. **Python 공식 문서: sqlite3 — DB-API 2.0 interface for SQLite databases** — `https://docs.python.org/3/library/sqlite3.html`
    *(Python 3.12 PEP 249 autocommit 매개변수, Connection.backup, threadsafety, check_same_thread)*
12. **Python 공식 문서: secrets — Generate secure random numbers for managing secrets** — `https://docs.python.org/3/library/secrets.html`
    *(암호학적으로 안전한 256비트 난수 세션/CSRF 토큰 생성)*
13. **Python 공식 문서: hashlib — Secure hashes and message digests** — `https://docs.python.org/3/library/hashlib.html`
    *(세션 토큰 SHA-256 단방향 해싱 저장)*
14. **SQLAlchemy 공식 문서: SQLite Dialect** — `https://docs.sqlalchemy.org/en/20/dialects/sqlite.html`
    *(connect 이벤트 리스너를 통한 외래키 및 busy_timeout 주입, QueuePool 설정, 트랜잭션 제어)*
15. **SQLAlchemy 공식 문서: Optimistic Concurrency Control (version_id_col)** — `https://docs.sqlalchemy.org/en/20/orm/versioning.html`
    *(조건부 UPDATE 및 rowcount 기반 낙관적 동시성 충돌 감지)*
16. **FastAPI 공식 문서: SQL (Relational) Databases** — `https://fastapi.tiangolo.com/tutorial/sql-databases/`
    *(SQLite 연동 가이드 및 connect_args={"check_same_thread": False} 설정)*
17. **FastAPI 공식 문서: Concurrency and async / await** — `https://fastapi.tiangolo.com/async/`
    *(def 라우트의 AnyIO 워커 스레드풀 분기 실행 및 이벤트 루프 블로킹 방지)*
18. **Alembic 공식 문서: Running "Batch" Migrations for SQLite and Other Databases** — `https://alembic.sqlalchemy.org/en/latest/batch.html`
    *(SQLite ALTER TABLE 제약 극복을 위한 batch_alter_table 모드)*
19. **OWASP 공식 문서: Session Management Cheat Sheet** — `https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html`
    *(서버 저장형 세션, 토큰 해싱 저장, 세션 회전 및 강제 무효화 정책)*
20. **OWASP 공식 문서: Cross-Site Request Forgery (CSRF) Prevention Cheat Sheet** — `https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html`
    *(SameSite 쿠키, 세션 결합 CSRF 토큰 검증, Origin/Referer 출처 검증)*
21. **OWASP 공식 문서: Password Storage Cheat Sheet** — `https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html`
    *(Argon2id 최소 파라미터 m=19MiB, t=2, p=1 권장 및 더미 해시 타이밍 방어)*
22. **IETF RFC 9106: Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications** — `https://www.rfc-editor.org/rfc/rfc9106.html`
    *(Argon2id 표준 권장사항, 메모리 제약 환경 권장 파라미터)*
