# #231 approved product baselines

Ten new states: dirty edit discarded after another tab logs out, and an uncertain keyed write discarded after identity change. Each is captured at 1440×1000, 1024×900, 768×1024, 390×844 and 360×844. Capture command: locked, memory-capped Playwright with the b231 Linux mock wrapper, `e2e/app-edit.spec.js --grep '231.*(교사김코딩|unknown)'`; final result **2 PASS**, `coord/b231/logs/capture231-final.log`.

Product source `frontend/src/app/app.jsx` SHA-256: `378693a1ae4ebfc338c7cee5bb34eb7d1977f925df5a487f98442dfb4fe6e4af`. The final delivery SHA is recorded in `coord/b231/report-impl231.md`. The snapshot starts from test checkpoint `679d4a3` over #232 base `2de9784`, with the final product/test changes copied from the worktree. Captures contain synthetic mock data only. Demo account names/passwords are the existing public mock panel, not real credentials.

Approval scope **I231-L**: these ten new images only. Approval source: [accepted #231 triage brief](https://github.com/DomineYH/vibe_coding_archive/issues/231#issuecomment-6116288597) + coordinator approval **2026-10-12**. The coordinator reviewed dirty-logout-360 and unknown-logout-1440: a single non-sensitive status below Header, no identifiers in the notice, unknown wording makes no unsaved claim. Recorder: **Codex gpt-6.1-sol**, **2026-10-12**. No human visual, screen-reader, physical-device or CI acceptance is claimed.

The shared-context two-tab flows use real mock logout UI and the exact edit return. Every viewport checks a single role=status, aria-live=polite, one visible main, no horizontal overflow, and Tab access from Header. Creation toast expiration is awaited before capture; no existing image, crop, mask or tolerance is changed. The uncertain mock write is already committed (version 2), so its notice does not assert that saving failed and does not offer automatic replay. Real HTTP/database write-count evidence is separate in `e2e-api/auth-loss-edit.spec.js`.

| Viewport | Dirty logout | Unknown logout |
| --- | --- | --- |
| 1440×1000 | [PNG](231-dirty-logout-1440x1000.png) | [PNG](231-unknown-logout-1440x1000.png) |
| 1024×900 | [PNG](231-dirty-logout-1024x900.png) | [PNG](231-unknown-logout-1024x900.png) |
| 768×1024 | [PNG](231-dirty-logout-768x1024.png) | [PNG](231-unknown-logout-768x1024.png) |
| 390×844 | [PNG](231-dirty-logout-390x844.png) | [PNG](231-unknown-logout-390x844.png) |
| 360×844 | [PNG](231-dirty-logout-360x844.png) | [PNG](231-unknown-logout-360x844.png) |

[Actual PNG dimensions and SHA-256 ledger](ledger.json). Viewport captures are new baselines with no previous image to compare; they do not resolve the separate existing auth visual sequence limitations in the implementation report.
