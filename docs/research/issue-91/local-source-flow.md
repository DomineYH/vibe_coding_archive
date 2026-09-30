# app-create·gallery-loading 소스 흐름

조사일: 2026-09-30. 기준: 로컬 커밋 `fd862a68e7c606d75fffb50408d1366dcb9fd28c`.
대상: [[Task] app-create·gallery-loading 로컬 반복 재현 증거 수집](https://github.com/DomineYH/vibe_coding_archive/issues/103)의 실행 설계를 위한 소스 조사. 이 문서 자체는 실행 결과나 원인 확정이 아니다. `CONTEXT.md`의 재현 캡처·보존본 구분을 따른다.

## 확인한 사실

- 공통 실행은 1 worker, 비병렬, 테스트 전체 60초, assertion 15초다. locale/timezone/배율/reducedMotion/colorScheme/serviceWorker와 Chromium 경로를 고정한다. Vite는 고정 `localhost:5173`, 기존 서버 재사용 금지다. [설정](../../../frontend/playwright.visual.config.js#L4)
- 현행 CI는 Ubuntu 24.04, `.nvmrc`, npm 12.0.2, lockfile 설치, Noto CJK fontconfig, Chromium headless-shell 151.0.7922.34를 사용한다. 브라우저 기본 설치와 visual용 pinned 설치는 별도다. 과거 실패 CI의 npm 10.9.8과 현행 설정 차이를 재현 환경 기록에 남겨야 한다. [현행 CI](../../../.github/workflows/frontend-ci.yml#L42), [과거 CI 조사](ci-evidence.md)
- 두 spec은 beforeAll에서 브라우저 버전 및 Noto Sans CJK JP 파일 SHA-256을 검사한다. 이는 환경 확인이며 폰트/브라우저 실행 순간의 부하가 같다는 증거는 아니다. [app-create 검사](../../../frontend/visual/app-create.spec.js#L162), [gallery 검사](../../../frontend/visual/gallery.spec.js#L74)

### app-create

- `app registration form`은 viewport별 테스트다. clock install → 초기화 → 로그인 → `/apps/new` → 초기 폼 → validation error → rejected → unknown → expired의 다섯 캡처가 하나의 60초 예산을 공유한다. expired는 마지막 268행이다. [호출 흐름](../../../frontend/visual/app-create.spec.js#L182)
- `capture`는 `document.fonts.ready` → 두 `requestAnimationFrame` → mouse move → full-page screenshot(animations disabled/caret hide) → 브라우저 내 PNG decode/픽셀 비교 → 파일·attachment 순서다. page clock을 pause하는 호출은 이 spec에 없다. 각 구간의 호스트 경과시간을 구분해야 screenshot 진입 전 누적 지연과 내부 지연을 구분할 수 있다. [공통 helper](../../../frontend/visual/app-create.spec.js#L132)
- 이 helper는 등록·수정·인증 확인 중 draft 비표시·대상 없음·소유자로 로그인한 비공개 앱 상세 캡처 모두에서 호출된다. baseline이 있는 캡처도 comparison 수치를 기록하되 이 helper의 assertion은 이미지 너비뿐이다. 따라서 테스트 통과를 baseline 픽셀 일치로 해석하면 안 된다. [등록 호출부](../../../frontend/visual/app-create.spec.js#L210), [수정 호출부](../../../frontend/visual/app-create.spec.js#L300), [인증 확인 중 비표시](../../../frontend/visual/app-create.spec.js#L407), [대상 없음](../../../frontend/visual/app-create.spec.js#L459), [비공개 앱 상세](../../../frontend/visual/app-create.spec.js#L480)

### gallery-loading과 인증 복원

- `captureAndCompare`는 일반 갤러리·상세·추가 상태·component 테스트가 공유한다. loading은 `scenario: list_delayed, apps: []`를 주입하고 `/`로 이동한다. mock 목록은 이 scenario에서 300ms timer를 기다린다. [helper 및 scenario](../../../frontend/visual/gallery.spec.js#L248), [호출부](../../../frontend/visual/gallery.spec.js#L665), [목록 timer](../../../frontend/src/services/mock/apps.ts#L397)
- loading 경로는 전역 `page.getByRole("status")`에 텍스트 assertion을 건다(424, 433, 525, 539행). 최초 확인 → 두 RAF → `Date.now()+10`에서 clock pause → 재확인 → fonts ready → RAF polling counter 3회 → screenshot 전후 재확인이다. [loading 진입](../../../frontend/visual/gallery.spec.js#L423), [pause 이후 캡처 흐름](../../../frontend/visual/gallery.spec.js#L486)
- 앱의 mock 인증 초기 상태는 `checking`이다. mount effect가 `restoreAuth()`를 호출하며 이 함수도 checking을 설정하고 protected query 취소를 await한 뒤 인증 서비스 결과를 반영한다. 헤더는 checking 중 자체 `role=status`를 렌더링한다. 갤러리 loading도 별도 `role=status`다. 두 요소가 동시에 존재할 수 있는 렌더 경로가 소스에 있다. [초기 auth](../../../frontend/src/app/app.jsx#L1361), [restoreAuth](../../../frontend/src/app/app.jsx#L1472), [mount effect](../../../frontend/src/app/app.jsx#L1810), [헤더](../../../frontend/src/app/app.jsx#L160), [갤러리](../../../frontend/src/features/gallery/view-gallery.jsx#L279)
- 인증 복원은 mount 외에도 로그인 등 인증 작업, mock reset/storage, history POP, visibility/focus/pageshow, retry에서 호출된다. 따라서 갤러리 검증 전 최초 인증만 기다리는 변경으로 모든 status 중첩 가능성이 없어지는 것은 아니다. [인증 작업](../../../frontend/src/app/app.jsx#L1586), [복원 이벤트](../../../frontend/src/app/app.jsx#L1827), [retry 연결](../../../frontend/src/app/app.jsx#L1925)
- mock 인증 서비스의 명시적 300ms 지연은 `auth_delayed` scenario에만 있다. loading의 `list_delayed`와 단일 scenario 필드를 공유하므로 두 scenario를 동시에 지정하는 재현은 원래 상태를 보존하지 않는다. [인증 관찰](../../../frontend/src/services/mock/auth.ts#L406), [loading fixture](../../../frontend/visual/gallery.spec.js#L273)
- gallery는 comparison 후 `differentPixels === 0`을 실제 검사한다. `VISUAL_BASELINE_CAPTURE=1`은 일부 baseline을 덮어쓰므로 일반 반복 재현에서는 지정하지 않아야 한다. [baseline 쓰기](../../../frontend/visual/gallery.spec.js#L542), [픽셀 assertion](../../../frontend/visual/gallery.spec.js#L596)

## 가설 및 필요한 판별 증거

- **gallery:** 인증 status와 loading status의 동시 존재가 전역 locator 모호성을 만드는 것은 CI 로그와 소스가 지지한다. 실제 자연 발생 스케줄은 아직 미확인이다. 현재 두 status의 텍스트·개수와 인증 상태 전환을 기록하고, 강제 지연 실험은 자연 반복과 별도 표시한다. 제품 인증 흐름을 약화시키거나 임의 sleep을 추가할 근거는 없다.
- **app-create:** 마지막 캡처 실패라는 CI 관찰은 누적 시간, fonts/RAF, screenshot, 비교 단계 중 원인을 구분하지 못한다. 각 캡처 시작·종료 및 남은 테스트 예산을 기록한다. fake-clock의 `Date.now()`와 구분되는 호스트 단조시계를 사용한다. 반복 성공은 실패 부재의 제한된 관찰이며 CI 원인 해소 증거가 아니다.
- **clock/RAF:** gallery만 pause 이후 별도 RAF polling을 쓴다. 이것을 app-create screenshot timeout의 원인으로 연결할 직접 증거는 없다. 두 서명을 같은 원인으로 합치지 않는다.

소스 조사 범위에서 baseline 또는 허용 오차 변경을 권장하지 않는다. 제품 코드·테스트·설정 수정과 GitHub 작업은 수행하지 않았다.
