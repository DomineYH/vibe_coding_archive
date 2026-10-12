# #232 approved product baselines

Source snapshot: 28af5d9c8f5523147236e8b217247c4effc75703, 2026-10-12.
Command: locked, memory-capped Playwright with the b232 Linux mock wrapper, `e2e/app-edit.spec.js -g '232 foreground'`.
Result: 1 PASS; `logs/linux-mock-proof.log`.

Ten new captures: proof-loss recovery main with corrected header/concealed edit and visible keyboard focus; re-proven authentication with explicit “편집으로 돌아가기”. Each is captured at 1440×1000, 1024×900, 768×1024, 390×844 and 360×844. `ledger.json` records actual PNG dimensions and SHA-256. Synthetic mock member/app/draft only; no tokens or credentials are shown.

The test verifies foreground save without an initiating blur/focus/storage event, exact UUID edit return, no accessible edit form during loss, Tab/Enter and focus outline, no horizontal overflow, and same-flow/identity restoration after controlled mock proof restoration. Auth restoration is not a save trigger. Real-cookie proof-loss tests are separate.

These states have no previous baseline. No original-port artifact, historical product baseline, crop, mask or comparison threshold is changed. Repository destination: `docs/evidence/phase-7/issue232/2026-10-12/` (PNG files, this ledger and a final README). Human visual, screen-reader, physical-device and CI acceptance are not claimed by the automated captures.

Approval scope: **I232-R**, the ten new proof-loss/recovery-ready states only. Delegated approval source: [accepted #232 triage brief](https://github.com/DomineYH/vibe_coding_archive/issues/232#issuecomment-6116289844) and coordinator approval **2026-10-12**. The coordinator reviewed proof-loss-1440 and recovery-ready-390 and approved the corrected authentication header, concealed form and visible recovery actions. Recorder: **Codex gpt-6.1-sol**, **2026-10-12**. No human acceptance is claimed. Historical baselines remain unchanged.

| Viewport | Proof loss | Re-proven authentication |
| --- | --- | --- |
| 1440×1000 | [PNG](proof-loss-1440.png) | [PNG](recovery-ready-1440.png) |
| 1024×900 | [PNG](proof-loss-1024.png) | [PNG](recovery-ready-1024.png) |
| 768×1024 | [PNG](proof-loss-768.png) | [PNG](recovery-ready-768.png) |
| 390×844 | [PNG](proof-loss-390.png) | [PNG](recovery-ready-390.png) |
| 360×844 | [PNG](proof-loss-360.png) | [PNG](recovery-ready-360.png) |

[Dimensions and SHA-256 ledger](ledger.json). Final source `eaa3e51` reruns the foreground keyboard/corridor checks successfully at all five viewports. Nine final captures are byte-identical to the approved captures. The 1440px recovery-ready capture differs by 58 pixels only within the existing logout button (x1258–1327/y23–44); dimensions and visible layout/content agree, but the pixel variation's cause is unproven. The approved PNG remains unchanged; no tolerance, mask or crop is introduced. Exact results and comparison logs are in `/home/dominelinux/.cache/vibe_coding_archive/coord/b232/report-impl232.md`.
