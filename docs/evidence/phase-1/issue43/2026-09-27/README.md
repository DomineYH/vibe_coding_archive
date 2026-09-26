#43 local run evidence

Issue: [#43 app write outcome confirmation, conflict, and hidden draft recovery](https://github.com/DomineYH/vibe_coding_archive/issues/43). Parent: [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30). Decision sources: [#8](https://github.com/DomineYH/vibe_coding_archive/issues/8), [#13](https://github.com/DomineYH/vibe_coding_archive/issues/13), [#15](https://github.com/DomineYH/vibe_coding_archive/issues/15), [#23](https://github.com/DomineYH/vibe_coding_archive/issues/23), and [#29](https://github.com/DomineYH/vibe_coding_archive/issues/29).

This record covers mock/API contract behavior only. Operation keys and drafts are held in the current tab; there is no real backend, database, persistent idempotency store, or production authentication transport. The requirements, expected outcomes, and human acceptance state are traced in the [acceptance record](../../../../acceptance.md#issue-43-app-write-result-confirmation-conflict-and-hidden-draft-recovery), and the source/product differences are in [UI deviations](../../../../ui-deviations.md#issue-43-app-write-outcomes-conflicts-and-hidden-draft-recovery).

## TDD failure history

- The API operation confirmation test first failed because a valid app write response returned success without reading the operation record. The API service now reads the same key and requires a succeeded record with the expected kind and target.
- The mismatched-key test then showed that a succeeded record for another key could confirm the write. Create, update, and delete result lookups now require the returned key to match the requested key; the red test now passes.
- API retry and result-lookup unit cases first showed that retry 401/410 and lookup 401/404/410/503 did not remain unknown. Those paths now preserve uncertainty.
- The mock expiry test first advanced beyond both the operation key and mock session. The test now refreshes the same synthetic member session to isolate the 24-hour operation window; it then exposed operation expiry being reported as rejection and status lookup ignoring the expiry, which were fixed.
- The unresolved-create E2E first showed disabled text fields, preventing selection/copy. Text fields are now read-only while mutation controls remain disabled.
- The auth-return browser case needed both blur and focus events to exercise the existing observation flow; after that it verified repeated failure concealment and same-member restoration.
- The first expired-create assertion scoped a page-level alert to the form. It now uses the page alert and explicitly checks that the expired operation cannot be retried.
- TypeScript first rejected a temporary operation-state code outside the shared error-code union. It now uses the existing unknown `SERVICE_UNAVAILABLE` outcome, and typecheck passed.
- The missing-target browser case confirms the operation record, then verifies success feedback and current detail unavailability without recreating the app.

## Final verification

Commands follow `.github/workflows/frontend-ci.yml`; browser suites used `CI=true` and one worker. The final suite passed:

| Command                                                                                                                                                                                       | Result                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `cd frontend && npm run check`                                                                                                                                                                | PASS · OpenAPI lint/generated-type check, TypeScript, ESLint, and Prettier.             |
| `cd frontend && npm test`                                                                                                                                                                     | PASS · 314 tests across 21 files.                                                       |
| `cd frontend && CI=true npm run test:e2e`                                                                                                                                                     | PASS · 77 tests with one worker.                                                        |
| `cd frontend && npm run build:mock`                                                                                                                                                           | PASS · Vite emitted its non-blocking 523.45 kB chunk-size advisory.                     |
| `cd frontend && npm run build && npm run check:dist`                                                                                                                                          | PASS · API build; 96-file output contains no mock fixtures, references, or source maps. |
| `cd frontend && npm run check:reference`                                                                                                                                                      | PASS · all 11 original files and preserved copies match.                                |
| `cd frontend && FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | PASS · 102 visual tests with one worker.                                                |

Focused implementation checks also passed: API/mock app-write units 38/38; create E2E 14/14; selected edit/delete E2E 5/5; targeted create visual checks 15/15; concealed-create plus delete visual checks 10/10; and the issue #43 acceptance trace 1/1. These targeted runs preceded the final full suite.

## Visual evidence

[`visual/app-create/`](visual/app-create/) contains 70 screenshots and its comparison JSON; [`visual/app-delete/`](visual/app-delete/) contains 40 screenshots and its comparison JSON. These cover create, edit, auth concealment, missing targets, delete, and recovery states at 1440×1000, 1024×900, 768×1024, 390×844, and 360×844. The JSON records 50 create/edit product-only captures, 30 delete product-only captures, and 30 source dimension mismatches; mismatched dimensions have no pixel counts. All 102 visual tests passed with Chromium 151.0.7922.34 and Noto Sans CJK JP (SHA-256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`). Original references, baselines, and the zero-pixel threshold remain unchanged.

## Open and unverified

- Real backend atomicity, database transactions, cross-client races, persistent operation-key storage, HTTP/session/cookie/CSRF enforcement, and production auth behavior are not implemented or tested.
- Human UI-D, physical-device, screen-reader, source-difference, and local-handover acceptance remain pending with DomineYH; hosted CI is not run because this task does not push or open a PR.
- No real personal data is included in tests or screenshots. The final /code-review step is skipped as requested; the independent reviewer runs it next.
