# #91 진단: gallery status 충돌과 app-create screenshot 예산

2026-09-30. checkout `/mnt/c/dev/vibe_coding_archive-wf91`, 브랜치 `wayfinder/issue-91`. 선행 증거: [CI](ci-evidence.md), [로컬 20회×2](local-reproduction.md), [소스 흐름](local-source-flow.md). 후속 결정 #104를 diagnosing-bugs로 이관한 결과다.

**HITL 권장안 채택 — DomineYH 승인(2026-09-30, 권장안 일괄 승인).** 실제 중첩을 고정해 재현한 gallery locator만 수정하고, CI의 app-create expired timeout과 다른 실패는 구분해 보고한다. 기준 이미지·허용 오차 변경은 권장안에 포함하지 않았고 수행하지 않았다. #91은 PR 머지 때까지 열어 둔다. 높이·픽셀 검증 문제는 [#105](https://github.com/DomineYH/vibe_coding_archive/issues/105)로 분리했다.

## gallery: 재현·최소화·원인

- 초기 강제 루프: `frontend/scripts/debug/issue91/run.sh auth-gate 3` (최초 실행은 같은 내용의 ignored `frontend/test-results/issue91-diagnosis/run-loop.sh` 사용).
- Vite가 제공하는 실제 mock auth 모듈의 `getCurrentAuthState` 진입에 Node Promise 게이트만 삽입한다. auth 결과·목록 fixture·UI DOM은 대체하지 않는다. 기존 `list_delayed`는 그대로 유지한다. DOM 위조나 제품 auth 흐름 변경이 아니다.
- 강제 원본 루프는 기존 `clock.pauseAt`에 도달한 뒤 auth 게이트를 해제하고 헤더의 checking status가 사라지는 것을 기다려 baseline 헤더 상태를 맞춘다. 이 대기는 진단 fixture에만 있으며 수정한 제품/visual helper에는 없다. 수정 전에는 첫 assertion에서 실패하므로 해제 시점에 도달하지 않는다. 최소 회귀 테스트는 검사 도중 게이트를 계속 유지해 selector의 올바른 범위를 별도로 검증한다.
- 기존 loading 1440×1000 캡처의 첫 전역 status assertion이 2.2초에 실패했다. CI와 같은 두 요소, 같은 loading 텍스트, 같은 strict mode 오류다. 나머지 2회는 max-failures=1로 실행하지 않았다.

```text
strict mode violation: getByRole('status') resolved to 2 elements:
1) <span role="status">로그인 상태 확인 중</span>
2) <div role="status" aria-live="polite">공개 아카이브를 불러오는 중이에요…</div>
```

최소화는 PNG 캡처·폰트 대기·baseline 비교·viewport 변경을 제거하고 실제 앱에서 두 status와 같은 selector assertion만 남겼다. 목록의 300ms 종료가 관찰 속도에 영향을 주지 않도록 가상 clock을 navigation 전에 멈췄다. 인증은 Node Promise로 독립 보류한다. 회귀 테스트는 글로벌 status 개수 2, 헤더의 실제 인증 확인 텍스트, 공유 gallery locator의 loading 문구를 검사한다. 게이트는 finally에서 해제한다.

수정 전 최소 회귀 루프는 3/3에서 같은 strict mode 오류(2.4s / 1.8s / 1.7s)를 냈다. `galleryLoadingStatus`가 원래 전역 selector를 반환하는 상태에서 확인한 red다. 전역 개수 2 검사를 제거하면 실수로 auth 지연 주입이 적용되지 않은 실행을 통과시킬 수 있으므로 이 검사는 load-bearing이다. 인증 보류를 없앤 기존 실행은 선행 20/20 통과했다.

### 수정 전 공개한 판별 가설

1. 전역 locator가 원인이면 같은 중첩 DOM을 유지한 채 갤러리 main으로 범위를 좁히면 통과한다.
2. 목록의 300ms 지연 자체가 원인이면 auth 보류를 제거해도 같은 strict 충돌이 남는다.
3. clock pause가 원인이면 pause 전에 충돌하지 않아야 한다.

첫 원본 강제 실패는 pause 이전 assertion에서 발생해 3과 맞지 않는다. 2는 auth 보류 없는 선행 실행과 맞지 않는다. 동일한 두 status를 검증하는 red/green 회귀는 1을 직접 판별한다. 자연 발생 CI 인증 스케줄을 복원했다는 주장과는 구분한다.

### 최소 수정과 영향

`frontend/visual/gallery.spec.js`의 loading assertion 네 곳이 공통 `galleryLoadingStatus(page)`를 쓰고, 이 selector는 `page.getByRole("main").getByRole("status")`다. heading/header/auth 상태와 혼동하지 않는다. `.first()`로 임의 선택하지 않는다. 제품 코드·인증 완료 대기·sleep·timeout·자동 retry 변경이 없다.

helper의 모든 호출자를 확인했다. 수정 영향은 `gallery-loading`의 viewport 5개이며 gallery/detail/다른 추가 상태/component 분기는 그대로다. 제품 API·schema·DB·공유 컴포넌트 변경이 없어 전체 suite/API e2e를 확대 실행하지 않는다. 기존 visual 테스트가 실제 앱·mock auth·갤러리 로딩·PNG 비교를 함께 실행하는 관련 통합 회귀다.

## 재현 명령과 잠금

영구 진단 도구는 `frontend/scripts/debug/issue91/`에 명시적으로 보관했다. 임시 spec을 현재 worktree에서 생성하고 EXIT에서 제거한다. 모든 browser 실행은 요청한 고정 lock을 사용하고, lock 획득 뒤 5173/5174/8000 listener가 하나라도 있으면 종료한다. 다른 프로세스는 종료하지 않는다. Playwright webServer가 자신이 시작한 Vite를 정리하고, 실행 종료 시 포트를 다시 관찰한다.

```bash
# repository root; 브라우저 경로는 필요하면 환경 변수로 덮어쓴다.
frontend/scripts/debug/issue91/run.sh auth-gate 3
ISSUE91_CPU=6 ISSUE91_LATENCY=150 frontend/scripts/debug/issue91/run.sh stress 3
ISSUE91_CPU=6 ISSUE91_LATENCY=150 frontend/scripts/debug/issue91/run.sh stress-warm 3
ISSUE91_NAV_DELAY=2000 frontend/scripts/debug/issue91/run.sh network-delay 3
```

기본 Chromium은 기존 `/tmp/issue85-run/chrome/chrome-headless-shell-linux64/chrome-headless-shell`(151.0.7922.34)을 읽기·실행한다. fontconfig는 `frontend/visual/fontconfig.conf`; 기존 browser/font assertion을 유지했다. 환경의 CI 차이는 선행 로컬 문서와 동일하다. npm/worker/Vite의 cold 준비 및 lock 대기는 테스트 본체 시간과 다르며, 이 환경에서 전체 명령이 수분 걸리는 한계가 있다. 수 초의 gallery 신호와 전체 명령의 소요시간을 혼동하지 않는다.

일반 회귀 실행 명령(cwd `frontend`, lock 안에서 포트 guard를 거친다):

```bash
flock /tmp/claude-1000/-mnt-c-dev-vibe-coding-archive/f8bf8397-dea2-4b0b-ac26-c2b6e5aea7f6/scratchpad/playwright.lock \
  bash -c 'set -euo pipefail
    if ss -H -ltn "( sport = :5173 or sport = :5174 or sport = :8000 )" | rg -q .; then echo PORT_OCCUPIED; exit 2; fi
    env -u VISUAL_BASELINE_CAPTURE \
      PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/issue85-run/chrome/chrome-headless-shell-linux64/chrome-headless-shell \
      FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" \
      npx playwright test --config=playwright.visual.config.js visual/gallery.spec.js \
      --grep "gallery-loading" --repeat-each=5 --retries=0 --workers=1'
```

수정 전 regression red 명령은 위 명령에서 grep을 `gallery-loading status is unique`, repeat-each를 3으로 한 것이다.

## gallery 검증 결과와 수락 기준

- 수정 전 최소 회귀: retries=0, 3/3 동일 strict 실패.
- 수정 후 최소 회귀 + 기존 loading baseline: retries=0, worker=1, 5회 반복, **30/30 통과 (Playwright 요약 2.6분)**. 최소 회귀 5회와 5 viewport×5회 25개의 실제 baseline 비교다.
- baseline capture 환경 변수는 제거했다. 너비·높이와 `differentPixels === 0` 검사는 그대로 실행했다. 허용 오차는 0이며 변경하지 않았다.
- 고정 중첩에서도 selector가 단일 loading 상태를 찾고, 기존 5 viewport의 픽셀 결과가 유지되는 것이 로컬 수락 기준이다. 재실행 성공이나 자동 retry로 합격 처리하지 않았다. CI 검증은 아직 수행하지 않았고 자연 발생 flake 확률 0을 주장하지 않는다.

## 준비 오류와 보존 정책

진단 준비 중 cwd에 `frontend/`를 중복한 Python 경로 오류가 있었다. 원본 파일은 해당 실패 명령에서 변경되지 않았고 의도한 수정은 올바른 절대 경로에서 다시 적용했다. 첫 warm fixture는 로그인 버튼을 link로 찾는 준비 오류로 30초 locator timeout이 났다(테스트 본체 1ms). 이를 앱의 실패 서명으로 집계하지 않고 실제 button selector로 수정해 다시 실행했다. 첫 lint의 fixture callback 이름 `use`가 React hook rule에 걸리고 CommonJS reporter가 ESM/Node lint 규칙에 걸린 문제도 callback 이름과 ESM import로 수정했다. 준비 오류는 버그 재현률/통과 횟수에서 제외한다.

원본 실패로그와 API 제목을 포함한 reporter 출력은 ignored `frontend/test-results/issue91{,-diagnosis}/`에만 남겼다. 영구 관찰 파일에는 테스트 이름·상태·duration·필요한 단계 시간·공개 DOM 오류 서명만 보관하며, auth payload/localStorage 원문/헤더/입력값은 보관하지 않는다. reporter는 API 이름의 첫 단어와 행 번호만 기록한다.

## app-create: 실제로 얻은 신호와 해석 한계

테스트 timeout=60000, screenshot 옵션 및 다섯 상태/기준 이미지/허용 오차는 모두 유지했다. stress는 Chromium CDP CPU 배율과 네트워크 지연(1MiB/s throughput)만 적용한다. warm은 별도 worker fixture의 무부하 page로 Vite graph를 준비하고 닫은 뒤 동일한 본체를 실행한다. network-delay는 navigation request만 Node의 real-time 2초 timer로 지연한다. 가상 Date.now를 성능 측정에 사용하지 않았다.

| 루프                                                 | 실행 결과                                         | 테스트 본체/캡처                                         | CI expired 서명과의 관계                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CPU 6배 + latency 150ms, cold, 최대 3회              | 첫 회 timeout, 나머지 2회 max-failures=1로 미실행 | 61,417ms; screenshot #2(validation) 실패                 | `page.screenshot: Test timeout of 60000ms exceeded`와 `fonts loaded`는 같지만 마지막 expired 캡처가 아니다 |
| 같은 CPU/네트워크, Vite 준비만 본체 밖에서 수행, 3회 | 3/3 통과                                          | 37,254 / 46,539 / 43,150ms; 15 screenshots 1,209–2,526ms | expired timeout 미재현                                                                                     |
| navigation마다 2,000ms 지연, 3회                     | 3/3 통과                                          | 34,122 / 15,285 / 13,811ms; 15 screenshots 313–397ms     | expired timeout 미재현                                                                                     |

cold 실패에서 초기 이동 36,766ms, reload 3,078ms, login 이동 3,051ms, 새 앱 이동 2,180ms였다. 첫 screenshot은 2,048ms에 완료했고 두 번째는 1,928ms 뒤 전체 예산에 의해 중단됐다. 이는 **로컬 실험에서 screenshot만 60초 멎지 않아도 같은 error 문자열이 나타나는 것**을 보여준다. screenshot 시작 추정 누적 시간은 60,829ms였으나 reporter의 onTestBegin에는 fixture/hook 시간이 포함되므로 정확한 테스트 예산 잔여시간으로 해석하지 않는다.

CI는 두 번째 viewport의 마지막(다섯 번째) expired 캡처에서 실패했다. 로컬 단독 실행의 cold 초기 이동·validation 실패를 그 원인으로 승격시키지 않는다. 기존 20회에서도 cold 최초 이동은 관찰됐지만 CI 단계별 시간/trace가 없고, Vite 준비가 진행된 전체 CI 순서와 이번 단독 cold 실행은 다르다. 위 대조는 추가 진단 입력이며 CI 원인 확정/안정성 수락/timeout 증대의 근거가 아니다.

최종 추가 스트레스 결과는 아래에 기록한다. CI expired 서명의 pinned 재현을 얻지 못하면 Phase 2의 원인 최소화부터 Phase 5의 수정/회귀를 진행하지 않는 것이 권장안이다. 기존 실제 앱 capture seam은 존재하지만 현재 CI trigger가 고정되지 않았으므로 얕은 screenshot stub 테스트로 회귀를 꾸미지 않는다.

### 최종 추가 스트레스와 미해결 판정

CPU 8배 + latency 150ms + Vite warm 조건에서도 retries=0 **3/3 통과 (3.0분)**했다. 본체 41472 / 45461 / 40115ms, 15 screenshots 1585–2507ms였다. CPU 6배 warm 조건과 비교해 CPU 배율 하나만 바꿨다. max-failures=0으로 실패 여부와 무관하게 3회 관찰하도록 설정했으며 자동 retry는 아니다.

새 app-create 실험은 본체 실행 10회(다른 캡처의 timeout 1회 + warm6/warm8/network 지연 각각 3회 통과)다. CI의 expired 캡처 실패는 이번에도 미재현이다. 원인 최소화·CI 원인 확정·제품 또는 app-create 테스트 수정·새 app-create 회귀 검사는 진행하지 않았다. timeout 증대, 캡처 상태 삭제, warm fixture를 원본 spec에 넣기, screenshot stub으로 형식상 red 만들기는 권장하지 않았다.

미해결 입력은 실패 당시 각 상태의 실시간 누적 예산과 screenshot 자체 duration, runner 부하, trace/DOM이다. 다음 판별은 CI에서 단계별 단조시계와 실패 artifact 보존을 확보한 뒤 expired를 실제로 red로 만드는 것이다. CI artifact 부재는 [선행 증거](ci-evidence.md)에 기록돼 있다. 접근·계측을 사용자에게 다시 요청하지 않고 이 필요한 입력을 #91에 기록한다. 이번 로컬 미재현은 CI 안정성 입증이 아니다.

### 최종 보존·검증

- 원래 강제 gallery 캡처 루프 재실행: **3/3 통과 (1.1분)**, 본체 1,970–2,082ms, screenshots 160–190ms; 기존 1440×1000 baseline의 differentPixels=0 assertion 유지.
- [diagnostic-observations.jsonl](diagnostic-observations.jsonl): 정제한 47개 verdict와 구간 관찰. 입력값·auth 원문·헤더·API 인자 없음. 로그에서 옮긴 최소 회귀/30개 gallery 시간은 반올림된 approxMs로 표시하며 API reporter의 ms와 구분한다.
- targeted Prettier/ESLint, `bash -n frontend/scripts/debug/issue91/run.sh`, diff check 통과. 기존 `frontend/src`, app-create spec, visual config, `docs/evidence`에 diff 없음.
- 임시 spec은 trap으로 제거했다. 초기 ignored 중복 harness 두 파일은 삭제하고 재사용 도구를 명시적인 `frontend/scripts/debug/issue91/`에만 남겼다. debug 로그를 제품 코드에 추가하지 않았다. 자신의 Playwright/Vite 서버는 종료됐다. 다른 pane이 lock을 사용하는 동안 대기했고 다른 프로세스는 종료하지 않았다.
- 로컬 gallery 수정 커밋: `566c71e899c3307a8e0b955681d767c11784bc42`. 진단 도구/관찰/이 문서는 별도 로컬 커밋으로 보존한다. push·PR 생성·배포 없음.
