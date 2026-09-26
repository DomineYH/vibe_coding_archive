#41 local run evidence

Issue: [#41 app editing, visibility, and URL changes](https://github.com/DomineYH/vibe_coding_archive/issues/41). Parent: [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30). Decision sources: [#8](https://github.com/DomineYH/vibe_coding_archive/issues/8), [#12](https://github.com/DomineYH/vibe_coding_archive/issues/12), [#13](https://github.com/DomineYH/vibe_coding_archive/issues/13), [#15](https://github.com/DomineYH/vibe_coding_archive/issues/15), and [#29](https://github.com/DomineYH/vibe_coding_archive/issues/29).

## Scope and evidence

This record covers the Phase 1 deterministic mock and API contract: an approved full-session owner edits their own app, handles expected-version conflict and write-result recovery, changes visibility, and updates URL health state. It does not claim a real backend, database, HTTP request, authentication transport, health probe, or production job cancellation.

The requirement-by-requirement expected result, command, execution evidence, actual result, and human review state are recorded in the [acceptance table](../../../../acceptance.md#issue-41-app-editing-visibility-and-url-changes). UI differences and fixed viewport comparisons are recorded in [UI deviations](../../../../ui-deviations.md#issue-41-app-editing-visibility-and-url-changes). Product screenshots and `visual-comparison.json` are in [`visual/`](visual/).

## TDD and browser failure history

- Service tests first failed because partial patch normalization and omitted/null wire mapping were absent; the shared service boundary was added and the service tests passed.
- Mapper and API tests first failed because `app_update`, `PATCH /apps/{id}`, and update operation methods were absent; the strict mapper/API adapter and contract then passed.
- Mock tests first failed because the update operation lifecycle, version checks, and URL health behavior were absent; update behavior and fixtures were added and the mock tests passed.
- The first owner edit E2E assertion failed because the detail page had no `앱 수정` entry. The owner route and form were added. A later permission test initially used the wrong demo admin password; it now uses the documented `admin123` fixture password, and the final targeted edit E2E suite passed 8/8.
- The acceptance-record contract test first failed because no #41 AC rows/evidence README existed. Its next run caught an unescaped table delimiter in the test command; the command was corrected, all 11 AC rows and this README were added, and the targeted contract test passed 8/8.
- Initial `npm run format:check` flagged ten edited frontend files. Prettier formatted only those files; the repeated format check, typecheck, and lint passed.
- The final late-response coverage adds a delayed update auth-change check and a browser case for blocking navigation until update confirmation; the focused mock and edit E2E reruns passed.

## Final verification

Commands are run from `frontend/`. The final command sequence follows `.github/workflows/frontend-ci.yml`, including CI-mode browser suites with the workflow's one worker:

```sh
npm run check
npm test
CI=true npm run test:e2e
npm run build:mock
npm run build
npm run check:dist
npm run check:reference
FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual
```

The final sequence passed: `npm run check` (OpenAPI lint and generated-type check, TypeScript, ESLint, and Prettier); 290 unit tests across 21 files; 65 E2E tests with one worker; mock and API builds; API bundle check (96 files with no mock fixtures/references/source maps); and source preservation (11/11). The mock build emitted Vite's advisory about its 511.37 kB JavaScript chunk exceeding 500 kB. The pinned visual suite passed 87/87 with one worker using Chromium headless-shell `151.0.7922.34` and the fixed Korean font configuration. Focused update/service/API/mapper/OpenAPI/acceptance tests passed 83/83 across six files, and `CI=true npm run test:e2e -- e2e/app-edit.spec.js` passed 8/8.

## Visual evidence

The pinned visual suite covers the edit screen, private detail screen, version conflict, latest-content lookup failure, validation error, confirmed rejection, and unresolved operation at 1440×1000, 1024×900, 768×1024, 390×844, and 360×844. The evidence contains 35 issue-specific screenshots and comparison records: 10 comparisons against preserved `13-edit.png` and `12-detail-private.png`, and 25 product-only captures for error/recovery states with no source equivalent. The baseline comparisons all report dimension mismatches without pixel counts. No source reference, baseline, or comparison threshold changed. The screenshots use deterministic synthetic fixture content.

## Open and unverified

- Human UI-D, local handover, physical-device, and assistive-technology approval remain pending.
- Real API/backend, database transactions, HTTP/session/cookie security, production concurrency, and production health-job cancellation are outside the mock implementation.
- T13 compound authentication-history checks and T15 admin app management remain out of scope; administrators cannot edit another member's app here.
- Hosted CI and production behavior are not represented by local test results.
