# Fresh source replay — 2026-09-27

Command from repository root:

```bash
python3 docs/evidence/basic-design-runtime-20260922/capture.py --mode replay --har docs/evidence/basic-design-runtime-20260922/reference/cdn.har.zip --out /tmp/issue49-source-replay-2026-09-27-r1
python3 docs/evidence/basic-design-runtime-20260922/verify.py --candidate /tmp/issue49-source-replay-2026-09-27-r1
```

Runtime: Python 3.12.3, Playwright 1.62.0, Chromium 151.0.7922.34; started 2026-09-27T09:12:03.636044+00:00 UTC.

Replay captured 130 states across `1024x900, 1440x1000, 360x844, 390x844, 768x1024` (26×5). `sourcesUnchanged=true`; page errors 0; network failures 0; blocked requests 0. All 11 original files, byte sizes, and SHA-256 hashes are listed in [`sources.json`](sources.json). Stable state/text/input/layout/font metrics match for all 130 captures.

Integrity verification: **PASS**. Exact-pixel comparison: **125/135 identical; 10 different; `verify.py` exited 1 because zero-tolerance differences remain.** No masking, threshold, source, or baseline changed. Visual approval was not assessed.

| Capture                           | Pixels | Max channel delta | Saved replay PNG                                                         |
| --------------------------------- | -----: | ----------------: | ------------------------------------------------------------------------ |
| `360x844/03-gallery-empty.png`    |     20 |                42 | [`03-gallery-empty.png`](differences/360x844/03-gallery-empty.png)       |
| `360x844/05-copy-done.png`        |     20 |                22 | [`05-copy-done.png`](differences/360x844/05-copy-done.png)               |
| `360x844/11-login-pending.png`    |     20 |                22 | [`11-login-pending.png`](differences/360x844/11-login-pending.png)       |
| `360x844/08-login-error.png`      |     20 |                22 | [`08-login-error.png`](differences/360x844/08-login-error.png)           |
| `360x844/26-delete-complete.png`  |     89 |                18 | [`26-delete-complete.png`](differences/360x844/26-delete-complete.png)   |
| `390x844/10-signup-error.png`     |     20 |                22 | [`10-signup-error.png`](differences/390x844/10-signup-error.png)         |
| `390x844/06-detail-error-500.png` |     20 |                22 | [`06-detail-error-500.png`](differences/390x844/06-detail-error-500.png) |
| `390x844/09-signup.png`           |     20 |                22 | [`09-signup.png`](differences/390x844/09-signup.png)                     |
| `390x844/04-detail-public.png`    |     20 |                22 | [`04-detail-public.png`](differences/390x844/04-detail-public.png)       |
| `390x844/08-login-error.png`      |     20 |                22 | [`08-login-error.png`](differences/390x844/08-login-error.png)           |

Prior five source-only repetitions remain linked at [`original-repeat-summary.json`](../../../issue31/2026-09-25/original-repeat-summary.json); this single fresh replay does not replace them. The existing comparison is [`replay-comparison.json`](../../../../basic-design-runtime-20260922/checks/replay-comparison.json). The #47 CI-only search-border difference (10 pixels, maxChannelDelta 1) remains separately OPEN; fresh replay differences are recorded, not approved.
