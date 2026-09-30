# app-create·gallery-loading 로컬 반복 재현

2026-09-30, [[Task] app-create·gallery-loading 로컬 반복 재현 증거 수집](https://github.com/DomineYH/vibe_coding_archive/issues/103)의 결과. 소스 기준 `fd862a68e7c606d75fffb50408d1366dcb9fd28c`, 브랜치 `wayfinder/issue-91`.

## 판정과 승인

두 실패 서명 모두 **로컬 미재현**이다. app-create 1024×900 20/20, gallery-loading 1440×1000 20/20 통과했다. retries=0, worker=1이며 실패 후 성공으로 덮은 결과가 아니다. 각 서명 최대 20회 또는 30분 중 먼저 도달하는 조사 예산에서 횟수 한도에 도달했다. 강제 지연·추가 반복은 수행하지 않았다. 최초 실패는 없으므로 로컬 실패 trace/DOM 증거도 없다. 이 결과는 CI 실패 해소나 안정성 입증이 아니다.

**HITL 권장안 채택 — DomineYH 승인 2026-09-30, 권장안 일괄 승인:** 기존 테스트와 별도 reporter로 조사하고 미재현·환경 차이·증거 공백을 다음 결정에 인계한다. baseline 변경은 권장하지 않았고 승인 대상에 포함하지 않았다. 기준 이미지, 허용 오차, 제품·테스트·설정을 변경하지 않았다. 지도는 계획 범위이므로 수정 및 수정 후 검증은 수행하지 않았다.

## 환경과 절차

- 작업은 `/mnt/c/dev/vibe_coding_archive-wf91` 안에서만 수행했다. 다른 두 checkout은 수정하지 않았다.
- Ubuntu 24.04.3 / WSL2 커널 `6.6.87.2-microsoft-standard-WSL2`, `/mnt/c` 파일시스템. 과거 CI Ubuntu 24.04.5 runner와 다르다. CPU 부하를 고정하지 않았다.
- Node v22.23.2, npm 12.0.2, Playwright 1.63.0. 과거 실패 CI npm은 10.9.8. 현재 lockfile로 `npm ci --no-audit --no-fund` 실행(약 4분). npm이 esbuild postinstall을 차단했다고 경고했으나 Vite와 실제 테스트는 정상 실행됐다.
- 기존 실행 파일 `/tmp/issue85-run/chrome/chrome-headless-shell-linux64/chrome-headless-shell`을 읽기·실행만 했다. `--version`은 Google Chrome for Testing 151.0.7922.34. 각 spec의 beforeAll 버전 검증도 통과했다.
- `FONTCONFIG_FILE=$PWD/visual/fontconfig.conf`. Noto Sans CJK JP 파일은 `/home/dominelinux/.fonts/NotoSansCJK-Regular.ttc`, SHA-256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`. gallery beforeAll의 실제 폰트 family 검사도 통과했다.
- 기존 config의 locale ko-KR, Asia/Seoul, scale=1, reducedMotion=reduce, light, serviceWorkers=block, test timeout=60000, expect timeout=15000 유지.
- 최초 및 각 webServer 실행 전 `ss -H -ltn 'sport = :5173'`가 비어 있음을 확인했다. 종료 후에도 listener 없음. 기존 서버를 죽이지 않았고 Playwright가 자신이 시작한 Vite를 정리했다.
- 첫 필터 `--grep '^app registration form at 1024x900$'`는 Playwright의 전체 테스트 이름과 맞지 않아 `No tests found`(exit 1). 필터 앵커만 제거했으며 이 준비 실패는 20회에 포함하지 않는다.
- 별도 Node reporter의 `onStepEnd`로 기존 API/assertion 단계 시간만 수집했다. 테스트 흐름에 await·sleep·DOM probe를 추가하지 않았다. reporter 오버헤드는 존재하며 CI 무계측 실행과 동일하지 않다.

## 실제 실행 명령

cwd는 `frontend`. 각 명령 앞에 아래 포트 guard를 실행했고 baseline 캡처 환경 변수를 명시적으로 제거했다. 두 명령 모두 exit 0이었다. 로그 경로는 ignored 로컬 보조 증거이며 영구 수치는 아래 JSONL에 선별 보관했다.

```bash
set -o pipefail
if ss -H -ltn 'sport = :5173' | rg -q .; then echo 'PORT_OCCUPIED'; exit 2; fi
env -u VISUAL_BASELINE_CAPTURE \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/issue85-run/chrome/chrome-headless-shell-linux64/chrome-headless-shell \
  FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" EVIDENCE_RUN=app-original \
  npx playwright test --config=playwright.visual.config.js visual/app-create.spec.js \
  --grep 'app registration form at 1024x900' --repeat-each=20 --retries=0 \
  --workers=1 --max-failures=1 --global-timeout=1800000 \
  --reporter=list,./test-results/issue91/timing-reporter.cjs \
  2>&1 | tee test-results/issue91/app-original.log

if ss -H -ltn 'sport = :5173' | rg -q .; then echo 'PORT_OCCUPIED'; exit 2; fi
env -u VISUAL_BASELINE_CAPTURE \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/issue85-run/chrome/chrome-headless-shell-linux64/chrome-headless-shell \
  FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" EVIDENCE_RUN=gallery-original \
  npx playwright test --config=playwright.visual.config.js visual/gallery.spec.js \
  --grep 'gallery-loading matches its baseline at 1440x1000' --repeat-each=20 --retries=0 \
  --workers=1 --max-failures=1 --global-timeout=1800000 \
  --reporter=list,./test-results/issue91/timing-reporter.cjs \
  2>&1 | tee test-results/issue91/gallery-original.log
```

실행에 사용한 `frontend/test-results/issue91/timing-reporter.cjs`(ignored 임시 계측)는 다음과 같다. `mkdir -p test-results/issue91` 뒤 생성하며 동일 EVIDENCE_RUN으로 재실행하면 JSONL에 append하므로 새 이름을 사용한다. 아래 reporter는 로컬에서만 사용하며 입력값이 포함될 수 있는 API 제목은 외부로 게시하지 않는다.

```javascript
const fs = require('node:fs');
const path = require('node:path');
module.exports = class {
  onTestBegin(test) { this.started = performance.now(); this.emit({ event: 'begin', title: test.title, repeat: test.repeatEachIndex }); }
  onStepEnd(test, result, step) {
    this.emit({ event: 'step', repeat: test.repeatEachIndex, category: step.category, title: step.title, location: step.location, ms: step.duration, elapsedMs: performance.now() - this.started, error: step.error?.message });
  }
  onTestEnd(test, result) { this.emit({ event: 'end', title: test.title, repeat: test.repeatEachIndex, status: result.status, ms: result.duration, errors: result.errors.map(e => e.message) }); }
  emit(row) { fs.appendFileSync(path.join(__dirname, process.env.EVIDENCE_RUN + '.jsonl'), JSON.stringify(row) + '\n'); }
};
```

## app-create: 다섯 상태의 시간

Playwright 출력 `20 passed (3.2m)`. 테스트 duration은 최소 4,152ms / 중앙값 4,798.5ms / 최대 22,625ms. 첫 회 초기 `page.goto('/')`가 18,042ms였고 이후 19회 전체 duration 범위는 4,152–5,968ms였다. Vite cold start가 포함될 수 있으나 첫 이동의 지연 원인을 별도 profiler로 확정한 것은 아니다.

각 상태 20개 표본, 단위 ms. [소스 흐름](local-source-flow.md)과 [회차별 수치](local-observations.jsonl)를 함께 읽는다.

| 상태 | fonts.ready + 2 RAF 범위 | screenshot 최소 / 중앙 / 최대 | compare 범위 | screenshot 시작 추정 누적 범위 |
| --- | --- | --- | --- | --- |
| app-create | 12–32 | 239 / 300 / 388 | 58–104 | 2,306–20,781 |
| validation-error | 7–34 | 252 / 284 / 399 | 50–106 | 2,775–21,258 |
| rejected | 18–38 | 212 / 304 / 410 | 25–57 | 3,510–22,060 |
| unknown | 5–35 | 224 / 299 / 379 | 27–46 | 3,874–22,558 |
| expired | 9–31 | 203 / 284.5 / 372 | 26–55 | 4,276–22,958 |

`step.duration`은 Playwright 측정값이다. 누적 값은 Node 단조시계로 `onTestBegin`부터 `onStepEnd`를 받은 시간에서 duration을 뺀 **관찰 추정치**다. beforeAll·hook·reporter 전달 지연을 포함할 수 있어 테스트 timeout의 정확한 남은 예산이나 API 진입 시각이 아니다. fake-clock Date.now는 측정에 사용하지 않았다. fonts와 두 RAF는 원래 하나의 evaluate라 내부 세 구간까지 분리되지 않는다. 모든 캡처의 screenshot은 203–410ms, 마지막 캡처도 충분히 일찍 완료됐지만 CI에서 어떤 구간이 60초를 소진했는지는 여전히 모른다.

**픽셀 검증 한계:** 이 spec은 capture에서 너비만 assert한다. 마지막 회의 초기 화면은 실제 1024×1517 / 기대 1024×1528, validation은 실제 1024×1726 / 기대 1024×1594로 `dimensions_mismatch`가 기록됐다. 나머지 세 상태는 baseline 없는 product_only다. 이 비교 파일은 회차마다 덮어써지므로 마지막 회 결과만 보존했다. 타임아웃과 별개이며 원인을 조사하거나 baseline을 변경하지 않았다. 통과를 시각 일치로 표시하지 않는다.

## gallery-loading: status와 clock/RAF 분리

Playwright 출력 `20 passed (2.6m)`. 테스트 duration 최소 1,205ms / 중앙값 1,412ms / 최대 1,682ms. 각 회의 beforeAll은 별도 page로 폰트를 점검하며 이 준비는 테스트 duration과 다르다. 첫 beforeAll의 상세 페이지 이동은 10,547ms였다.

| 단계 / 원본 gallery.spec.js 행 | 최소 / 중앙 / 최대 ms |
| --- | --- |
| 최초 전역 status assertion / 424 | 246 / 330.5 / 409 |
| pause 전 두 RAF evaluate / 427 | 35 / 49 / 79 |
| clock.pauseAt / 432 | 5 / 6 / 18 |
| pause 직후 status assertion / 433 | 6 / 7 / 20 |
| fonts.ready / 486 | 3 / 4 / 6 |
| pause 이후 RAF polling 3회 / 490 | 40 / 57.5 / 93 |
| screenshot 직전 status assertion / 525 | 5 / 6 / 9 |
| screenshot / 533 | 104 / 126.5 / 168 |
| screenshot 직후 status assertion / 539 | 5 / 6 / 8 |
| PNG 비교 / 144 | 156 / 181.5 / 257 |

전역 status assertion 총 80개가 통과했다. CI에서 관찰한 `로그인 상태 확인 중` + 목록 loading의 strict mode violation은 발생하지 않았다. 최초 assertion의 대기 시간을 인증 복원 시간으로 동일시하지 않는다. 연속 DOM 관찰/인증 서비스 시작·종료 probe를 넣지 않았으므로 assertion 사이의 잠깐 중복 존재나 정확한 복원 완료 시각은 미확인이다. 소스상 두 status가 동시에 존재할 수 있는 경로와 CI 최초 실패 로그는 [소스 노트](local-source-flow.md), [CI 증거](ci-evidence.md)에 따로 있다.

clock pause 이후 RAF polling은 모든 회차에서 완료했다. 따라서 이번 실행에서 해당 대기가 멎었다는 증거는 없고, 이를 app-create 타임아웃과 연결하지 않는다. gallery의 실제 `differentPixels === 0` assertion도 20회 통과했으며 마지막 비교 결과는 1440×1000, differentPixels=0, maxChannelDelta=0이다.

## 보존·검증·다음 입력

- [local-observations.jsonl](local-observations.jsonl): 회차 40개, app 캡처 단계 100개, gallery 단계 묶음 20개, 마지막 비교 2개. Python assert로 각 spec 20개 passed, 회차 순서, 캡처 5개/회, status·screenshot·픽셀 assertion 횟수를 검사했다. API 입력 제목·세션·localStorage 원문은 포함하지 않는다.
- ignored 로컬 보조 자료: `frontend/test-results/issue91/{app-original,gallery-original}.{log,jsonl}`, `app-last-comparison.json`, `timing-reporter.cjs`. gallery 마지막 화면은 `frontend/test-results/visual/captures/gallery-loading-1440x1000.png`. app 화면들은 후속 Playwright outputDir 정리로 남지 않았으며 수치만 별도 보관했다.
- `git diff --exit-code -- frontend docs/evidence` 통과. 기존 테스트·설정·baseline/허용 오차 수정 없음. 범위가 두 서명의 조사이므로 전체 테스트 suite나 수정 후 검증은 실행하지 않았다.
- diagnosing-bugs의 재현 명령은 실제 경로를 구동하지만 이번 예산 안에서는 red를 얻지 못했다. 이에 따라 원인 확정·최소화·수정/회귀 테스트 단계는 수행하지 않았다. 원인 가설과 수정 결정은 다음 티켓의 일이다.
- [[Decision] 두 visual 실패의 최소 수정 방향과 안정성 수락 기준](https://github.com/DomineYH/vibe_coding_archive/issues/104)에 CI와 이번 미재현 결과를 인계한다. CI 같은 순간 부하, 다섯 상태의 실패 당시 누적 예산, 인증 복원의 실제 중첩 스케줄은 미해결이다. 수정 티켓을 이번 세션에서 해결하지 않는다.
- app-create 높이 차이는 관찰 한계로 기록했으며 두 실패 서명 밖의 시각 재설계/기준 변경으로 확장하지 않는다. 현재 결정 질문이 필요한 후속 범위를 이미 다루므로 새 티켓을 만들지 않는다.
