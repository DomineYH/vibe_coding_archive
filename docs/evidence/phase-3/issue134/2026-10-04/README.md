# Issue #134 — empty archive evidence

State: `gallery-empty-archive`, mock `empty` scenario, successful zero public apps with default applied search/subject/grade. DomineYH's 2026-10-04 decision selects B, the copy “아직 공개된 앱이 없어요” / “앱이 공개되면 여기에 표시돼요.”, and B1 (no added registration CTA). Condition text and reset are absent. **Visual approval: PENDING**; DomineYH must review these five product-only captures before merge.

From `frontend`, after sourcing `~/.cache/vibe_coding_archive/coord/issue121-resume-env.sh`:

```bash
systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=512M npx playwright test --config=playwright.impl134-visual.config.js visual/gallery-impl134-scratch.spec.js --grep 'gallery-empty(-archive)? '
```

Result: **10/10 passed**. All five existing conditioned `gallery-empty` full-page comparisons report **0 differing pixels**. All five new states report `comparisonStatus: product_only` and `baseline: null`. No source reference, existing baseline, comparison region or tolerance changed; no snapshots were updated.

Environment: Linux/WSL, Node 24.21.0, npm 12.2.0, Chromium headless shell 151.0.7922.34, device scale 1, ko-KR, Asia/Seoul, reduced motion, light scheme, sRGB and partial raster disabled. The brief-authorized untracked scratch copy removes only the existing `beforeAll` font preflight because local Liberation Mono is missing. Gallery captures use the existing font configuration and Pretendard assets; an untracked Vite config adds the real path of symlinked `node_modules` to the serving allow list and uses a temporary cache. Scratch files were removed before commit and copies retained under `/home/dominelinux/.cache/vibe_coding_archive/coord/b134/`.

| Viewport | Product-only PNG | Full-page image dimensions |
| --- | --- | --- |
| 1440×1000 | [Capture](gallery-empty-archive-1440x1000.png) | 1440×1000 |
| 1024×900 | [Capture](gallery-empty-archive-1024x900.png) | 1024×900 |
| 768×1024 | [Capture](gallery-empty-archive-768x1024.png) | 768×1024 |
| 390×844 | [Capture](gallery-empty-archive-390x844.png) | 390×865 |
| 360×844 | [Capture](gallery-empty-archive-360x844.png) | 360×904 |

The mobile screenshots preserve the complete page, so image height exceeds viewport height. Automated capture and pixel checks do not constitute DomineYH's visual approval.

Logs: `/home/dominelinux/.cache/vibe_coding_archive/coord/b134/logs/134-visual.log`. The initial concurrent run passed nine cases and timed out before the first conditioned 1440px capture completed; `134-visual-initial.log` retains that result. The unchanged command passed all ten when rerun after the full unit suite finished.
