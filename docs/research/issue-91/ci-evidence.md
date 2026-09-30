# 두 visual 실패 서명의 CI 원본 증거

조사일: 2026-09-30. 질문: [두 visual 실패 서명의 CI 원본 증거와 공백 확인](https://github.com/DomineYH/vibe_coding_archive/issues/102).
`gh api`로 GitHub의 run, attempt별 jobs, job logs, artifacts와 실패 head의 소스를 읽었다. 전체 로그는 파일로 저장하지 않았다. 코드 수정·테스트 실행·재실행 요청은 하지 않았다.

## 관찰: 최초 실패와 성공을 분리

모든 시각은 UTC, 시간은 jobs API의 Visual comparisons 단계 시작/종료 차이다. 링크는 해당 frontend job의 원본 로그다. 네 run은 `.github/workflows/frontend-ci.yml` 실행이다.

| run / event / head | 시도 | Visual comparisons 시각 | 단계 시간 | 결과 / 해당 테스트 시간 |
| --- | --- | --- | --- | --- |
| 36488640436 / pull_request / 9337d40 | [1](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36488640436/job/109151602196) | 09-28 21:54:59–22:01:04 | 365초 | app-create 실패 1.0분, 121 passed / 1 failed |
| 36488640436 / pull_request / 9337d40 | [2](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36488640436/job/109155720250) | 09-28 22:07:59–22:13:30 | 331초 | 122 passed, app-create 3.0초 |
| 36488635477 / push / 9337d40 | [1](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36488635477/job/109151605021) | 09-28 21:54:49–21:59:38 | 289초 | 122 passed, app-create 2.5초 |
| 36504423166 / push / ced136f | [1](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36504423166/job/109202504195) | 09-29 00:48:16–00:53:37 | 321초 | gallery-loading 실패 568ms, 121 passed / 1 failed |
| 36504423166 / push / ced136f | [2](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36504423166/job/109205386314) | 09-29 01:00:02–01:05:27 | 325초 | 122 passed, gallery-loading 774ms |
| 36504426878 / pull_request / ced136f | [1](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36504426878/job/109202515642) | 09-29 00:48:15–00:53:28 | 313초 | 122 passed, gallery-loading 725ms |

run API의 전체 head SHA는 각각 `9337d40184bc7de27865f07c503ea7a85bbfe4eb`, `ced136ffc8f4d6f8bbb940f47fb41235487f26f2`다. 최초 실패 run들의 현재 최종 conclusion은 모두 success지만 run_attempt=2이므로 최초 실패가 없었다는 뜻이 아니다. 각 동시 성공 run은 run_attempt=1이다.

**보고 정정:** gallery 관련 [추가 관찰 댓글](https://github.com/DomineYH/vibe_coding_archive/issues/91#issuecomment-5881551316)은 event를 반대로 기록했다. [실패 run API](https://api.github.com/repos/DomineYH/vibe_coding_archive/actions/runs/36504423166)는 `push`, [동일 head 성공 run API](https://api.github.com/repos/DomineYH/vibe_coding_archive/actions/runs/36504426878)는 `pull_request`다. 따라서 PR 이벤트만의 실패라고 판단할 근거가 없다.

## 관찰: 실패 지점

### app-create 1024×900

[최초 실패 로그](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36488640436/job/109151602196)의 `visual/app-create.spec.js:184:3` 테스트가 `page.screenshot: Test timeout of 60000ms exceeded`로 종료됐다. call log는 `taking page screenshot` → CSS animations disabled → `waiting for fonts to load...` → `fonts loaded`까지 기록한다. 따라서 폰트 로딩 완료 자체가 관찰됐으며, 60초를 폰트만 기다렸다고 단정할 수 없다.

stack은 `capture`의 139행에서 실패했고 호출자는 268행이다. [실패 head의 실제 소스](https://github.com/DomineYH/vibe_coding_archive/blob/9337d40184bc7de27865f07c503ea7a85bbfe4eb/frontend/visual/app-create.spec.js#L268)에서 이는 `app-create-expired` 캡처다. 등록 화면의 초기 캡처라고 해석하면 안 된다. `fullPage: true`, `animations: "disabled"`, `caret: "hide"`의 screenshot 호출에서 **테스트 전체** 제한을 소진했다. 로그에 단계별 소요시간은 없어 screenshot 자체가 60초 걸렸다는 결론은 불가능하다.

### gallery-loading 1440×1000

[최초 실패 로그](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36504423166/job/109202504195)의 `visual/gallery.spec.js:721:5` 테스트는 568ms 만에 실패했다. `captureAndCompare` 424행의 `expect(page.getByRole("status")).toContainText(...)`가 두 요소를 찾아 strict mode violation이 발생했다.

- 헤더: `span role="status"`, 텍스트 `로그인 상태 확인 중`.
- 로딩 영역: `div role="status" aria-live="polite"`, 공개 아카이브 로딩 문구.

expect 로그의 timeout 설정은 15000ms지만 실제 실패는 시간 소진이 아니라 locator 다중 일치다. 이것은 시각 픽셀 불일치가 아니다. 같은 실패 run에서 나머지 gallery-loading viewport 4개는 통과했다.

## 관찰: 환경과 artifact

위 여섯 job 로그 모두 Ubuntu 24.04.5, runner image `ubuntu-24.04` / `20260920.314.1`, Node `v22.23.2`, npm `10.9.8`, visual 122 tests / 1 worker를 기록했다. visual 단계의 환경 변수는 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`을 `chrome-151/chrome-headless-shell-linux64/chrome-headless-shell`로 지정한다. [최초 app-create 실패 job](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36488640436/job/109151602196)의 pinned 설치 URL 버전은 `151.0.7922.34`다. 앞서 설치된 Playwright 기본 Chromium 153의 다운로드 로그를 visual 실행 브라우저로 혼동하면 안 된다. 실제 브라우저 프로세스의 버전 출력이나 성능 계측은 확보하지 않았다.

네 run의 artifacts API는 조사 시점에 모두 `total_count: 0`, `artifacts: []`를 반환했다:
[app-create 실패/재실행](https://api.github.com/repos/DomineYH/vibe_coding_archive/actions/runs/36488640436/artifacts),
[app-create 동시 성공](https://api.github.com/repos/DomineYH/vibe_coding_archive/actions/runs/36488635477/artifacts),
[gallery 실패/재실행](https://api.github.com/repos/DomineYH/vibe_coding_archive/actions/runs/36504423166/artifacts),
[gallery 동시 성공](https://api.github.com/repos/DomineYH/vibe_coding_archive/actions/runs/36504426878/artifacts).

실패 로그에는 각각 `test-results/visual/.../error-context.md` 경로가 있지만 이를 다운로드할 artifact가 조회되지 않는다. 경로 출력은 보관·접근 가능성의 증거가 아니다. 삭제·미업로드 등 부재 원인은 이 조회만으로 확정하지 않는다. 실패 당시 DOM snapshot, trace, screenshot은 확보하지 못했다.

## 가설 및 미확인

- gallery는 인증 확인 상태와 gallery 로딩 상태가 함께 존재하는 순간의 전역 locator 모호성이 직접 실패 조건이다. mock 인증 복원과 검증의 타이밍 경합은 설명 가능한 가설이나 정확한 스케줄·선후관계는 trace 없이 미확인이다.
- app-create는 마지막 expired 캡처에 도달하기 전 누적 지연, screenshot 내부 지연, runner/browser 부하 중 무엇이 제한 소진을 만들었는지 미확인이다. `fonts loaded` 이후 로그만으로 특정 Chromium 결함을 주장하지 않는다.
- 같은 head와 명목 환경에서 성공도 있다는 관찰은 결정적 소스 오류와 간헐 경합을 구분하는 입력이다. 성공 재실행 1회는 안정성 검증이 아니며 모집단 실패율 추정에도 부족하다. 동일 runner image가 동일 순간 부하를 뜻하지 않는다.
- 필요한 다음 증거: app-create의 각 동작·캡처 전후 경과시간 및 남은 테스트 예산, gallery의 두 status 동시 존재를 통제한 재현, 같은 환경·브라우저에서 재시도 없는 반복 결과. 원인별 수정 결정은 후속 조사에서 다룬다.

## 재조회 방법과 연구 결론

`gh api repos/DomineYH/vibe_coding_archive/actions/runs/<run>`로 event/head/최신 attempt를 확인하고, `.../runs/<run>/attempts/<n>/jobs`로 최초 시도와 재실행을 나눈다. `.../actions/jobs/<job>/logs` 응답은 파이프로 필요한 실패·환경 행만 추출하고 파일에 전체 저장하지 않는다. artifact는 `.../runs/<run>/artifacts`로 별도 조회한다.

4개 run / 6개 frontend job의 메타·선별 로그와 실패 head 소스를 대조해 연구 질문은 해결했다. CI 실패 사실, 성공 대조군, event 정정, 증거 공백을 구분할 수 있다. 원인 확정·실제 수정·안정성 검증 완료를 뜻하지 않는다.
