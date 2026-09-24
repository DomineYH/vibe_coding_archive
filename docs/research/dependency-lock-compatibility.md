# 개발 기반의 정확한 의존성 버전·잠금·검증 명령 조사 보고서 (개정 2판)

- **조사 일자**: 2026-09-24
- **대상 이슈**: GitHub Issue #27 ([개발 기반의 정확한 의존성 버전·잠금·검증 명령 조사](https://github.com/DomineYH/vibe_coding_archive/issues/27))
- **상위 결정**: Issue #15 ([저장소 구조·개발 명령·의존성 잠금의 최소 기반 확정](https://github.com/DomineYH/vibe_coding_archive/issues/15))의 인간 승인 **Q1=A** ("같은 저장소의 `frontend/`와 `backend/`에서 각각 npm/uv 명령을 실행하고 각자의 lockfile을 관리한다. 루트 통합 실행 도구·스크립트는 추가하지 않는다.")
- **선행 기술 문서**:
  - `docs/research/ui-fidelity-compatibility.md` (Issue #3)
  - `docs/research/sqlite-concurrency-auth-recovery.md` (Issue #4)
  - `docs/research/http-ssrf-transport.md` (Issue #5)
  - `docs/research/https-response-header-limits.md` (Issue #18)
  - `docs/research/health-worker-deadline-cancellation.md` (Issue #25)
  - `docs/research/auth-transition-late-cookie.md` (Issue #26)
  - `PRD/PRD_EduVibe_Archive_v1.0.md` (§5, §11, §12, §14)
- **작업 기준 커밋**: `f80d120c3accca10ef2b9c4f99b73007a5b88218` (origin/main)
- **재현 검증 산출물**: `docs/research/dependency-lock-compatibility/` (manifest, lockfile, 검증 fixture, 재현 스크립트, 실행 로그 요약)

> [!NOTE]
> 본 보고서는 기술 검증의 신뢰성을 위해 **[실측]**(격리된 환경에서 도구를 실제 실행하여 얻은 종료 코드 및 단언 결과), **[문서 근거]**(공식 1차 출처 명세·문서 및 레지스트리 메타데이터), **[추론]**(규격과 측정에 기반한 기술적 분석), **[미검증]**(현재 환경에서 직접 단언되지 않아 후속 검증이나 인간 결정이 필요한 항목)을 명확히 구분하여 서술한다.

---

## 1. 검증 환경 및 1차 출처 목록

### 1.1 검증 환경
- **OS / Platform**: Linux (`Linux 6.6.87.2-microsoft-standard-WSL2 x86_64`, Ubuntu 24.04 LTS 기반)
- **Node.js**: `v22.23.2` (`[실측]`, `node -v`)
- **npm**: `12.0.2` (`[실측]`, `npm -v`)
- **Python**: `3.12.3` (`[실측]`, `python3 --version`, `/usr/bin/python3.12`)
- **uv**: `0.11.28 (x86_64-unknown-linux-gnu)` (`[실측]`, `uv --version`)
- **SQLite (C-API)**: `3.45.1` (`[실측]`, Python `sqlite3.sqlite_version`)
- **Browser**: Google Chrome `144.0.7559.132` (`[실측]`, `/usr/bin/google-chrome --version`, 시스템 채널 연동)

### 1.2 1차 출처 목록 (확인 시점: 2026-09-24)
1. **Node.js Releases & Engine Policy**: `https://nodejs.org/en/about/previous-releases`
2. **npm CLI Reference (`npm ci`, `npm audit`)**: `https://docs.npmjs.com/cli/commands/npm-ci`, `https://docs.npmjs.com/cli/commands/npm-audit`
3. **uv Documentation (`uv lock`, `uv sync`, `uv audit`)**: `https://docs.astral.sh/uv/concepts/projects/sync/`, `https://docs.astral.sh/uv/reference/cli/#uv-audit`
4. **React & React-DOM 18.3.1**: `https://registry.npmjs.org/react/18.3.1`, `https://github.com/facebook/react/releases/tag/v18.3.1`
5. **Vite 6 Node 지원 명세**: `https://registry.npmjs.org/vite/6.4.3`, `https://vite.dev/guide/#scaffolding-your-first-vite-project` (Node.js 18 / 20 / 22+ 명시)
6. **@vitejs/plugin-react 4.3.4**: `https://registry.npmjs.org/@vitejs/plugin-react/4.3.4`
7. **Tailwind CSS 3.4.17**: `https://registry.npmjs.org/tailwindcss/3.4.17`, `https://tailwindcss.com/docs/installation`
8. **PostCSS 8.5.28 & Autoprefixer 10.6.1**: `https://registry.npmjs.org/postcss/8.5.28`, `https://registry.npmjs.org/autoprefixer/10.6.1`
9. **React Router v6 & v7**: `https://registry.npmjs.org/react-router-dom/6.30.6`, `https://registry.npmjs.org/react-router-dom/7.18.4`, `https://github.com/remix-run/react-router/releases`
10. **TanStack Query v5**: `https://registry.npmjs.org/@tanstack/react-query/5.66.9`
11. **Lucide React 0.453.0**: `https://registry.npmjs.org/lucide-react/0.453.0`
12. **Pretendard 1.3.9 (OFL-1.1)**: `https://registry.npmjs.org/pretendard/1.3.9`, `https://github.com/orioncactus/pretendard/blob/main/LICENSE`
13. **OpenAPI Specification 3.1.0**: `https://spec.openapis.org/oas/v3.1.0`
14. **openapi-typescript**: `https://registry.npmjs.org/openapi-typescript/7.13.0`, `https://openapi-ts.dev/`
15. **Redocly CLI**: `https://registry.npmjs.org/@redocly/cli/2.54.2`, `https://redocly.com/docs/cli/changelog`
16. **Vitest 5 & @vitest/mocker 보안 권고**: `https://registry.npmjs.org/vitest/5.0.1`, `https://github.com/advisories/GHSA-82fw-gwwq-j7x9` (Vitest: Path Traversal in @vitest/mocker)
17. **Playwright 1.50+**: `https://registry.npmjs.org/@playwright/test/1.63.0`
18. **FastAPI & Starlette**: `https://pypi.org/project/fastapi/`, `https://fastapi.tiangolo.com/`
19. **SQLAlchemy 2.0**: `https://pypi.org/project/SQLAlchemy/`, `https://docs.sqlalchemy.org/en/20/`
20. **Alembic**: `https://pypi.org/project/alembic/`, `https://alembic.sqlalchemy.org/en/latest/`
21. **pwdlib & argon2-cffi**: `https://pypi.org/project/pwdlib/`, `https://pypi.org/project/argon2-cffi/`
22. **HTTPX 0.28.1, httpcore 1.0.9, h11 0.16.0**: `https://pypi.org/project/httpx/0.28.1/`, `https://pypi.org/project/httpcore/1.0.9/`, `https://pypi.org/project/h11/0.16.0/`
23. **dnspython 2.8.0**: `https://pypi.org/project/dnspython/2.8.0/`
24. **anyio 4.14.2 (보안 권고 패치판)**: `https://pypi.org/project/anyio/4.14.2/`, `https://github.com/agronholm/anyio/security/advisories/GHSA-5p39-cfhj-2xmp`, `https://github.com/agronholm/anyio/security/advisories/GHSA-82r6-8w77-94w6`
25. **Ruff**: `https://pypi.org/project/ruff/`, `https://docs.astral.sh/ruff/`
26. **pytest & pytest-asyncio**: `https://pypi.org/project/pytest/`, `https://pypi.org/project/pytest-asyncio/`
27. **GitHub Security Advisory Database (GHSA)**: `https://github.com/advisories`

---

## 2. [조사 범위 1] 프론트엔드의 정확한 의존성 조합 및 호환성

### 2.1 프론트엔드 직접 의존성 및 잠금값 대조표

아래 표의 '잠금값'은 `docs/research/dependency-lock-compatibility/frontend/package-lock.json`의 `packages["node_modules/<name>"].version`에서 기계적으로 직접 추출하여 대조한 값이다 (`[실측]`):

| 계층 / 목적 | 패키지명 | 선언 범위 (`package.json`) | 정확한 잠금값 (`package-lock.json`) | 라이선스 | 1차 출처 및 검증 상태 |
|---|---|---|---|---|---|
| **UI 런타임** | `react` | `18.3.1` | `18.3.1` | MIT | `[문서 근거]` 원본 CDN 동일 버전, React 18 안정판 |
| **DOM 렌더러** | `react-dom` | `18.3.1` | `18.3.1` | MIT | `[문서 근거]` peer: `react@^18.3.1` 일치 |
| **번들러 / 개발서버** | `vite` | `6.4.3` | `6.4.3` | MIT | `[문서 근거]` Vite 6 안정판, Node 20/22 공식 지원 |
| **Vite React 플러그인** | `@vitejs/plugin-react` | `4.3.4` | `4.3.4` | MIT | `[문서 근거]` Vite 6 공식 React 플러그인 (Babel 7 연동) |
| **스타일링** | `tailwindcss` | `3.4.17` | `3.4.17` | MIT | `[문서 근거]` Play CDN 동일 버전, v4 마이그레이션 위험 회피 |
| **CSS 후처리** | `postcss` | `8.5.28` | `8.5.28` | MIT | `[실측]` Tailwind 3 연동 확인 |
| **벤더 프리픽스** | `autoprefixer` | `10.6.1` | `10.6.1` | MIT | `[실측]` PostCSS 8 플러그인 연동 확인 |
| **라우팅 (후보)** | `react-router-dom` | `^7.18.4` (Option B) / `6.30.6` (Option A) | `7.18.4` (Option B 잠금) | MIT | `[실측]` Option B: `react: >=18` 지원 및 audit 0건. v6/v7 모두 후보 상태(상세 5.2절 참조) |
| **서버 데이터 캐시** | `@tanstack/react-query` | `5.66.9` | `5.66.9` | MIT | `[문서 근거]` peer: `react@^18 || ^19` 호환 |
| **아이콘** | `lucide-react` | `0.453.0` | `0.453.0` | ISC | `[문서 근거]` 원본 CDN 동일 버전, ESM named import 매핑 |
| **글꼴 (로컬 번들)** | `pretendard` | `1.3.9` | `1.3.9` | SIL OFL 1.1 | `[문서 근거]` 오프라인/결정론 번들링 지원 |

### 2.2 프론트엔드 개발·도구 의존성 (`devDependencies`) 잠금값 대조표

아래 표의 '잠금값'은 `package-lock.json`에서 기계적으로 추출한 실제 설치·잠금 버전이다 (`[실측]`):

| 목적 | 패키지명 | 선언 범위 (`package.json`) | 정확한 잠금값 (`package-lock.json`) | 1차 출처 및 검증 역할 |
|---|---|---|---|---|
| **타입 검사기** | `typescript` | `^5.7.3` | `5.9.3` | `[실측]` `tsc --noEmit` 검증 |
| **React 타입** | `@types/react` | `^18.3.18` | `18.3.31` | `[실측]` React 18.3 최신 타입 정의 |
| **ReactDOM 타입** | `@types/react-dom` | `^18.3.5` | `18.3.7` | `[실측]` ReactDOM 18.3 최신 타입 정의 |
| **Node 타입** | `@types/node` | `^22.13.0` | `22.20.4` | `[실측]` Node 22 런타임 타입 정의 |
| **린터 코어** | `eslint` | `^9.21.0` | `9.39.5` | `[실측]` Flat Config (`eslint.config.js`) |
| **JS 권장 규칙** | `@eslint/js` | `^9.21.0` | `9.39.5` | `[실측]` ESLint 9 공식 권장 설정 |
| **TS 린터** | `typescript-eslint` | `^8.25.0` | `8.70.1` | `[실측]` peer: ESLint 9 + TypeScript 5 지원 |
| **React Hooks 린터** | `eslint-plugin-react-hooks` | `^5.1.0` | `5.2.0` | `[실측]` ESLint 9 Flat Config 호환 확인 |
| **Vite Refresh 린터** | `eslint-plugin-react-refresh` | `^0.4.19` | `0.4.26` | `[실측]` Fast Refresh 안전 규칙 검사 |
| **글로벌 스코프 정의** | `globals` | `^15.15.0` | `15.15.0` | `[실측]` 브라우저 글로벌 심볼(`window`, `document`) 제공 |
| **포매터 코어** | `prettier` | `^3.5.2` | `3.9.9` | `[실측]` `prettier --check .` 코드 서식 검증 |
| **ESLint-Prettier 충돌 방지** | `eslint-config-prettier` | `^10.0.1` | `10.1.8` | `[실측]` 중복 규칙 비활성화 |
| **단위/컴포넌트 테스트** | `vitest` | `^5.0.1` | `5.0.1` | `[문서 근거: GHSA-82fw-gwwq-j7x9]`, `[실측]` Vite 6 연동, `@vitest/mocker` 보안 패치판 |
| **React 컴포넌트 검증** | `@testing-library/react` | `^16.2.0` | `16.3.3` | `[실측]` peer: `react@^18.0.0 || ^19.0.0` 호환 |
| **DOM 단언 매처** | `@testing-library/jest-dom` | `^6.6.3` | `6.9.1` | `[실측]` `toBeInTheDocument()` 등 매처 확장 |
| **사용자 이벤트 시뮬레이션** | `@testing-library/user-event` | `^14.6.1` | `14.6.7` | `[실측]` 클릭·입력 비동기 이벤트 검증 |
| **DOM 환경 에뮬레이션** | `jsdom` | `^26.0.0` | `26.1.0` | `[실측]` Node 상의 브라우저 DOM 에뮬레이션 |
| **E2E / 브라우저 실행** | `@playwright/test` | `^1.50.1` | `1.63.0` | `[실측]` 시스템 Chrome 144 연동 E2E smoke 통과 |
| **계약 타입 생성** | `openapi-typescript` | `^7.6.1` | `7.13.0` | `[실측]` OpenAPI 3.1 -> TS 타입 생성 (런타임 제로) |
| **계약 스키마 린터** | `@redocly/cli` | `^2.54.2` | `2.54.2` | `[문서 근거: Redocly Changelog]`, `[실측]` OpenAPI 3.1 명세 유효성 검사 |

### 2.3 Engine 요건 산출 근거 및 Peer 호환성
- **Engine 요건 산출 근거 (`[문서 근거: package-lock.json engines 기계 분석]`)**:
  - `package-lock.json` 내 `engines.node`가 명시된 264개 패키지를 전수 분석한 결과:
    - `@redocly/cli`: `node: ">=22.12.0 || >=20.19.0 <21.0.0"` (Node 22.0.0 불가, 최소 22.12.0 요구)
    - `vitest`: `node: "^22.12.0 || ^24.0.0 || >=26.0.0"` (Node 20 미지원, 최소 22.12.0 요구)
    - `eslint-visitor-keys`: `node: "^20.19.0 || ^22.13.0 || >=24"` (최소 22.13.0 요구)
    - `@napi-rs/lzma-linux-x64-gnu` (Rollup 선택 의존성): `node: "^22.20 || ^24.12 || >=25"` (최소 22.20.0 요구)
  - 따라서 lockfile의 264개 패키지 전체(선택 네이티브 바인딩 포함)가 요구하는 **가장 엄격한 하한은 `node: ">=22.20.0"`**이다.
  - 이에 따라 `frontend/package.json`의 엔진 선언을 `"engines": { "node": ">=22.20.0", "npm": ">=10.0.0" }`로 확정하였으며, 현재 검증 환경(Node `v22.23.2`, npm `12.0.2`)은 이를 완벽히 만족한다 (`[실측]`).
- **피어 의존성 충돌 0건 (`[실측]`)**:
  `npm ci` 실행 시 peer dependency resolution 에러 및 충돌 0건 (`added 357 packages, audited 358 packages`).
- **기존 캡처 브라우저와의 관계 (`[실측]`)**:
  - `docs/research/auth-transition-late-cookie.md`에서 검증된 Google Chrome `144.0.7559.132` (Linux 호스트 `/usr/bin/google-chrome`)가 이미 설치되어 있다.
  - Playwright 설정(`frontend/playwright.config.js`)에서 `projects: [{ use: { channel: 'chrome' } }]`를 지정하여 별도의 무거운 브라우저 바이너리(약 500MB)를 worktree에 다운로드하지 않고 **시스템 Chrome을 직접 호출**하여 E2E 테스트를 수행한다(`[실측]`, 277ms 실행 통과).

---

## 3. [조사 범위 2] 계약 생성·검증의 최소 도구와 Phase별 적용 조건

### 3.1 최소 도구 선정: `openapi-typescript` + `@redocly/cli`
- **단일 원본 원칙 준수 (`[문서 근거: 이슈 #12, PRD §5]`)**:
  편집 가능한 `openapi.yaml`이 단일 원본(Single Source of Truth)이며, TypeScript API 타입은 여기서 자동 생성된다. FastAPI의 자동 생성 문서는 두 번째 편집 원본이 아니다.
- **`openapi-typescript 7.13.0`의 특성 (`[실측]`)**:
  - 생성물은 순수한 TypeScript 인터페이스(`paths`, `components['schemas']`)만을 담은 `src/contracts/api.d.ts` 파일이다.
  - Axios, TanStack Query wrapper, 별도 HTTP 클라이언트 등의 런타임 의존성을 일체 생성하지 않는다.
  - PRD §11.1이 요구하는 `authService`, `appsService` 비동기 서비스 인터페이스와 완벽하게 부합하며 불필요한 프레임워크 비대화를 차단한다.
- **`@redocly/cli 2.54.2`의 검증 역할 (`[실측]`)**:
  - OpenAPI 3.1.0 스키마의 문법, 필수 필드, 구조적 정합성을 검증한다.
  - `redocly.yaml`을 통해 `servers` 명시를 강제하고, 무백엔드 Phase 1에서도 API 계약의 스키마 오류를 빌드 전 단계에서 차단한다 (`validated in 29ms`, `[실측]`).

### 3.2 계약 파일 경로와 생성물 변경 감지 (일관성 확보)
- **경로 후보 (`[추론]`)**:
  - *후보 1 (본 검증 fixture 적용안)*: `frontend/contracts/openapi.yaml` (프론트엔드 작업 디렉터리 내 자립형 구조)
  - *후보 2 (저장소 공용안)*: 저장소 루트 `contracts/openapi.yaml` 또는 `docs/openapi.yaml` (프론트엔드에서 `../contracts/openapi.yaml`로 참조)
  - *영구 위치 결정*: Issue #15 개발 기반 결정 세션에서 사람이 최종 선택한다.
- **생성물 변경 감지 실측 (`[실측]`)**:
  - CI 파이프라인에서 Git 체크아웃 상태일 경우: `npx openapi-typescript contracts/openapi.yaml -o src/contracts/api.d.ts && git diff --exit-code src/contracts/api.d.ts`
  - `.git`이 없는 격리 검증 환경일 경우: `diff -u src/contracts/api.d.ts <기준_api.d.ts>`로 생성물의 물리적 동일성을 바이트 단위로 검증한다 (`[실측: exit 0, 차이 0바이트]`).

### 3.3 점진적 TypeScript 적용 조건 및 원본 JSX 모듈화 한계 명시
- **`basic_design/*.jsx` 파일의 런타임 구조 분석 (`[실측 근거]`)**:
  - 원본 `basic_design/*.jsx` 파일들은 단일 HTML(`EduVibe 아카이브.html`) 내에서 Babel standalone 스크립트 태그로 순차 로드되어 전역 스코프(`window.LucideReact`, 전역 상수 `STATUS_META`, 전역 함수 `Chip`)를 공유하도록 작성되었다.
  - 따라서 원본 파일에는 `export` 또는 `import` 문이 일체 존재하지 않는다.
  - **결과 (`[추론]`)**: 원본 파일을 부수 효과(side-effect) import로 불러오는 것 자체는 가능하지만, 각 모듈 스코프가 분리되어 `window` 전역 공유에 의존하는 식별자(`STATUS_META`, `Chip` 등)가 해석되지 않고 `export`도 없으므로, **수정 없이 원본 파일 그대로 ESM 모듈로 조합해 화면을 구동할 수는 없다**.
- **PRD 정합화 및 해결 조건 (`[문서 근거: PRD §14.2]`)**:
  - PRD §14.2는 명시적으로 "Vite에서 원본 JSX·CSS·아이콘을 실행한다. **window 전역 연결만 모듈로 정리하고** UI 재설계는 하지 않는다"고 규정하고 있다.
  - 따라서 JSX 구문과 Tailwind 클래스 표현은 원본 그대로 보존하되, **각 컴포넌트 상단에 의존성 import 및 하단 export를 부여하는 최소 모듈화 래핑 작업이 필수적**이다.
  - `tsconfig.json`에 `"allowJs": true`, `"checkJs": false`를 적용하면 모듈화된 `.jsx` 파일에 대해 TypeScript 타입 어노테이션을 강제하지 않고 순수 JSX로 빌드·테스트할 수 있다 (`[실측]`).
- **상태 판정 (`[추론]` 및 `[미검증]`)**:
  - 본 검증 fixture는 StatusBadge 등 핵심 UI 패턴 및 Tailwind 토큰의 빌드/테스트 동작을 확인하였으나, **`basic_design/` 내 7개 화면 전체 JSX의 실제 브라우저 렌더링 및 스타일 보존 구동은 아직 [미검증]** 상태다.
  - 또한 원본 파일 자체는 전역 변수(`window.LucideReact`, `STATUS_META`) 의존성과 `export` 누락으로 인해 ESM 번들러에서 무수정 직접 구동이 불가능하므로(`[실측 근거]`), Phase 1 이식 작업 시 전역 연결의 모듈화(ESM import/export 래핑)가 필수적이다.

### 3.4 생성 타입 검사와 런타임 응답 검증의 보장 차이
- **생성 타입 검사 (`tsc --noEmit`) (`[추론]`)**:
  - **보장 범위**: 프론트엔드 컴파일 타임에 DTO 필드명(`snake_case`), 프로퍼티 타입(`string`, `boolean`, `enum`), null 허용 여부의 정적 일관성을 보장한다.
  - **한계**: 서버가 실제로 반환하는 런타임 HTTP 상태 코드, DB 무결성 위반, 직렬화 누락을 감지할 수 없다.
- **런타임 응답 검증 (FastAPI Pydantic & pytest) (`[추론]`)**:
  - **보장 범위**: FastAPI의 Pydantic 응답 모델이 직렬화 시점에 실제 반환 데이터의 유효성을 강제 검증한다.
  - **미구현 엔드포인트 격리**: 후속 Phase에서 구현되지 않은 엔드포인트는 pytest 마커(`pytest -m "phase2"`) 또는 Schemathesis 필터링(`--include-path`)을 사용하여 단계별 검증 범위에서 명시적으로 제외한다.

---

## 4. [조사 범위 3] 백엔드의 정확한 의존성 조합 및 플랫폼 조건

### 4.1 백엔드 의존성 및 잠금값 대조표 (`pyproject.toml` / `uv.lock`)

아래 표의 '잠금값'은 `docs/research/dependency-lock-compatibility/backend/uv.lock`에서 기계적으로 추출한 값이다 (`[실측]`):

| 패키지명 | 선언 범위 (`pyproject.toml`) | 정확한 잠금값 (`uv.lock`) | 분류 | 1차 출처 및 필수 사유 |
|---|---|---|---|---|
| **fastapi** | `>=0.115.0` | `0.141.1` | 직접 의존성 | `[문서 근거]` PRD §5 채택 사양, REST API 프레임워크 |
| **starlette** | (fastapi 전이) | `1.7.0` | 전이 의존성 | `[문서 근거]` ASGI 코어 엔진, 요청/응답 처리 |
| **pydantic** | `>=2.10.0` | `2.13.5` | 직접 의존성 | `[문서 근거]` 데이터 스키마 및 직렬화 검증 |
| **pydantic-settings** | `>=2.7.0` | `2.15.0` | 직접 의존성 | `[문서 근거]` `.env` 및 환경 변수 타입 안전 주입 |
| **uvicorn** | `uvicorn[standard]>=0.34.0` | `0.53.0` | 직접 의존성 | `[문서 근거]` 고성능 ASGI 서버 (uvloop, httptools 포함) |
| **sqlalchemy** | `>=2.0.35,<3.0.0` | `2.0.54` | 직접 의존성 | `[문서 근거]` PRD §5 채택 사양, 2.0 스타일 세션/트랜잭션 |
| **alembic** | `>=1.14.0` | `1.20.0` | 직접 의존성 | `[문서 근거]` PRD §5 채택 사양, SQLite batch migration |
| **pwdlib** | `pwdlib[argon2]>=0.2.1` | `0.3.1` | 직접 의존성 | `[문서 근거]` PRD §5 채택 사양, 패스워드 해싱 인터페이스 |
| **argon2-cffi** | (pwdlib[argon2] 전이) | `25.1.0` | 전이 의존성 | `[문서 근거]` Argon2id 바인딩 구현체 |
| **httpx** | `==0.28.1` | `0.28.1` | 직접 (엄격 고정) | `[문서 근거]` 검사 worker HTTP 클라이언트 (`docs/research/https-response-header-limits.md`) |
| **httpcore** | `==1.0.9` | `1.0.9` | 직접 (엄격 고정) | `[문서 근거]` 내부 NetworkBackend 연계 및 100KB 헤더 버퍼 상한 고정 |
| **h11** | `==0.16.0` | `0.16.0` | 직접 (엄격 고정) | `[문서 근거]` HTTP/1.1 순수 상태 머신 파서 고정 |
| **anyio** | `==4.14.2` | `4.14.2` | 직접 (엄격 고정) | `[문서 근거: GHSA-5p39-cfhj-2xmp, GHSA-82r6-8w77-94w6]`, `[실측]` 보안 패치판 (상세 5.1절) |
| **dnspython** | `==2.8.0` | `2.8.0` | 직접 (엄격 고정) | `[문서 근거]` 비동기 DNS 조회 (`dns.asyncresolver`, SSRF 차단) |
| **pytest** | `>=8.3.0` | `9.1.1` | 개발 의존성 | `[실측]` 테스트 러너 코어 |
| **pytest-asyncio** | `>=0.25.0` | `1.4.0` | 개발 의존성 | `[실측]` FastAPI 비동기 클라이언트(`AsyncClient`) 테스트 |
| **ruff** | `>=0.9.0` | `0.16.8` | 개발 의존성 | `[실측]` 초고속 통합 린터 및 포매터 |

### 4.2 전이 의존성 엄격 고정 이유
1. **`httpx 0.28.1` + `httpcore 1.0.9` + `h11 0.16.0` (`[문서 근거: 이슈 #18, #25]`)**:
   - `httpcore.NetworkBackend` 내부 소켓 주입 및 `h11.Connection`의 `MAX_INCOMPLETE_EVENT_SIZE = 100 * 1024` 버퍼 동작은 HTTPX의 공개 안정 API가 아닌 내부 결합 구조다.
   - 마이너 버전 차이로 내부 클래스 구조가 변경되면 SSRF 방어용 IP 고정 및 32 KiB 헤더 절단 래퍼가 무력화될 수 있으므로 세 패키지를 정확한 버전으로 `uv.lock`에 고정해야 한다.
2. **`anyio 4.14.2` 고정 (`[문서 근거: GHSA-5p39-cfhj-2xmp, GHSA-82r6-8w77-94w6]`)**:
   - 선행 연구(`docs/research/health-worker-deadline-cancellation.md`)의 `anyio 4.12.1`은 보안 취약점이 발견되었으므로 패치된 `4.14.2`로 고정한다.

### 4.3 SQLite 및 시스템 라이브러리 조건
- **SQLite 버전 (`[실측]`)**: Python 내장 `sqlite3` 드라이버를 통해 SQLite `3.45.1`과 연결됨.
- **SQLite 필수 기능 충족 여부 (`[문서 근거: docs/research/sqlite-concurrency-auth-recovery.md]`)**:
  - WAL 모드 지원 (SQLite 3.7.0+ 요구 $\to$ 3.45.1 충족)
  - Partial Index 지원 (`health_jobs` 활성 작업 격리, 3.8.0+ 요구 $\to$ 3.45.1 충족)
  - UPSERT 지원 (`ON CONFLICT DO UPDATE`, 3.24.0+ 요구 $\to$ 3.45.1 충족)
  - `foreign_keys=ON` 및 `busy_timeout=5000` Per-connection PRAGMA 주입 정상 동작 (`[실측]`, `test_sqlite_pragmas` 통과)
- **C-바인딩 Wheel 및 시스템 라이브러리 (`[실측]`)**:
  - `argon2-cffi-bindings`, `cffi`, `uvloop`, `watchfiles`, `httptools`는 Linux x86_64용 사전 빌드 wheel(`manylinux`)이 제공되어 시스템 gcc나 별도 컴파일 도구 없이 uv로 즉시 설치 완료됨.

---

## 5. [조사 범위 4 & 5] 잠금·재설치·명령의 실측 및 보안 경계

### 5.1 보안 감사 실측: `anyio 4.12.1` 취약점 발견 및 패치 대안

선행 조사 문서(`docs/research/health-worker-deadline-cancellation.md` line 36)에서 기록되었던 `anyio 4.12.1`에 대해 `uv audit`을 수행한 결과, **2건의 알려진 보안 취약점**이 즉시 검출되었다 (`[실측]`):

```text
anyio 4.12.1 has 2 known vulnerabilities:
- GHSA-5p39-cfhj-2xmp: AnyIO process-pool workers can block indefinitely on undrained stderr
  Fixed in: 4.14.2
  Advisory: https://github.com/agronholm/anyio/security/advisories/GHSA-5p39-cfhj-2xmp

- GHSA-82r6-8w77-94w6: AnyIO: TLSStream IDNA 2003 host name encoding enables potential TLS certificate spoofing
  Fixed in: 4.14.2
  Advisory: https://github.com/agronholm/anyio/security/advisories/GHSA-82r6-8w77-94w6
```

- **영향 분석 (`[추론]`)**:
  - `GHSA-82r6-8w77-94w6`: TLSStream 호스트명 인코딩 취약점으로, 도메인 검증 및 TLS SNI 검증이 핵심인 EduVibe의 아웃바운드 검사 worker에 직접적인 위험을 초래할 수 있다.
- **최소 대안 및 실측 조치 (`[실측]`)**:
  - `pyproject.toml` 및 `uv.lock`에서 anyio를 패치 안정판인 `anyio==4.14.2`로 갱신.
  - 갱신 후 `uv audit` 재실행 결과: **"Found no known vulnerabilities and no adverse project statuses in 42 packages"** (취약점 0건 달성, `[실측]`).
  - 기존 HTTPX 0.28.1 / httpcore 1.0.9 및 FastAPI 비동기 테스트가 anyio 4.14.2 환경에서 100% 정상 동작함을 실측 단언 (`[실측]`).

### 5.2 React Router 후보군 비교 분석: v6 vs v7

`npm audit` 수행 결과, 기존 Issue #3의 보존 후보였던 `react-router-dom@6.30.6`에 대해 2건의 moderate 보안 권고가 보고되었다 (`[실측]`):

```text
react-router  6.0.0 - 7.17.0
Severity: moderate
1. GHSA-wrjc-x8rr-h8h6: React Router: Open redirect via backslash in <Link> and useNavigate
2. GHSA-337j-9hxr-rhxg: React Router: Arbitrary Constructor Injection via deserializeErrors() in SSR Hydration
Fix available: upgrade to react-router-dom@7.18.4 (breaking change)
```

- **심층 영향 분석 (`[추론]`)**:
  1. `GHSA-337j-9hxr-rhxg` (SSR Constructor Injection):
     - EduVibe는 순수 클라이언트 Vite SPA (`<BrowserRouter>`)로 구동되며 서버 사이드 렌더링(SSR Hydration)을 사용하지 않으므로 `deserializeErrors()` 코드 경로 자체가 실행되지 않는다.
  2. `GHSA-wrjc-x8rr-h8h6` (Backslash Open Redirect):
     - 취약점은 `<Link to={...}>` 또는 `useNavigate`에 백슬래시(`\`)가 포함된 경로가 전달될 때 발생한다.
     - **조건부 채택 요건 (`[추론]`)**: 만약 v6를 유지할 경우, 외부 사용자 입력(쿼리 스트링, `return_to`, 앱 URL)이 라우터로 전달되는 **모든 경로**에서 선행 슬래시 검증 및 백슬래시/스킴 차단 가드가 엄격히 구현되어야만 안전성을 담보할 수 있다. 업스트림 패치가 중단되었으므로 신규 취약점 발생 시 자체 대응이 필요하다.
- **후보 비교표 (Option A vs Option B)**:

| 비교 항목 | Option A: `react-router-dom@6.30.6` (후보 1) | Option B: `react-router-dom@7.18.4` (후보 2) |
|---|---|---|
| **후보 성격** | Issue #3 Option A (React 18 보존 후보) | 취약점 0건 최신 안정판 후보 |
| **npm audit 결과** | 2 moderate vulnerabilities (`[실측]`) | **0 vulnerabilities** (`[실측]`) |
| **React 18 호환** | peer: `react: >=16.8` (`[문서 근거]`) | peer: `react: >=18` (`[문서 근거]`, 완벽 호환) |
| **실제 위험도** | SSR 미사용 및 return_to 가드 구현 시 제한적 (`[추론]`) | 취약점 코어 패치 완료 (`[문서 근거]`) |
| **테스트 검증** | 라우터 import 및 렌더링 가능 (`[추론]`) | `<MemoryRouter>` 기본 렌더링 검증 완료 (`[실측: Router.test.jsx]`) |
| **원본 UI 호환성** | 원본 해시 라우팅과의 매핑 용이 (`[추론]`) | **원본 UI 전체 화면 전환과의 완전 호환은 미검증** (`[미검증]`) |

> **인간 결정 과제**: 본 검증 fixture(`frontend/package.json`)는 `npm audit` 0건을 입증하기 위해 `react-router-dom@7.18.4`를 잠금하였으나, 두 버전 모두 후보(Candidate) 상태이며 원본 UI 전체 화면과의 실질적 라우팅 호환성은 Phase 1 구현 시 E2E 테스트로 최종 판정해야 한다 (`[미검증]`). 최종 선택은 Issue #15에서 결정된다.

### 5.3 `@redocly/cli` 버전 선정 근거
Redocly CLI 공식 변경 기록(`https://redocly.com/docs/cli/changelog`)에 따르면, 2.x 계열에서 종속 패키지 업데이트가 지속적으로 이루어졌다. 본 검증에서는 최신 안정판인 `@redocly/cli@2.54.2`를 잠금 지정하여 전이 취약점 없이 OpenAPI 3.1 명세를 안정적으로 검증하였다 (`[실측]`).

### 5.4 "권고 없음"의 한계 명시
`npm audit` 및 `uv audit`에서 "0 vulnerabilities"가 보고된 것은 **"질의 시점(2026-09-24)에 공식 CVE/GHSA 데이터베이스에 등록된 알려진 취약점이 없다"**는 사실을 뜻하며, 미발견 취약점(0-day)이나 라이브러리 내부 결함이 없음을 수학적으로 보장하는 것은 아니다 (`[문서 근거]`).

---

## 6. [실측 데이터] 실행 명령, 종료 코드 및 Manifest/Lockfile 해시

### 6.1 Manifest 및 Lockfile SHA-256 체크섬

| 파일 경로 (검증 산출물) | SHA-256 체크섬 | 용도 및 패키지 규모 |
|---|---|---|
| `docs/research/dependency-lock-compatibility/frontend/package.json` | `70d0ae31f95cdbf69d31af21ef960efa57bbac5e76d4e085a4500464a96746d6` | 프론트엔드 의존성, engines(`>=22.20.0`), scripts 선언 |
| `docs/research/dependency-lock-compatibility/frontend/package-lock.json` | `c76d9b869d2a1a76833bad7af7e6121e425434e0b84e39555bc8780e25811d80` | 프론트엔드 잠금파일 (루트 포함 408개 항목 / audited 358개) |
| `docs/research/dependency-lock-compatibility/backend/pyproject.toml` | `cb54c7ab5ca229505ca7fad3294311f2ac0c95bf6e57824866bbc4c5ca35787c` | 백엔드 PEP 621 의존성 선언 명세 |
| `docs/research/dependency-lock-compatibility/backend/uv.lock` | `8bd59bff114d2c77eec39108a862f2a45f8f33644a8d80739ecd6766dfcc5d09` | 백엔드 43개 패키지 잠금파일 |
| `docs/research/dependency-lock-compatibility/contracts/openapi.yaml` | `d52d4db8615c2f18073fc99d41dd4751464b55926b02891b6ef9bf7d3786b353` | API 계약 단일 원본 스키마 |
| `docs/research/dependency-lock-compatibility/frontend/src/contracts/api.d.ts` | `63d892708135b2d18603ce0b854663f70b40853635b849773c1be67328d829ce` | OpenAPI 자동 생성 TypeScript 타입 정의 |
| `docs/research/dependency-lock-compatibility/logs/run_summary.log` | `2f9d783aea63179009b94b07d946f016edb6271c7cc879e48bf89284372cf3dc` | 자동화 재현 스크립트 실행 요약 로그 (종료 코드 전수 기록) |

### 6.2 실측 검증 명령 및 종료 코드 총괄표

모든 명령은 격리된 임시 디렉터리(`/tmp/deps-verify-reproduce-*`)에서 자동화 스크립트(`scripts/verify_reproduction.sh`)를 통해 실행되었으며, 실행 요약 로그([logs/run_summary.log](dependency-lock-compatibility/logs/run_summary.log)) 및 각 단계별 로그 파일의 실제 문구를 그대로 대조·기록하였다 (`[실측]`):

| 계층 | 실행 단계 | 실행 명령 | 실제 종료 코드 | 핵심 출력 및 결과 요약 (로그 원문 대조) | 로그 파일 위치 |
|---|---|---|---|---|---|
| **Frontend** | 깨끗한 잠금 설치 | `npm ci` | `0` | `added 357 packages, and audited 358 packages in 11s` | `logs/frontend_npm_ci.log` |
| **Frontend** | 계약 스키마 린트 | `npx redocly lint contracts/openapi.yaml` | `0` | `contracts/openapi.yaml: validated in 29ms. Woohoo! Your API description is valid.` | `logs/frontend_openapi_lint.log` |
| **Frontend** | TypeScript 타입 생성 | `npx openapi-typescript contracts/openapi.yaml -o src/contracts/api.d.ts` | `0` | `contracts/openapi.yaml -> src/contracts/api.d.ts [124ms]` | `logs/frontend_openapi_generate.log` |
| **Frontend** | 생성물 변경 감지 | `diff -u src/contracts/api.d.ts <fixture_api.d.ts>` | `0` | 차이 0바이트 (완전 일치, diff -u exit 0) | `logs/frontend_openapi_diff.log` |
| **Frontend** | 정적 타입 검사 | `npx tsc --noEmit` | `0` | 오류 0건 통과 (allowJs: true 정상 적용, tsc exit 0) | `logs/frontend_tsc.log` |
| **Frontend** | 린터 검사 | `npx eslint .` | `0` | 오류 0건 통과 (Flat Config, eslint exit 0) | `logs/frontend_eslint.log` |
| **Frontend** | 포매터 검사 | `npx prettier --check .` | `0` | `All matched files use Prettier code style!` | `logs/frontend_prettier.log` |
| **Frontend** | 단위/컴포넌트 테스트 | `npx vitest run` | `0` | `2 passed (2), 4 passed (4) in 1.30s (StatusBadge + Router)` | `logs/frontend_vitest.log` |
| **Frontend** | 운영 번들 빌드 | `npx vite build` | `0` | `dist/assets/index-BBMBVMnN.js (146.42 kB) built in 2.85s` | `logs/frontend_vite_build.log` |
| **Frontend** | E2E 브라우저 실행 | `npx playwright test` | `0` | `1 passed (1.4s) (시스템 Chrome 144 연동, 277ms)` | `logs/frontend_playwright.log` |
| **Frontend** | 보안 취약점 감사 | `npm audit` | `0` | `found 0 vulnerabilities` | `logs/frontend_npm_audit.log` |
| **Backend** | 가상환경 격리 생성 | `uv venv --python 3.12.3` | `0` | `Using CPython 3.12.3 interpreter at: /usr/bin/python3.12` | `logs/backend_uv_venv.log` |
| **Backend** | 잠금파일 일치 설치 | `uv sync --locked` | `0` | `Resolved 43 packages in 1ms, Installed 41 packages in 47ms` (락 불변) | `logs/backend_uv_sync.log` |
| **Backend** | 린터 검사 | `uv run --frozen ruff check .` | `0` | `All checks passed!` | `logs/backend_ruff_check.log` |
| **Backend** | 포매터 검사 | `uv run --frozen ruff format --check .` | `0` | `1 file already formatted` | `logs/backend_ruff_format.log` |
| **Backend** | 기능/스모크 테스트 | `uv run --frozen pytest -v` | `0` | `4 passed in 1.62s (SQLite WAL/FK, Argon2, Pydantic, FastAPI)` | `logs/backend_pytest.log` |
| **Backend** | 보안 취약점 감사 | `uv audit` | `0` | `Found no known vulnerabilities and no adverse project statuses in 42 packages` | `logs/backend_uv_audit.log` |

---

## 7. 개발 명령 계약 및 저장소 운영 제안

선행 확정된 인간 결정 **Q1=A**에 따라, 루트 통합 도구나 러너 없이 `frontend/`와 `backend/` 디렉터리에서 각각 독립 실행하는 명령 계약을 제시한다:

### 7.1 프론트엔드 명령 계약 (`cd frontend`)

`package.json`의 `scripts` 필드에 실제로 선언된 명령 목록과 1:1로 일치한다 (`[실측]`):

```bash
# 1. 의존성 설치 (락파일 변경 금지)
npm ci

# 2. 계약 검증 및 TypeScript 타입 생성 (무백엔드 Phase 1 필수)
npm run openapi:lint      # npx redocly lint contracts/openapi.yaml
npm run openapi:generate  # npx openapi-typescript contracts/openapi.yaml -o src/contracts/api.d.ts

# 3. 변경 감지 검증 (CI용)
git diff --exit-code src/contracts/api.d.ts

# 4. 정적 타입 검사 및 린트/포맷
npm run typecheck         # npx tsc --noEmit
npm run lint              # npx eslint .
npm run format:check      # npx prettier --check .

# 5. 테스트
npm run test              # npx vitest run
npm run test:e2e          # npx playwright test

# 6. 개발 서버 및 빌드
npm run dev               # vite
npm run build             # tsc -b && vite build
```

### 7.2 백엔드 명령 계약 (`cd backend`)

```bash
# 1. 가상환경 및 잠금파일 기반 동기화 (락파일 변경 금지)
uv venv --python 3.12.3
uv sync --locked

# 2. 린트 및 서식 검사
uv run --frozen ruff check .
uv run --frozen ruff format --check .

# 3. 테스트 실행
uv run --frozen pytest

# 4. 보안 감사
uv audit

# 5. 개발 서버 실행
uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

---

## 8. [조사 범위 6] 범위 제한 (Scope Limitations) 준수 선언

본 조사는 사실 확보를 위한 조사 연구이며, 다음 범위 제한을 엄격히 준수하였다 (`[문서 근거: 이슈 #27 범위 6]`):

1. **임시 검증용 산출물 격리**:
   - `docs/research/dependency-lock-compatibility/` 내의 파일들은 도구 호환성과 잠금 동작을 증명하기 위한 최소 재현 fixture이며, 애플리케이션 프로덕션 코드나 프로젝트 scaffold가 아니다.
2. **main 및 프로덕션 파일 불변**:
   - main 브랜치 및 저장소 루트에 제품 파일, 설정, lockfile을 추가하거나 수정하지 않았다.
3. **외부 환경 및 보안 경계 준수**:
   - 실제 운영/배포 계정, 비밀 키, 실제 회원 데이터, 실제 외부 인터넷 사이트 검사를 일체 수행하지 않았다.
4. **라우팅 불변**:
   - 라우팅 규칙 파일(`mattpocock_skill_routing.json`, `herdr_orchestrator.md`)을 수정하지 않았다.
5. **독립 결정권 보존**:
   - 본 연구로 원본 UI 시각 합격 판정, SSRF 방어 최종 승인, 운영 배포 승인, 또는 상위 의사결정 티켓([이슈 #15](https://github.com/DomineYH/vibe_coding_archive/issues/15))의 완료를 자의적으로 선언하지 않는다.

---

## 9. 완료 기록 요구사항 (Completion Record) 대조표

이슈 #27의 '완료 기록' 요구사항과의 1:1 대조 결과:

| 요구사항 항목 | 보고서 내 위치 | 상세 내용 및 링크 |
|---|---|---|
| **1차 출처 URL과 확인 시점, 기존 후보 대비 변경 이유, 정확한 직접/주요 전이 의존성·runtime·도구 버전표** | §1.2, §2.1, §2.2, §4.1, §5.1 | 2026-09-24 기준 27개 1차 출처 수록, `anyio 4.12.1 -> 4.14.2` 취약점 패치 교체, 정확한 lockfile 기계 추출 버전표 |
| **실제 검증한 조합과 문서상 가능성·추론·미검증의 구분, 실패한 조합 및 원인** | §2, §3, §4, §5 | [실측], [문서 근거], [추론], [미검증] 라벨 구분. 원본 JSX 무수정 구동 불가 원인(ESM export 부재) 규명, anyio 구버전 실패 원인 기록 |
| **실제 설치·잠금·깨끗한 재설치·생성/검증 명령의 작업 디렉터리·종료 코드·핵심 결과와 manifest/lockfile 해시** | §6.1, §6.2, `logs/` | `/tmp` 격리 실행 명령 전수 기록, 17개 단계 실제 종료 코드 수록, SHA-256 해시표 대조, 상세 로그 및 `run_summary.log` 보존 |
| **frontend/backend의 독립 명령 계약 후보, lockfile 관리·재현성·업데이트 검증 조건** | §7.1, §7.2 | Q1=A 준수 독립 실행 명령 계약, `npm ci` 및 `uv sync --locked` 기반 락파일 불변 재현성 절차 확립 |
| **남은 제약·후속 검증·사람이 최종 선택할 사항** | §10 | React Router 최종 버전 선택, 글꼴 시각 동등성 브라우저 캡처 검증, OpenAPI 저장소 영구 위치 과제 명시 |

---

## 10. 한계 및 후속 결정 과제 (HITL)

본 조사를 통해 확보된 기술적 사실을 바탕으로, 다음 사항은 후속 개발 기반 결정 티켓([이슈 #15](https://github.com/DomineYH/vibe_coding_archive/issues/15))에서 사람이 최종 확정해야 한다:

1. **React Router 버전 최종 선택 (Option A vs Option B)**:
   - *Option A (`6.30.6`)*: 원본 JSX 보존에 유리하나 업스트림 패치 중단. backslash open redirect 방지를 위해 모든 `<Link>`/`navigate()` 경로에 대한 애플리케이션 가드 검증 필수 (`[추론]`).
   - *Option B (`7.18.4`)*: audit 취약점 0건이며 React 18과 렌더링 호환 확인. 단, 원본 UI 전체 화면과의 완전한 라우팅 호환성은 Phase 1 구현 시 E2E 테스트로 검증 필요 (`[미검증]`).
2. **글꼴 번들링 방식 (`pretendard@1.3.9`)**:
   - npm 로컬 번들링으로 오프라인 결정성은 확보되었으나, OS별(Linux/macOS/Windows) 폰트 래스터라이저 차이에 따른 픽셀 단위 렌더링 일치 여부는 Phase 1의 실제 브라우저 캡처 비교로 판정해야 한다 (`[미검증]`).
3. **OpenAPI 디렉터리 영구 위치**:
   - 백엔드와 프론트엔드가 공유하는 단일 계약 파일의 위치(`frontend/contracts/openapi.yaml` vs 저장소 공용 `contracts/openapi.yaml` vs `docs/openapi.yaml`) 확정 필요.
