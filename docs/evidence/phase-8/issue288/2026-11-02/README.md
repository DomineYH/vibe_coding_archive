# Issue #288 · I288-S · '창체' subject chip

Recorded by Claude Opus 5.5 on 2026-11-02, from base `c1615db`.

## Decision and actual change

Issue #288 adds `창체` to `contracts/catalog.json` between `정보` and `기타`.
The registration and edit forms render one chip per catalog subject, so the
교과 과목 group gains a ninth chip. Coordinator decision §7-D1 approves a scoped
re-baseline of `16-submit`, `17-submit-error` and `13-edit` at all five
viewports under [`visual-state-baselines/<WxH>/`](visual-state-baselines/). The
#105 and #216 PNGs are preserved unchanged; `frontend/visual/app-create.spec.js`
routes only these three names to this root.

The after PNGs were captured locally with the pinned Chrome 151.0.7922.34 and
the Noto Sans CJK JP hash precheck enforced by the spec. Unchanged states in the
same run matched their CI-made baselines at 0px, and `app-create.spec.js` then
passed 25/25 against this root. CI's threshold-0 visual job remains the
authority; if it disagrees, CI actuals replace these files.

- 1440×1000, 1024×900, 768×1024: dimensions unchanged; 657 differing pixels per
  image, all inside the 교과 과목 chip row (`창체` takes the slot of `기타`, which
  moves right).
- 390×844 and 360×844: `기타` wraps to a third chip row, so the page grows by
  42px from the insertion row onward. The off-group differences come from this
  +42px page reflow — re-rasterization of the thumbnail preview, theme swatches,
  public toggle and header (plus single rows of card edges and field borders);
  the images are visually identical outside the chip group.

## Before/after ledger

Bounds are inclusive full-page (x0,y0)–(x1,y1) in the after image. For 390/360,
pixels above the insertion row are compared unshifted and pixels below it are
compared 42px down; "off-group" counts every remaining difference outside the
chip group, listed as after-image row ranges:count.

| Viewport | Image | Before | Before SHA-256 | After SHA-256 | Size before→after | Differences |
|---|---|---|---|---|---|---|
| 1440x1000 | 16-submit | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/16-submit.png) | `c7038731a506efdc3edd95f9566988299d766640c1eceff6ce152cb9247f4d91` | [`4830d68ee53ffedd1b7ddc3a8eb88a01588a7ad65fd04c5ca1cb8b5f5c6b9730`](visual-state-baselines/1440x1000/16-submit.png) | 1440x1528→1440x1528 | 657px in chip row (687,905)–(788,940) |
| 1440x1000 | 17-submit-error | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/17-submit-error.png) | `0169aced25a0bae8fb5a6b3d221b6787ee5c7ea8d3c581de7bdee7db59a61ed5` | [`8b34c3b210c2b4273f382c116891d60c4c572cd95c3e45252e5cdd4386fc8644`](visual-state-baselines/1440x1000/17-submit-error.png) | 1440x1738→1440x1738 | 657px in chip row (687,1066)–(788,1101) |
| 1440x1000 | 13-edit | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1440x1000/13-edit.png) | `69073a6c79ef0eca1c40f690a8349ccea0993b918b5025b5311327a8e8c350a9` | [`ba832e3e151617c544a19f92680f3604b725577f160d6073cfd9fcc686f279b0`](visual-state-baselines/1440x1000/13-edit.png) | 1440x1528→1440x1528 | 657px in chip row (685,905)–(786,940) |
| 1024x900 | 16-submit | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/16-submit.png) | `23fe58695f8bf540e86ab109bae42fd7c0c89188187885d4c5b3d93fc85183bc` | [`8ab20b1dacbd3a6d57f40885237c0dbb5fc54739d1b54e5104120ae841c646d8`](visual-state-baselines/1024x900/16-submit.png) | 1024x1528→1024x1528 | 657px in chip row (507,905)–(608,940) |
| 1024x900 | 17-submit-error | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/17-submit-error.png) | `5935a2e239ba6d3fb792098887ff38c4dbdef3e36120238dab68057c82525552` | [`5b9d19763532b0c86c07ea1ddc12f94b3e10ebd53a4c805059850e93325209bc`](visual-state-baselines/1024x900/17-submit-error.png) | 1024x1738→1024x1738 | 657px in chip row (507,1066)–(608,1101) |
| 1024x900 | 13-edit | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/1024x900/13-edit.png) | `04a6c7a78443fcb6d37aaf10f5aff1e5f9f1c7c26038386d5631515a3a32c34f` | [`9a87730e58685f8f173b439ce02c6cd29ab7db11ce983c7a1b4432e9d256eb6d`](visual-state-baselines/1024x900/13-edit.png) | 1024x1528→1024x1528 | 657px in chip row (505,905)–(606,940) |
| 768x1024 | 16-submit | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/16-submit.png) | `0449b065cf876c9abc3bde4ce3d8bffd8a6fbce81c80d151d9b47f6717198c37` | [`4e777da43d5b89dabd4a8f98deb1702e5bc3102bef89d979ae716e3986ee788d`](visual-state-baselines/768x1024/16-submit.png) | 768x2600→768x2600 | 657px in chip row (507,905)–(608,940) |
| 768x1024 | 17-submit-error | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/17-submit-error.png) | `e464ce041314d4753bcf6b478f3e96181118da7628d144cca13745ff2c3b8f26` | [`b5f6f3eb32decbef880b31529714ed58cc25d9733ca287bba38f51d7dfde43ad`](visual-state-baselines/768x1024/17-submit-error.png) | 768x2809→768x2809 | 657px in chip row (507,1066)–(608,1101) |
| 768x1024 | 13-edit | [#105](../../../phase-2/issue105/2026-09-30/visual-state-baselines/768x1024/13-edit.png) | `7ba644de685b2b4cfe3d462c3296c728c92fa4977c3b5907066fbff418f6a0be` | [`ea848881979a4758d1753aa1c4985a3ade3e2508be188b544e2fb375bc830793`](visual-state-baselines/768x1024/13-edit.png) | 768x2600→768x2600 | 657px in chip row (505,905)–(606,940) |
| 390x844 | 16-submit | [#216](../../../phase-7/issue216/2026-10-11/visual-state-baselines/390x844/16-submit.png) | `114ca63d909ce6252cb147aa405aa78580c271acae68f37a1088cf176cde7898` | [`0830c9e57d1b474665f5247d7edbbb8050a88b3ccd7b6ce81c5fb83e02015be4`](visual-state-baselines/390x844/16-submit.png) | 390x2535→390x2577 | 42px chip row inserted at y=1003; chip-row 978-990:237; off-group 27728px: 15-15:3, 21-22:16, 27-28:45, 32-33:14, 36-36:2, 40-43:12, 1271-1271:2, 1740-1931:17893, 1980-2052:4448, 2059-2129:5272, 2284-2292:21 |
| 390x844 | 17-submit-error | [#216](../../../phase-7/issue216/2026-10-11/visual-state-baselines/390x844/17-submit-error.png) | `d0a8ed7ba9f5bbbd3d8c1f26cc0d29f6f0230e6c997d5195cc973041ca858180` | [`815c8d2f7b11b43f2cd6a13b815d80fbec828aa4668fcc378abac67a264a418b`](visual-state-baselines/390x844/17-submit-error.png) | 390x2744→390x2786 | 42px chip row inserted at y=1165; chip-row 1140-1152:237; off-group 26617px: 1949-2141:18118, 2190-2260:4994, 2269-2339:3487, 2582-2587:18 |
| 390x844 | 13-edit | [#216](../../../phase-7/issue216/2026-10-11/visual-state-baselines/390x844/13-edit.png) | `d6ccda5fea97b7a46ff55dae6595cf45a9a01cfb007dd9999931745efdecbca1` | [`6de0f577e5b935afdc7f70d32257aee5d51a2e9b4078f7dacbcb644fbbc63acf`](visual-state-baselines/390x844/13-edit.png) | 390x2535→390x2577 | 42px chip row inserted at y=1003; chip-row 978-990:237; off-group 27669px: 15-15:3, 21-22:16, 27-28:45, 32-33:14, 36-36:2, 40-43:12, 474-474:1, 653-653:3, 1271-1271:2, 1740-1931:17830, 1980-2052:4448, 2059-2129:5272, 2284-2292:21 |
| 360x844 | 16-submit | [#216](../../../phase-7/issue216/2026-10-11/visual-state-baselines/360x844/16-submit.png) | `6f3673c411908b7b34144be1026165133f7ebf31bb694215e64c304048596741` | [`1116f7ced1e9b4bdfe5e110d7b1de0863a9ff8aaa3fd7f71f5dddd7723b7afc8`](visual-state-baselines/360x844/16-submit.png) | 360x2501→360x2543 | 42px chip row inserted at y=1003; chip-row 978-990:237; off-group 19961px: 1271-1271:2, 1740-1912:13949, 1961-2024:3549, 2033-2095:2437, 2322-2331:24 |
| 360x844 | 17-submit-error | [#216](../../../phase-7/issue216/2026-10-11/visual-state-baselines/360x844/17-submit-error.png) | `922239bf2ee0189646e26d4ca0a1d5d5d43b27b2af5680391b685404d3fddd6e` | [`4ea5ca326cd86d589973f1f19ec86b4dc47b6edaa52b26c04e1f0149bbb659fb`](visual-state-baselines/360x844/17-submit-error.png) | 360x2711→360x2753 | 42px chip row inserted at y=1165; chip-row 1140-1152:213; off-group 23718px: 15-15:3, 21-22:16, 27-28:41, 32-33:14, 36-36:2, 40-43:12, 790-790:5, 1294-1296:50, 1336-1338:50, 1587-1592:15, 1841-1845:17, 1949-2122:14391, 2171-2233:4074, 2242-2305:5026, 2352-2352:2 |
| 360x844 | 13-edit | [#216](../../../phase-7/issue216/2026-10-11/visual-state-baselines/360x844/13-edit.png) | `ba0f18263d711676a291d61dbcbf966c283be0f2175f0c29188b264d3ccfb47e` | [`ac821008e37a29cb1ac29979da305a327bed821d13f25ea06919347a45132ab8`](visual-state-baselines/360x844/13-edit.png) | 360x2501→360x2543 | 42px chip row inserted at y=1003; chip-row 978-990:237; off-group 19471px: 1271-1271:2, 1740-1912:13461, 1961-2024:3549, 2033-2095:2437, 2322-2331:22 |

Comparisons keep full-page PNGs, dimension checks and a 0px threshold, with no
masks, crops or tolerance. No human visual, screen-reader, physical-device or
cross-browser acceptance is claimed.
