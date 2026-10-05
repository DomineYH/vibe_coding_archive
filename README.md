# EduVibe 아카이브

교사가 만든 교육용 웹 앱과 그 앱을 만든 제작 프롬프트를 공유하는 아카이브입니다. 방문자는 가입 없이 공개 **아카이브 앱**을 검색하고, 설명·제작 프롬프트를 읽고, 등록된 **외부 사이트**를 새 탭으로 엽니다. 승인된 회원은 자기 앱을 등록·편집·삭제하고, 관리자는 회원 승인과 외부 사이트 **연결 결과**를 관리합니다.

브라우저 안에서만 돌던 기존 EduVibe 데모 화면(`basic_design/`)의 UI/UX를 그대로 유지하면서, FastAPI + SQLite 기반의 실제 서비스로 옮기는 것이 목표입니다. 요구사항은 [PRD](PRD/PRD_EduVibe_Archive_v1.0.md), 용어는 [CONTEXT.md](CONTEXT.md)에 있습니다.

## 현재 상태

| 단계    | 내용                                                | 상태                                   |
| ------- | --------------------------------------------------- | -------------------------------------- |
| Phase 1 | 백엔드 없이 모든 화면·상호작용을 mock 데이터로 구동 | 완료 ([수락 기록](docs/acceptance.md)) |
| Phase 2 | 갤러리·상세의 공개 읽기를 실제 API·DB에 연결        | 완료                                   |
| Phase 3 | 실제 인증(가입·승인·로그인·로그아웃·비밀번호 변경)  | 개발 환경 활성, 운영 공개 보류         |
| Phase 4 | 승인 회원 앱 등록·편집·공개 전환                    | 개발 환경 활성                         |
| 이후    | 앱 삭제 → 관리자 앱 관리 → 연결 검사 → 배포         | 예정                                   |

API 모드에서는 공개 읽기와, 개발 환경(`APP_ENV=development`)에서 실제 인증(회원 가입·관리자 승인·로그인·로그아웃·본인 비밀번호 변경) 및 승인된 full 회원의 자기 앱 등록·편집·공개 전환이 동작합니다. `/apps/new`에서 등록한 공개·비공개 앱은 DB에 저장되어 등록 후 상세 확인과 서버 재시작 뒤 조회가 가능합니다. 공개 앱은 비로그인 갤러리에 보이고 비공개 앱의 상세는 작성자·관리자만 볼 수 있습니다. `/apps/{id}/edit`의 기존 편집 양식에서 저장하면 버전이 증가하고 공개 여부도 즉시 반영됩니다. 운영 환경 인증·앱 등록·편집은 공개 검수(T07/G01~G18)가 끝날 때까지 꺼져 있습니다. 앱 삭제, 관리자 앱 관리, 연결 검사는 아직 "준비 중"으로 표시되며 mock 모드에서 확인할 수 있습니다.

## 구성

```
frontend/   React 18 + Vite + TypeScript, Playwright·Vitest 테스트
backend/    FastAPI + SQLAlchemy + Alembic, SQLite 파일 DB
contracts/  OpenAPI 계약(openapi.yaml), 분류 정본(catalog.json), fixture
basic_design/  원본 데모 화면 소스(보존본, 수정하지 않음)
PRD/        제품 요구사항 문서
docs/       수락 기록, UI 차이 기록, 시각 검증 증거, 조사 노트
```

프런트엔드에는 두 가지 데이터 모드가 있습니다.

- **mock 모드**: 브라우저 저장소의 합성 데이터로 모든 화면을 구동합니다. 백엔드가 필요 없습니다.
- **API 모드**: `/api/v1`을 호출하고, 실패해도 mock 데이터로 대체하지 않습니다. 개발 서버는 `/api` 요청을 `http://127.0.0.1:8000`의 백엔드로 넘깁니다.

## 필요한 도구

- Node 22.23.2, npm 12.0.2 (`frontend/.nvmrc`, `package.json`의 `engines`)
- Python 3.12.3, [uv](https://docs.astral.sh/uv/)

## 실행

### 1. mock 모드로 화면 보기 (백엔드 불필요)

```sh
cd frontend
npm ci
npm run dev
```

http://localhost:5173 을 엽니다. mock 저장소를 초기화하려면 `npm run mock:reset`이 알려 주는 페이지에서 초기화 버튼을 누릅니다.

### 2. 실제 API와 함께 실행

터미널 두 개를 씁니다.

**백엔드** (`backend/`):

```sh
cd backend
cp -n .env.example .env       # 최초 1회. 이미 있는 .env는 덮어쓰지 않습니다.
uv sync --locked
uv run --frozen alembic upgrade head
uv run --frozen python -m app.cli prepare-password-blocklist   # 최초 1회, 네트워크 필요
uv run --frozen python -m app.cli seed
uv run --frozen python -m app.cli bootstrap-admin              # 선택. 관리자가 필요할 때
uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

- **실행 환경 전환:** `backend/.env`의 `APP_ENV`로 고릅니다(`development` 또는 `production`). 바꾼 뒤에는 서버를 다시 시작합니다. 셸에서 `APP_ENV=...`를 직접 주면 `.env`보다 우선합니다. 테스트(`APP_ENV=test`)는 `.env`를 읽지 않으며 항상 명령 앞에 직접 붙여야 합니다.
- **실사용(`production`) 조건:** 저장소·임시 폴더 밖의 절대 DB 경로와 로컬이 아닌 HTTPS `PUBLIC_ORIGIN`이 필요하고, 아니면 서버가 시작하지 않습니다. 운영 인증은 공개 검수 전까지 꺼져 있습니다. `.env`가 `production`이면 위의 `alembic`·관리자 CLI 명령도 운영 DB에 적용되므로 실행 전에 `APP_ENV`를 확인하세요. 자세한 내용은 [backend/README.md](backend/README.md)를 봅니다.
- DB는 저장소 루트의 `storage/development.sqlite3` 파일입니다(상대 경로는 저장소 루트 기준). 서버를 다시 시작해도 데이터가 남습니다.
- `backend/.env`는 개발·운영에서 읽고, 프로세스 환경 변수가 우선합니다. 개발 기본값은 `DATABASE_PATH=storage/development.sqlite3`, `PUBLIC_ORIGIN=http://localhost:5174`입니다.
- 서버는 migration이 최신(head)이 아니면 시작하지 않습니다. 먼저 `alembic upgrade head`를 실행하세요.
- `seed`는 빠진 합성 개발 데이터만 추가하므로 여러 번 실행해도 됩니다. 대화형 터미널에서 실행해야 하고, 시드 회원을 처음 만들 때 공통 비밀번호를 두 번 입력받습니다.
- 개발 환경은 실제 인증을 켜므로 검증된 비밀번호 차단 목록이 필요합니다. 기본 위치는 `storage/password-blocklist-ncsc.txt`이고 `PASSWORD_BLOCKLIST_PATH`로 바꿀 수 있습니다. 없거나 손상되면 서버가 시작하지 않고 `prepare-password-blocklist` 실행을 안내합니다.
- 시드 회원 `seed-member-one`, `seed-member-two`는 `seed`에서 입력한 공통 비밀번호로 로그인합니다. `bootstrap-admin`으로 만든 관리자는 임시 비밀번호로 로그인한 뒤 비밀번호를 바꿔야 합니다.
- 상태 확인: `GET /healthz`(프로세스 생존), `GET /readyz`(DB·인증 준비).

**프런트엔드** (`frontend/`):

```sh
cd frontend
npm ci
npm run dev:api
```

http://localhost:5174 를 엽니다. 이 주소는 백엔드의 `PUBLIC_ORIGIN`과 같아야 합니다.

### 3. 빌드

```sh
cd frontend
npm run build        # API 모드 → dist/
npm run build:mock   # mock 데모 → dist-mock/
npm run check:dist
```

## 테스트와 검사

프런트엔드 (`frontend/`):

```sh
npm run check        # OpenAPI lint·생성 타입 확인, typecheck, eslint, prettier
npm test             # Vitest 단위 테스트
npm run test:e2e     # Playwright 브라우저 테스트(mock)
npm run test:e2e:api # 실제 백엔드를 띄운 Playwright 테스트
```

백엔드 (`backend/`):

```sh
uv run --frozen ruff check .
uv run --frozen ruff format --check .
APP_ENV=test uv run --frozen pytest
```

API 테스트는 각자 임시 DB와 서버를 만들어 쓰므로, 개발 DB에 영향을 주지 않습니다.

### 시각 비교 테스트

화면이 보존본·승인된 기준 이미지와 픽셀 단위로 같은지 비교합니다. 정확히 같은 브라우저와 폰트가 필요합니다.

1. Chromium **151.0.7922.34** headless shell을 받습니다.
   ```sh
   curl -fsSL https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.34/linux64/chrome-headless-shell-linux64.zip -o chrome-151.zip
   unzip -q chrome-151.zip -d chrome-151
   ```
2. **Noto Sans CJK JP** 폰트를 설치합니다(예: `fonts-noto-cjk`).
3. `frontend/`에서 실행합니다.
   ```sh
   PLAYWRIGHT_CHROMIUM_EXECUTABLE=/절대경로/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell \
   FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" \
   npm run test:visual
   ```

브라우저 버전이나 폰트가 다르면 사전 검사에서 실패합니다. 기준 이미지는 일반 실행에서 갱신되지 않습니다.

## 더 보기

- [frontend/README.md](frontend/README.md), [backend/README.md](backend/README.md): 각 영역의 세부 명령
- [contracts/openapi.yaml](contracts/openapi.yaml): API 계약
- [docs/ui-deviations.md](docs/ui-deviations.md): 원본 화면과 의도적으로 달라진 부분
- 이슈와 작업 흐름: GitHub Issues, [docs/agents/](docs/agents/)
