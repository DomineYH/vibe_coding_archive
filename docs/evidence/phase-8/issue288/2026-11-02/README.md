# Issue #288 · I288-S · '창체' subject chip

Recorded by Claude Opus 5.5 on 2026-11-02, from base `c1615db`.

## Decision and actual change

Issue #288 adds `창체` to `contracts/catalog.json` between `정보` and `기타`.
The registration and edit forms render one chip per catalog subject, so the
교과 과목 group gains a ninth chip. Coordinator decision §7-D1 approves a scoped
re-baseline of `16-submit`, `17-submit-error` and `13-edit` at all five
viewports under `visual-state-baselines/<WxH>/` in this directory. Earlier
#105 and #216 PNGs are preserved unchanged; `frontend/visual/app-create.spec.js`
routes only these three names to this root.

**Status: PENDING.** The after PNGs are not committed yet. The local pinned
Chrome 151 + Noto Sans CJK JP precheck passed, but the narrow-viewport diffs are
not confined to the subject group (below), so the images await the CI
`visual-test-results` artifact and a coordinator decision.

Measured on the local pinned renderer (before = committed baseline,
after = local candidate capture; `17-submit-error` was not reached because each
test stops at its first mismatch):

- 1440×1000, 1024×900, 768×1024: 657 differing pixels per image, same
  dimensions, bounds (x0,y0)–(x1,y1) inside the 교과 과목 chip row:
  1440 `16-submit` (687,905)–(788,940), `13-edit` (685,905)–(786,940);
  1024/768 `16-submit` (507,905)–(608,940), `13-edit` (505,905)–(606,940).
- 390×844 and 360×844: `기타` wraps to a third chip row, the page becomes 42px
  taller (390: 2535→2577, 360: 2501→2543). After aligning for that shift, pixels
  still differ outside the group: thumbnail preview and theme swatches
  (y≈1740–2129, ~20–28k px), the public toggle (≤24 px), one card edge row
  (2 px) and, at 390 only, the header row (y 15–43, ~90 px).

## Before/after ledger

| Viewport | Image | Before (SHA-256) | After |
|---|---|---|---|
| 1440x1000 | [16-submit.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/16-submit.png) | `c7038731a506efdc3edd95f9566988299d766640c1eceff6ce152cb9247f4d91` | PENDING |
| 1440x1000 | [17-submit-error.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/17-submit-error.png) | `0169aced25a0bae8fb5a6b3d221b6787ee5c7ea8d3c581de7bdee7db59a61ed5` | PENDING |
| 1440x1000 | [13-edit.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/13-edit.png) | `69073a6c79ef0eca1c40f690a8349ccea0993b918b5025b5311327a8e8c350a9` | PENDING |
| 1024x900 | [16-submit.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/16-submit.png) | `23fe58695f8bf540e86ab109bae42fd7c0c89188187885d4c5b3d93fc85183bc` | PENDING |
| 1024x900 | [17-submit-error.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/17-submit-error.png) | `5935a2e239ba6d3fb792098887ff38c4dbdef3e36120238dab68057c82525552` | PENDING |
| 1024x900 | [13-edit.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/13-edit.png) | `04a6c7a78443fcb6d37aaf10f5aff1e5f9f1c7c26038386d5631515a3a32c34f` | PENDING |
| 768x1024 | [16-submit.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/16-submit.png) | `0449b065cf876c9abc3bde4ce3d8bffd8a6fbce81c80d151d9b47f6717198c37` | PENDING |
| 768x1024 | [17-submit-error.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/17-submit-error.png) | `e464ce041314d4753bcf6b478f3e96181118da7628d144cca13745ff2c3b8f26` | PENDING |
| 768x1024 | [13-edit.png](../../../phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/13-edit.png) | `7ba644de685b2b4cfe3d462c3296c728c92fa4977c3b5907066fbff418f6a0be` | PENDING |
| 390x844 | [16-submit.png](../../../phase-7/issue216/2026-10-11/visual-state-baselines/390x844/16-submit.png) | `114ca63d909ce6252cb147aa405aa78580c271acae68f37a1088cf176cde7898` | PENDING |
| 390x844 | [17-submit-error.png](../../../phase-7/issue216/2026-10-11/visual-state-baselines/390x844/17-submit-error.png) | `d0a8ed7ba9f5bbbd3d8c1f26cc0d29f6f0230e6c997d5195cc973041ca858180` | PENDING |
| 390x844 | [13-edit.png](../../../phase-7/issue216/2026-10-11/visual-state-baselines/390x844/13-edit.png) | `d6ccda5fea97b7a46ff55dae6595cf45a9a01cfb007dd9999931745efdecbca1` | PENDING |
| 360x844 | [16-submit.png](../../../phase-7/issue216/2026-10-11/visual-state-baselines/360x844/16-submit.png) | `6f3673c411908b7b34144be1026165133f7ebf31bb694215e64c304048596741` | PENDING |
| 360x844 | [17-submit-error.png](../../../phase-7/issue216/2026-10-11/visual-state-baselines/360x844/17-submit-error.png) | `922239bf2ee0189646e26d4ca0a1d5d5d43b27b2af5680391b685404d3fddd6e` | PENDING |
| 360x844 | [13-edit.png](../../../phase-7/issue216/2026-10-11/visual-state-baselines/360x844/13-edit.png) | `ba0f18263d711676a291d61dbcbf966c283be0f2175f0c29188b264d3ccfb47e` | PENDING |

Comparisons keep full-page PNGs, dimension checks and a 0px threshold, with no
masks, crops or tolerance. No human visual, screen-reader, physical-device or
cross-browser acceptance is claimed.
