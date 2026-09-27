# Issue #71 gallery-loading capture stabilization — 2026-09-27

## Diagnosis and fix

Hosted runs [36295295247](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36295295247) and [36297209075](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36297209075) each failed one `gallery-loading` capture: 10 pixels at the rounded border of `input#gallery-search` differed by one channel value. The first failed at 768×1024 and the second at 1024×900. The input is at fractional y=372.5625px. `page.clock.runFor(40)` was present in the source used by run 36297209075 and did not prevent the failure.

The loading scenario pauses Playwright's clock before navigation so the mock's 300ms list delay remains pending. The old capture path awaited fonts but skipped the two post-font animation frames used by other states. Its page-global `requestAnimationFrame` cannot run under the paused clock, leaving no frame barrier before screenshot. We infer that this capture timing exposed a one-channel antialiasing difference along the fractional input border; this is consistent with the alternating CI viewports and clean local pixels.

CI and local used the same Chromium 151.0.7922.34, Noto Sans CJK JP font (SHA-256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`), Node 22.23.2, and npm 12.0.2. CI ran on GitHub's `ubuntu-24.04`; local ran on Ubuntu 24.04.3 under WSL2. Runner rendering hardware and scheduling are unavailable in the logs, so the remaining difference is host execution timing/environment rather than a known browser or font version difference.

The capture now awaits `document.fonts.ready`, then counts two native animation frames using `page.waitForFunction(..., { polling: "raf" })`. Playwright 1.63.0 source was checked: the clock saves the browser's original builtins before replacing timer APIs, `UtilityScript` uses those saved builtins, and the `raf` poller calls `injected.utils.builtins.requestAnimationFrame`. This wait therefore proceeds while the fake clock stays paused; the 300ms mock delay does not advance, and there is no resume/re-pause time race. A loading-status assertion immediately before screenshot creation confirms the mock is still pending.

The guaranteed rendering trigger is now the two native animation-frame boundaries after fonts are ready; they give Chromium rendering cycles to apply layout and rasterize the rounded edge before capture. We did not collect a renderer trace, so the one-channel delta's precise internal rasterization timing remains an inference.

The earlier clock-resume workaround passed its local repeat but was removed after review found a real-time race in `pauseAt()` and a possibility that a slow wait could let the 300ms delay expire. That earlier result is not counted as final verification.

No product CSS, source reference, comparison threshold, mask, or product baseline changed. The fractional position is unchanged; the final captures match the existing product references at zero differing pixels, so no source-vs-product rendering difference was introduced. `docs/ui-deviations.md` and `docs/acceptance.md` remain unchanged.

## Red/green evidence

| Check | Result |
| --- | --- |
| Hosted CI before fix, run 36295295247 | FAIL: `gallery-loading` at 768×1024; 10 pixels, maximum channel delta 1. |
| Hosted CI before fix, run 36297209075 | FAIL: `gallery-loading` at 1024×900; 10 pixels, maximum channel delta 1, despite `page.clock.runFor(40)`. |
| Local after final fix: `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual -- --repeat-each 30 --grep gallery-loading` | PASS: 150/150, one worker, 30 repeats across 1440×1000, 1024×900, 768×1024, 390×844, and 360×844; every capture has zero differing pixels. |
| Local full visual suite: `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | PASS: 122/122. |
| `npm run check` | PASS: OpenAPI lint/generated types, TypeScript, ESLint, and Prettier. |

The five final `gallery-loading` captures and per-viewport zero-difference reports are in [`visual/`](visual/); [`visual-comparison.json`](visual/visual-comparison.json) summarizes those five issue captures. No baseline files were changed.

Hosted repeated CI proof is pending: the coordinator will run CI after pushing this commit. The local repeat cannot confirm the GitHub runner's rendering schedule/hardware.
