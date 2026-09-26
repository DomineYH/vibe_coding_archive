#40 local run evidence

Issue: [#40 app registration, preview, and save](https://github.com/DomineYH/vibe_coding_archive/issues/40). Parent spec: [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30). Decision sources: [#8](https://github.com/DomineYH/vibe_coding_archive/issues/8), [#12](https://github.com/DomineYH/vibe_coding_archive/issues/12), [#13](https://github.com/DomineYH/vibe_coding_archive/issues/13), [#15](https://github.com/DomineYH/vibe_coding_archive/issues/15), and [#29](https://github.com/DomineYH/vibe_coding_archive/issues/29).

## Scope and evidence

This record covers the Phase 1 deterministic mock implementation: approved-member registration, form preview and validation, app create/result contracts, local operation-key storage, explicit rejected/unknown recovery, and route/navigation behavior. No real backend, database, HTTP request, DNS lookup, health probe, or cookie security behavior is claimed.

The requirement-by-requirement expected result, reproduction command, execution evidence, actual result, and human review status are recorded in [the acceptance table](../../../../acceptance.md#issue-40-app-registration-preview-and-save). UI differences and five-viewport dimensions are recorded in [UI deviations](../../../../ui-deviations.md#issue-40-app-registration-preview-and-save). Visual captures and comparison JSON are in [`visual/`](visual/).

## TDD and browser failure history

- Service validation test first failed because `normalizeAppInput` was not exported; adding the shared service boundary made it pass. A leading-tab validation case then failed before its normalization rule was corrected.
- Mapper tests first failed because the app-write operation mapper was absent; the strict mapper and response shape then passed.
- API write tests first failed because create/key/result service methods were absent; the API adapter and operation result semantics then passed.
- The first added protected-route Playwright run redirected to login correctly but failed to find the auth form by an assumed accessible form name. The locator was changed to the existing `[data-screen-label="로그인"] form` wrapper, and the targeted `CI=true npm run test:e2e -- app-create.spec.js` rerun passed 9/9.
- The first full CI-equivalent sequence built API `dist/` but `npm run check:dist` rejected the source fixture-name placeholder in the new registration form. The placeholder now uses generic classroom-tool text; no check was relaxed, and the final API build check was rerun.
- An earlier ESLint run overlapped Playwright's cleanup of `test-results` and failed with `ENOENT`; running lint sequentially passed. No concurrent lint/browser process was used for final verification.

## Acceptance case trace

| Criterion | Coverage                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1       | Required inputs, defaults, selectors, visibility, preview, approved-member route, and five-viewport initial/error captures.                                              |
| AC2       | Unicode limits, normalization, newline and forbidden-character validation, invalid local URL rejection without probing, retained input, duplicate URL with distinct IDs. |
| AC3       | OpenAPI request/response and operation DTO, generated types, strict mapper, API adapter, deterministic mock owner/version/url-version/unchecked result.                  |
| AC4       | Confirmed create only: toast, app detail, refresh, reload, and return to the updated gallery.                                                                            |
| AC5       | Pending lock, explicit rejection preserving the draft, unresolved result check, explicit same-key retry, and committed response-loss lookup.                             |
| AC6       | In-memory draft/key, normalized dirty state, continue/discard navigation, and `beforeunload` guard.                                                                      |
| AC7       | Register/detail/reload/gallery, repeated click, key issue/create failure, reset-cleared operation key, delayed response, and mock/API separation.                        |
| AC8       | OpenAPI lint/generation check, TypeScript, mapper/service/API/mock tests, product E2E, API/mock build and API bundle exclusion.                                          |
| AC9       | Five required viewport comparisons, keyboard selectors/theme/visibility, labels and field errors, and unauthenticated route gate.                                        |
| AC10      | Final CI-equivalent frontend checks, full unit and browser suites, builds, bundle check, reference preservation, and one-worker CI visual suite.                         |
| AC11      | This record lists the first failure, fix, retest, limitations, and open items; captured input is synthetic.                                                              |

## Final verification

Run from `frontend/` in the same order as `.github/workflows/frontend-ci.yml`:

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

The final sequence passed: `npm run check` (OpenAPI lint/generated-types check, TypeScript, ESLint, Prettier), 276 unit tests across 21 files, 57 E2E tests with one worker, mock and API builds, API bundle check (96 files), source preservation (11/11), and 77 visual tests with one worker. The visual browser was pinned Chromium headless-shell `151.0.7922.34`; captures used DPR 1, `ko-KR`, `Asia/Seoul`, and the repository's fixed Korean font configuration. Command output was captured at `/tmp/impl40-final-ci.log`.

The first full sequence stopped at `check:dist`: the API bundle included the source mock fixture name from the registration name-field placeholder. That placeholder now uses a generic classroom example. The unchanged artifact check passed on the corrected final sequence. No source reference, generated type, lockfile, or visual baseline was changed.

## Visual evidence

The final suite produced 20 captures and `visual-comparison.json` in [`visual/`](visual/): the initial and validation-error forms compare against preserved `16-submit.png` and `17-submit-error.png` references at all five viewports; rejected and unknown writes are product-only at those same viewports. All 10 reference comparisons report `dimensions_mismatch`, so no pixel count is available:

| Viewport  | Initial form actual / reference height | Validation error actual / reference height |
| --------- | -------------------------------------: | -----------------------------------------: |
| 1440×1000 |                            1517 / 1528 |                                1726 / 1594 |
| 1024×900  |                            1517 / 1528 |                                1726 / 1594 |
| 768×1024  |                            2566 / 2577 |                                2775 / 2643 |
| 390×844   |                            2477 / 2512 |                                2686 / 2597 |
| 360×844   |                            2443 / 2478 |                                2652 / 2563 |

The comparison JSON records each result and the product-only capture heights. No source screenshot, visual baseline, or threshold was changed.

## Open and unverified

- Human UI-D and local handover approval remain with DomineYH.
- Real API/backend, database transactions, HTTP/CSRF/cookie behavior, cross-process operation storage, DNS/HTTP probes, and production health checks are outside this mock task.
- Full auth/write recovery remains assigned to T13; mock browser behavior is not server concurrency evidence.
- Hosted CI, physical-device checks, and human assistive-technology review are not represented by local test results.
