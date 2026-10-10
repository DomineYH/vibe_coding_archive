# Issue #216 · I216-C · cancel label readability

Recorded by Codex gpt-6.1-sol on 2026-10-11, from base `30332df`.

## Decision and actual change

[The adopted #216 triage recommendation](https://github.com/DomineYH/vibe_coding_archive/issues/216#issuecomment-6095807918)
uses DomineYH's prior delegation to approve only keeping “취소” on one line and
any necessary adjacent description reflow/height. The original reproduced
registration screen also wrapped the two characters; this is a readability
improvement, not an original-port regression or an extension of #105 approval.

Only the local `SubmitView` header changes: `min-w-0` on the description block
and `shrink-0 whitespace-nowrap` on both cancel controls. Both original
navigation paths, accessible name, keyboard activation and visible focus remain.
No shared button, copy, color, font, data, API or other header changes.

The **actual** pixel change is narrower than the approved scope: only the cancel
label changes. Description wrapping, header/form heights and every other pixel
remain identical. At 390px, 337 pixels differ inside inclusive bounds
(336,153)–(358,181); at 360px, 339 differ inside (306,153)–(328,181), identically
for all three states. All nine wider images are 0px matches, so they retain #105.
Six changed mobile images receive new versioned baselines. Full-page dimensions
are unchanged in all 15 pairs.

Delegated approval scope and automated results are separate: the recommendation
supplies the narrow approval; image bounds, hashes, DOM checks and final strict
comparisons supply implementation evidence. No fresh human visual approval,
screen-reader, physical-device or cross-browser acceptance is claimed.

## Before/after image ledger

The unchanged pre-implementation UI passed the complete app-create visual suite
25/25, including all 20 strict comparisons. Thus #105 PNGs are exact before
captures and are reused without duplicating them. The table links full PNGs;
no images are cropped, masked or compared with a tolerance. Header evidence is
the full images plus exact change bounds and DOM rectangles in
[the per-image ledger](baseline-approval.json). Its DOM rectangles are viewport
coordinates; validation-error rectangles include the recorded scroll offset to
translate to full-page coordinates. The historical before SHA-256 is recorded
for every pair; the table shows the after SHA-256.

| State                       | Viewport  | Changed? | Evidence                                                                                                                                                                                                                                         | PNG dimensions | Changed pixels | Inclusive change bounds | After SHA-256                                                      |
| --------------------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------- | ----------------------- | ------------------------------------------------------------------ |
| app-create                  | 1440x1000 | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/16-submit.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/16-submit.png)             | 1440×1528      | 0              | none                    | `c7038731a506efdc3edd95f9566988299d766640c1eceff6ce152cb9247f4d91` |
| app-create                  | 1024x900  | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/16-submit.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/16-submit.png)               | 1024×1528      | 0              | none                    | `23fe58695f8bf540e86ab109bae42fd7c0c89188187885d4c5b3d93fc85183bc` |
| app-create                  | 768x1024  | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/16-submit.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/16-submit.png)               | 768×2600       | 0              | none                    | `0449b065cf876c9abc3bde4ce3d8bffd8a6fbce81c80d151d9b47f6717198c37` |
| app-create                  | 390x844   | yes      | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/390x844/16-submit.png) / [after](visual-state-baselines/390x844/16-submit.png)                                                                          | 390×2535       | 337            | (336,153)–(358,181)     | `114ca63d909ce6252cb147aa405aa78580c271acae68f37a1088cf176cde7898` |
| app-create                  | 360x844   | yes      | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/360x844/16-submit.png) / [after](visual-state-baselines/360x844/16-submit.png)                                                                          | 360×2501       | 339            | (306,153)–(328,181)     | `6f3673c411908b7b34144be1026165133f7ebf31bb694215e64c304048596741` |
| app-create-validation-error | 1440x1000 | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/17-submit-error.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/17-submit-error.png) | 1440×1738      | 0              | none                    | `0169aced25a0bae8fb5a6b3d221b6787ee5c7ea8d3c581de7bdee7db59a61ed5` |
| app-create-validation-error | 1024x900  | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/17-submit-error.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/17-submit-error.png)   | 1024×1738      | 0              | none                    | `5935a2e239ba6d3fb792098887ff38c4dbdef3e36120238dab68057c82525552` |
| app-create-validation-error | 768x1024  | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/17-submit-error.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/17-submit-error.png)   | 768×2809       | 0              | none                    | `e464ce041314d4753bcf6b478f3e96181118da7628d144cca13745ff2c3b8f26` |
| app-create-validation-error | 390x844   | yes      | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/390x844/17-submit-error.png) / [after](visual-state-baselines/390x844/17-submit-error.png)                                                              | 390×2744       | 337            | (336,153)–(358,181)     | `d0a8ed7ba9f5bbbd3d8c1f26cc0d29f6f0230e6c997d5195cc973041ca858180` |
| app-create-validation-error | 360x844   | yes      | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/360x844/17-submit-error.png) / [after](visual-state-baselines/360x844/17-submit-error.png)                                                              | 360×2711       | 339            | (306,153)–(328,181)     | `922239bf2ee0189646e26d4ca0a1d5d5d43b27b2af5680391b685404d3fddd6e` |
| app-edit                    | 1440x1000 | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/13-edit.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/13-edit.png)                 | 1440×1528      | 0              | none                    | `69073a6c79ef0eca1c40f690a8349ccea0993b918b5025b5311327a8e8c350a9` |
| app-edit                    | 1024x900  | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/13-edit.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/13-edit.png)                   | 1024×1528      | 0              | none                    | `04a6c7a78443fcb6d37aaf10f5aff1e5f9f1c7c26038386d5631515a3a32c34f` |
| app-edit                    | 768x1024  | no       | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/13-edit.png) / [after](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/13-edit.png)                   | 768×2600       | 0              | none                    | `7ba644de685b2b4cfe3d462c3296c728c92fa4977c3b5907066fbff418f6a0be` |
| app-edit                    | 390x844   | yes      | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/390x844/13-edit.png) / [after](visual-state-baselines/390x844/13-edit.png)                                                                              | 390×2535       | 337            | (336,153)–(358,181)     | `d6ccda5fea97b7a46ff55dae6595cf45a9a01cfb007dd9999931745efdecbca1` |
| app-edit                    | 360x844   | yes      | [before](../../../../../docs/evidence/phase-2/issue105/2026-09-30/visual-state-baselines/360x844/13-edit.png) / [after](visual-state-baselines/360x844/13-edit.png)                                                                              | 360×2501       | 339            | (306,153)–(328,181)     | `ba0f18263d711676a291d61dbcbf966c283be0f2175f0c29188b264d3ccfb47e` |

## Reproduction and preservation

- Browser: Chrome for Testing / headless shell **151.0.7922.34**; sRGB,
  `--disable-partial-raster`, DPR 1, light scheme, reduced motion, ko-KR,
  Asia/Seoul, frozen time **2026-09-22T00:12:00.000Z**, existing deterministic mock
  data and scenario flows.
- Fonts: worktree `frontend/visual/fontconfig.conf`, Noto Sans CJK JP SHA-256
  `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`,
  user-installed Liberation **2.1.5**, matching the coordinator's CI preparation.
- Local Node **24.21.0** / npm **12.2.0**, authorized for local evidence; CI's
  pinned toolchain remains the gate. No dependency or lockfile changes/install.
- Browser suites run serially with one worker under
  `systemd-run --user --scope -q -p MemoryMax=6G -p MemorySwapMax=512M`.
  Branch-local wrapper configs/caches are in
  `/home/dominelinux/.cache/vibe_coding_archive/coord/b216/`.
- Original source/preserved copies passed `check:reference` 11/11. All 20 #105
  PNGs are additionally checked against their pre-work SHA-256 values; no old
  baseline or source artifact is rewritten.
- A separate temporary runner captured post-change product-only images before
  selecting these six additions. These captures are candidate observations,
  not baseline comparison passes. Its initial import resolution failure was
  corrected without product changes. A diagnostic viewport/full-page coordinate
  mismatch was corrected with explicit scroll offsets and five registration
  recaptures; no pixel difference was exempted.

## Automated acceptance

- Red: [four failures on the unchanged product](logs/cancel-red.log), each
  expecting one text rectangle and observing two, at 360/390 for registration
  Link and edit callback button.
- Green: [4/4](logs/cancel-green.log). Range rectangles detect wrapping;
  containment, header separation and document width detect clipping/overlap/
  overflow. Accessible name “취소”, keyboard Tab/Enter, visible outline and
  gallery/detail destinations are asserted through the rendered UI.
- [Submit-view unit checks](logs/submit-view-after.log): **11/11** after the
  product change, with `--maxWorkers=1` and isolated caches.
- [Frontend check](logs/check.log): OpenAPI, generated contract, types, lint and
  formatting passed; the two existing OpenAPI warnings remain.
  [Final touched-file lint](logs/lint-touched.log) also passed after spec routing.
- [Source preservation](logs/reference.log): **11/11**. [Before visual suite](logs/visual-before.log): **25/25**.

- [Full affected mock E2E](logs/mock-affected.log): **36/36** registration/edit tests.
- [Final visual run](logs/visual-final.log): **134/134** in one serial invocation,
  retries 0: app-create **25/25**, auth **15**,
  admin **5**, gallery **89**. Gallery passes locally.
- [Final app-create comparison](verification/visual-comparison.json): **70**
  records, **20 full-PNG comparisons**, every dimension matched and every pixel
  difference/max channel delta **0**. This includes the six new mobile product
  baselines, nine unchanged wider form baselines and five unchanged private
  detail baselines. The other **50** records are `product_only` observations
  with null comparison metrics, not successful image comparisons.
- [Verification summary](verification/summary.json) additionally checks the
  SHA-256 of all 15 final form-state captures against this ledger and preserves
  all 20 historical #105 PNG hashes. No comparison helper, mask, crop, threshold,
  timeout or retry relaxation is introduced.

The separately retained candidate/observation PNGs and browser runner artifacts
are under `/home/dominelinux/.cache/vibe_coding_archive/coord/b216/` and
`frontend/test-results/visual/`. Only the six changed baseline PNGs are added to
the repository; historical full before PNGs are reused by link.

API E2E, full unit/backend suites, hosted CI and human/device acceptance were
not run: this change is local header CSS plus browser checks/baseline routing,
with no API/schema/backend change. CI and independent review belong to the
coordinator's next step. No push, PR, rebase, reset, deployment or merge is done.
