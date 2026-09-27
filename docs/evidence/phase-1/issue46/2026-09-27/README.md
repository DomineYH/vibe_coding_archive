# Issue #46 implementation evidence — 2026-09-27

Scope: Phase 1 administrator deletion of an ordinary member in the deterministic mock, with the OpenAPI/client contract and explicit operation-result recovery. Decision boundaries follow [parent #30](https://github.com/DomineYH/vibe_coding_archive/issues/30), the capability gate in [#24](https://github.com/DomineYH/vibe_coding_archive/issues/24), and operation-result semantics in [#13](https://github.com/DomineYH/vibe_coding_archive/issues/13). No live backend or database deletion is claimed.

## Implementation trace

`contracts/openapi.yaml` → generated TypeScript contract → strict operation mapper → API/service → deterministic mock → inline admin member UI. A delete key binds the target and expected public-plus-private app count. The mock checks the current admin session, current target role, and count when issuing and applying the operation. It removes the target, credentials, owned apps, and actor-owned mock work; current account/app views and caches refresh coherently. A same-count app composition change remains eligible.

Reauthentication returns only a validated target and, when present, the known operation key/count. The prompt requires explicit confirmation or cancellation after a fresh target/count read. Unresolved, rejected, `confirming_deletion`, and succeeded outcomes remain distinct. A pending confirmation response is not rollback; unknown outcomes read the known key, and only an explicit same-key retry while unresolved can retry. Absence of the target does not imply historical success. Admin deletion capability flags remain disabled under #24; the API adapter implements only the contract boundary.

## TDD and recovery findings

Mapper/API/service cases first failed because `user_delete` was absent; the contract, adapter, mock, and UI implementation made them pass. Unit coverage includes reauthentication, protected admins, changed app count, same-count composition, deletion cleanup, queued reset/approval ordering, migration, and result recovery.

The first full E2E run passed 93/94; an existing gallery-search URL debounce assertion timed out. Its isolated test passed, and the complete CI-mode rerun passed all 94 tests. No gallery code was changed.

The full visual suite passed 101/102; `gallery-failure` at 1440×1000 differed by 10 pixels with max channel delta 1. The same case passed in isolation. The five admin deletion captures then passed in the focused admin visual run. No reference, baseline, or threshold changed.

## Verification

Commands ran from `frontend/` unless noted.

| Command                                                                                                                                                                                                | Result                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                                                                                                                        | PASS: OpenAPI lint and generated-type check, TypeScript, ESLint, and Prettier.                                                                     |
| `npm test`                                                                                                                                                                                             | PASS: 21 files, 340 tests.                                                                                                                         |
| `CI=true npm run test:e2e`                                                                                                                                                                             | PASS on final run: 94 tests, one Playwright worker. First full attempt had the gallery timing failure described above.                             |
| `npm run build:mock`                                                                                                                                                                                   | PASS; Vite reports a 580.06 kB minified mock chunk above its 500 kB advisory threshold.                                                            |
| `npm run build && npm run check:dist`                                                                                                                                                                  | PASS: API bundle; 96 files and no mock fixtures, tweaks, references, or source maps.                                                               |
| `npm run check:reference`                                                                                                                                                                              | PASS: all 11 preserved originals match SHA-256 and byte counts.                                                                                    |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual`                         | 101/102 passed on pinned Chromium 151.0.7922.34; one 10-pixel, max-delta-1 existing gallery baseline mismatch. Isolated retry of that case passed. |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual -- visual/admin.spec.js` | PASS: five admin viewport cases.                                                                                                                   |
| `git diff --check`                                                                                                                                                                                     | PASS.                                                                                                                                              |

## Five-viewport evidence

The preserved `19-admin-user-confirm.png` was compared at the five CI viewports with zero pixel tolerance. Full-page product/reference heights are 1493/1189, 1493/1189, 1493/1296, 2064/2592, and 2304/1696 pixels at 1440×1000, 1024×900, 768×1024, 390×844, and 360×844. Every comparison reports a dimension mismatch and no pixel count. The source shows no owned apps while the seeded product target has four; narrow member details and actions also wrap differently.

Product screenshots: [1440×1000](visual/admin-user-delete-confirm-1440x1000.png), [1024×900](visual/admin-user-delete-confirm-1024x900.png), [768×1024](visual/admin-user-delete-confirm-768x1024.png), [390×844](visual/admin-user-delete-confirm-390x844.png), [360×844](visual/admin-user-delete-confirm-360x844.png). Per-state comparison data: [visual-comparison.json](visual/visual-comparison.json). Human UI-D approval remains pending.

## Unverified and pending

- No production API/database transaction, server-side authorization, durable operation record, HTTP auth/CSRF enforcement, or cross-device session revocation is implemented or verified.
- Hosted CI, human UI-D approval, screen-reader/device review, and local handover acceptance remain pending. No push, PR, or merge is part of this work.
