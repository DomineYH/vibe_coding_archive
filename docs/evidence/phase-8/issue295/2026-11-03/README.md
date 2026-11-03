# Issue #295 · I295-V · administrator source-reference size record

Recorded by Claude Opus 5.5 on 2026-11-03, measured at main `675f175`.

## Decision and change

Issue #295 option 2: the preserved source references under
[`basic-design-runtime-20260922/reference/`](../../../basic-design-runtime-20260922/reference/)
stay byte-unchanged, and the current size mismatch of the administrator
captures is recorded with reasons in
[`docs/ui-deviations.md` § I295-V](../../../../ui-deviations.md#i295-v--administrator-source-reference-size-record).
No reference, baseline PNG, mask, crop, threshold, spec or product file changed.
Human UI-D visual approval remains pending and is not claimed.

## Measurement

- Commit: `675f175` (clean tree), branch
  `docs/295-admin-visual-reference-record`.
- Renderer: Chrome for Testing headless shell `151.0.7922.34`
  (`PLAYWRIGHT_CHROMIUM_EXECUTABLE`), pinned by the spec; fontconfig RGB
  subpixel precheck passed.
- Command (from `frontend/`, mock data mode, local wrapper config pointing at
  the same spec):

  ```sh
  npm run test:visual -- --config=<wrapper>/playwright.visual.config.mjs visual/admin.spec.js
  ```

- Result: 5 passed (one test per viewport). The spec asserts only the capture
  width; reference comparisons are report-only (`comparisonEnforced: false`).

The comparison JSON written by the spec is copied into [`visual/`](visual/):
`visual-comparison.json` (all 65 captures of the run) and the per-capture
`admin-users-<WxH>.json` / `admin-health-<WxH>.json` files. Screenshots are not
committed.

## Results

Full-page size in px, product / reference. Every row is
`comparisonStatus: dimensions_mismatch`, so `differentPixels`,
`maxChannelDelta` and `bounds` are `null`.

| Viewport  | `admin-users` vs `18-admin-users.png` | `admin-health` vs `21-admin-health.png` |
| --------- | ------------------------------------- | --------------------------------------- |
| 1440×1000 | 1440×1378 / 1440×1111                 | 1440×1936 / 1440×1966                   |
| 1024×900  | 1024×1378 / 1024×1111                 | 1024×1936 / 1024×1966                   |
| 768×1024  | 768×1378 / 768×1218                   | 768×2263 / 768×2112                     |
| 390×844   | 390×1870 / 390×2456                   | 390×3812 / 390×2977                     |
| 360×844   | 360×2110 / 360×1560                   | 360×3829 / 360×3069                     |

`1440x1000/21-admin-health-component.png` (1014×73) is not captured or compared
by any current spec, so there is no product measurement for it.

The heights match the issue's observations at `3350a92` and the earlier
per-issue evidence: users equal the
[#46](../../../phase-1/issue46/2026-09-27/visual/visual-comparison.json) values;
health equals [#70](../../../phase-1/issue70/2026-09-27/visual/comparison.json)
plus the #287 schedule note (+43px at 1440/1024/768, +61px at 390/360).

No human visual, screen-reader, physical-device or cross-browser acceptance is
claimed.
