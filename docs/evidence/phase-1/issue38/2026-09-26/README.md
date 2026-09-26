# Issue #38 local run evidence

Run date: 2026-09-26 (Asia/Seoul). Branch: `impl/issue-38`, based on the checked-out `origin/main`. This run uses synthetic mock accounts and the local frontend only. It does not exercise a backend, database, real password hash, cookie, CSRF protection, or production session.

## Environment and scope

- Ubuntu 24.04 / WSL2 Linux x86_64; Node `22.23.2`, npm `12.0.2`; installed frontend dependencies.
- Playwright `1.63.0`; browser tests use the checked-in one-worker configuration. Visual Chromium: Chrome for Testing `151.0.7922.34`, DPR 1, locale `ko-KR`, timezone `Asia/Seoul`, clock `2026-09-22T00:12:00.000Z`.
- Visual font config: `frontend/visual/fontconfig.conf` (SHA-256 `4f48be107db00d167350b27e0f2b07c49e9fc01c460f005c22d7345ece6a7a67`); selected Noto Sans CJK JP font (SHA-256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`). Chromium binary SHA-256: `e11fc9ce65c96313476f7ee9844b6fb6a9220fb048693cfe9eee00acf4170a9f`.
- Fixed viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844.
- Scope follows [issue #38](https://github.com/DomineYH/vibe_coding_archive/issues/38), parent Phase 1 PRD [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30), and the password and session decisions in [#7](https://github.com/DomineYH/vibe_coding_archive/issues/7), [#12](https://github.com/DomineYH/vibe_coding_archive/issues/12), [#15](https://github.com/DomineYH/vibe_coding_archive/issues/15), [#23](https://github.com/DomineYH/vibe_coding_archive/issues/23), and [#29](https://github.com/DomineYH/vibe_coding_archive/issues/29).
- No source reference, baseline, browser font config, or pixel threshold changed. Human UI-D and local-handover approval remain pending.

## Implemented mock behavior

- Synthetic member and administrator temporary credentials are approved independently of their temporary-password expiry. An unapproved account is denied before an expired-credential response is considered.
- A change-only session ends at the earlier of login plus 15 minutes or the temporary credential expiry; equality is expired. Public browsing, password change, and logout remain available, while private detail and admin functions require a full session.
- Password changes normalize with NFC, enforce 15–128 Unicode code points, preserve surrounding whitespace, reject the current temporary password, and send confirmation only from the browser. Success consumes the temporary credential and upgrades to an eight-hour full mock session. The first temporary-admin change carries 15 minutes of recent-auth status.
- Delayed mock results re-check the current state before committing, so logout, reset, expiry, or a changed session generation rejects stale work. The mock has one shared principal; it cannot demonstrate independent-device revocation.
- The API adapter returns `FEATURE_UNAVAILABLE` for password change. The OpenAPI contract records the future API behavior but does not make the Phase 1 mock a production implementation.
- A common/breached-password list is not applied. The selected policy is a local, versioned, whole-normalized-password blocklist with no external lookup, but the repository has no rights-verified distributable dataset; see [password blocklist provenance](../../../../research/password-blocklist-provenance.md). Selecting a source and testing it remain open.

## TDD and failure/fix record

- Unit tests first exposed missing mapper, service, and mock-state behavior; implementation then followed the existing API/service/mapper seams.
- The first full unit run found synthetic temporary fixtures had shifted existing registration IDs. The new fixtures were separated from the original demo-account list and assigned IDs 900/901; the full unit suite then passed.
- The first full browser run passed 40/43. A legacy test helper created a principal without session data, and a login test expected the form button to remain visible during an auth transition. The helper now defaults to a full session when no session is supplied; the login test asserts the transition status and concealed form using a scoped locator. The password-change route test also uses its accessible status region. The focused rerun passed 3/3, followed by the final full run.

## Visual evidence

The final visual suite passed 72/72 with one worker. The five `auth-password-change` cases are product-only because no source screen exists. Their new comparison rows have `baseline: null`; existing screenshots and baselines were not edited. The full auth comparison record is [`visual/auth/visual-comparison.json`](visual/auth/visual-comparison.json).

| Viewport | Capture | Full-page image |
| --- | --- | --- |
| 1440×1000 | [auth-password-change-1440x1000.png](visual/auth/auth-password-change-1440x1000.png) | 1440×1000 |
| 1024×900 | [auth-password-change-1024x900.png](visual/auth/auth-password-change-1024x900.png) | 1024×900 |
| 768×1024 | [auth-password-change-768x1024.png](visual/auth/auth-password-change-768x1024.png) | 768×1024 |
| 390×844 | [auth-password-change-390x844.png](visual/auth/auth-password-change-390x844.png) | 390×844 |
| 360×844 | [auth-password-change-360x844.png](visual/auth/auth-password-change-360x844.png) | 360×855 |

Captures use the synthetic temporary member; both password fields are blank. The 360×844 viewport produces a full-page height of 855px due to document content and is not clipped.

## Final verification

Commands ran from `frontend/` unless a repository-root path is shown.

| Command | Result |
| --- | --- |
| `npm run check` | PASS: OpenAPI lint and generated-type parity, TypeScript, ESLint, and Prettier. |
| `npm test` | PASS: 19 files, 232/232 tests. |
| `CI=true npm run test:e2e` | PASS: 43/43 browser tests; Playwright config uses one worker. |
| `npm run build:mock` | PASS: mock frontend build. |
| `npm run build` | PASS: API-mode production build. |
| `npm run check:dist` | PASS: 96 API output files; no mock fixtures, Tweaks, references, or source maps. |
| `npm run check:reference` | PASS: all 11 preserved source/reference pairs match hashes and byte counts. |
| `CI=true FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` | PASS: 72/72 visual cases at one worker, five fixed viewports. |

The focused auth-transition and route-guard rerun also passed 3/3:

```sh
CI=true npm run test:e2e -- --workers=1 --grep 'late approval response|login validation identifies|password-change route requires'
```

## Open and unverified

- Rights-verified blocklist data is still required before common/breached passwords can be rejected.
- Real API/backend behavior, password hashing, cookie and CSRF security, server transaction ordering, and independently active-device session revocation are not implemented or verified; the API auth adapter remains unavailable.
- Hosted CI for this commit, human UI-D review, local handover approval, and release approval were not run or granted. `/code-review` is assigned to the independent reviewer.
- No real credentials, contact data, or secrets appear in the evidence.
