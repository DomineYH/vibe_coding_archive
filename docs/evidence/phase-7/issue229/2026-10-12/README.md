# Issue #229 detail description evidence · I229-W

Recorded by Codex gpt-6.1-sol on 2026-10-12 in Chrome 151.0.7922.34.
Approval source: [the adopted #229 triage brief](https://github.com/DomineYH/vibe_coding_archive/issues/229#issuecomment-6116286240), under DomineYH's prior delegation and the coordinator's #229 work order. I229-W permits wrapping long description strings and the necessary card/paragraph height change. Earlier UI-D approvals do not authorize this change.

These are **product-only observations**, not new visual baselines. The fixture contains 4,000 consecutive `A` characters, a 2,027-character URL, and Korean text with two consecutive spaces, blank lines and a newline. The prompt independently contains 4,000 consecutive `P` characters to verify its existing internal horizontal scrolling and exact clipboard copy. No data truncation or inserted whitespace is used. The production change adds `overflow-wrap: anywhere` only to the description paragraph and retains `word-break: keep-all` and `white-space: pre-wrap`.

## Measured behavior

[Geometry records](geometry.json) retain every browser measurement. The test asserts exact complete description text, all text-range bounds inside the paragraph, paragraph and page scroll widths (1px rounding tolerance), Korean word-break/whitespace behavior, prompt overflow/copy and the app link.

| Viewport | Before scroll/client width | After scroll/client width | Paragraph height before → after | Page scroll/client width after |
| --- | --- | --- | --- | --- |
| 360×844 | 36000/270 | 270/270 | 1435.6875 → 4936.75 | 360/360 |
| 390×844 | 36000/300 | 300/300 | 1435.6875 → 4634.5 | 390/390 |
| 1440×1000 | 36000/602 | 602/602 | 730.4375 → 2317.25 | 1440/1440 |

Before: text-range containment fails at every width; the page viewport itself stays narrow while description content overflows. After: every text range is contained and all description characters remain available. Full-page Chromium captures include the oversized layout overflow before the fix, so before PNG width exceeds the viewport; captures are preserved without cropping or masking.

## Captures and hashes

All six captures are full-page PNGs, with device scale factor 1 and a frozen fixture clock. The screenshot dimensions below are image dimensions, distinct from viewport and paragraph dimensions.

| Capture | PNG dimensions | SHA-256 |
| --- | --- | --- |
| [before-360.png](before-360.png) | 36045×3112 | `51847dfc374a54278eb04895aa17447abe59a1879c822f6616db27719fb583af` |
| [before-390.png](before-390.png) | 36045×3106 | `47a8761b313e843671e7ee7d1eb74deca14b4ff02443d209da23e1e9087c0dcb` |
| [before-1440.png](before-1440.png) | 36237×1768 | `a6c4d2babd4e75dda539d2826a7fa316fe80e77841cd99b675468d97ca2733e6` |
| [after-360.png](after-360.png) | 360×6613 | `ea67643cdf99a24b6ef675de3f5e33b1b7825b2ac1a40cf18c414927f5467b4b` |
| [after-390.png](after-390.png) | 390×6305 | `9d638cde50fc30a4ca97b45cc2698495542ee9bedbae0d653f679cd5c9c8d6bb` |
| [after-1440.png](after-1440.png) | 1440×3355 | `007950aa2adfd493195eadcf049c02af3b2cd72faa510a1f69f7d97a78d21e99` |

## Existing detail states

The existing `visual/gallery.spec.js` detail, copy-success, detail component and four health-card states passed **31/31 before and 31/31 after**. Viewports: 1440×1000, 1024×900, 768×1024, 390×844 and 360×844. Browser/font prerequisites passed; the b160 historical `DejaVu Sans Mono` versus `Liberation Mono` failure did not reproduce.

In addition to unchanged historical comparison regions, [full-image before/after comparisons](normal-pixel-comparison.json) found **0 changed pixels in all 31 ordinary captures**, with identical dimensions and SHA-256 hashes. No mask, crop or relaxed tolerance was introduced. No historical source or baseline PNG was regenerated, and no I229-W replacement baseline is needed.

## Reproduction

From `frontend`, source the coordinator environment and use the Chrome-pinned wrapper with the shared lock and memory cap:

```bash
source /home/dominelinux/.cache/vibe_coding_archive/coord/issue121-resume-env.sh
flock /home/dominelinux/.cache/vibe_coding_archive/coord/b227/heavy.lock systemd-run --user --scope -q -p MemoryMax=5G -p MemorySwapMax=512M npx playwright test --config=/home/dominelinux/.cache/vibe_coding_archive/coord/b229/playwright.mock.config.mjs e2e/detail-layout.spec.js
flock /home/dominelinux/.cache/vibe_coding_archive/coord/b227/heavy.lock systemd-run --user --scope -q -p MemoryMax=5G -p MemorySwapMax=512M npm run test:visual -- --config=/home/dominelinux/.cache/vibe_coding_archive/coord/b229/playwright.visual.config.mjs visual/gallery.spec.js --grep 'public detail|detail key component|health-'
```

Red/green logs and environment retry details are recorded in the implementation report at `/home/dominelinux/.cache/vibe_coding_archive/coord/b229/report-impl229.md`. Automated verification does not claim human visual, screen-reader or physical-device acceptance; CI and independent review remain coordinator gates.
