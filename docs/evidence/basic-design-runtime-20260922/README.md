# 변경 없는 basic_design 실행·캡처 증거

[원본 UI 판정에 필요한 실행·캡처 증거 확보](https://github.com/DomineYH/vibe_coding_archive/issues/2)의 AFK 증거다. 원본 실행은 성공했으며 26개 상태 × 5개 뷰포트를 확보했다. **원본과 이식본의 동등성 또는 시각 차이를 승인하는 자료는 아니다.** 답의 원본은 해당 티켓의 resolution comment이며, 이 문서는 그 재현 절차와 아티팩트 인덱스다.

## 입력 보존과 실행 환경

- 입력 커밋: `d030edd` (전체 SHA는 [reference/run.json](reference/run.json)). 기존 로컬 문서 커밋 5개 위에서 작업했다. `basic_design` 11개 파일은 `19c38fa`의 원본과도 동일하다.
- HTML·9 JSX·숨김 WebP의 경로, SHA-256, 크기, 역할: [sources.json](reference/sources.json). 실행 전후 모두 일치한다. 애플리케이션·의존성 파일·기존 연구 보고서 4개는 수정하지 않았다.
- 먼저 저장소 소유자이자 인증 사용자 `DomineYH`에게 티켓을 할당했다. 세션의 실제 model/effort 기록과 요청 route: [route.json](route.json). Wayfinder `architect → codex / gpt-6-astra / xhigh`; 재라우팅·하위 agent 없음.
- 기존 설치 도구만 사용: Python **3.12.3**, Python Playwright **1.62.0**, 기존 캐시의 Chromium/Chrome for Testing **151.0.7922.34**, Pillow **12.2.0**(무결성·픽셀 비교). 시스템 Chrome 144도 발견했지만 캡처에는 사용하지 않았다. 설치·패키지 변경 없음.
- Ubuntu **24.04.3 LTS**, WSL2 Linux **6.6.87.2**, x86_64, glibc 2.39, headless Chromium. `ko-KR`, `Asia/Seoul`, DPR **1**, 데스크톱 브라우저의 CSS viewport 크기만 변경했다. 실제 모바일 기기/터치 에뮬레이션 결과가 아니다.
- Python 표준 `ThreadingHTTPServer`를 **127.0.0.1의 임시 포트**에 바인딩하고 **basic_design만** 정적 루트로 제공했다. 격리된 비영속 browser context, 최상위 창에서 원본 HTML을 열었다. 외부 편집 호스트 없음; Tweaks는 기본 숨김 상태다. 실행 종료 시 서버·브라우저를 닫았다.

## 라이브 원본과 재현용 실행의 구분

| 구분 | 원본 실행 조건 | 증거 |
|---|---|---|
| 라이브 baseline | 새 context, 실제 CDN, 빈 localStorage, 실제 시각/난수/타이머. 앱 소스·CSS·전역을 교체하지 않음 | [화면](baseline/1440x1000/01-gallery.png), [환경·console·network](baseline/run.json), [CDN 원문 HAR](baseline/cdn.har.zip) |
| reference | 같은 원본 + 실제 CDN. 아래 시험 환경 고정 적용; 26개 상태 × 5개 viewport | [실행 로그](reference/run.json), [CDN 원문 HAR](reference/cdn.har.zip), 아래 캡처 표 |
| replay | 같은 원본 + reference HAR의 CDN 응답을 그대로 재생. HAR miss는 abort, 외부 CDN으로 fallback하지 않음 | [실행 로그](checks/replay-run.json), [비교 결과](checks/replay-comparison.json) |

reference/replay의 고정 방법은 [capture.py](capture.py)에 들어 있다.

1. 문서 로드 전 해당 origin의 `eduvibe-archive-coty2026` 키만 지워 원본 `INITIAL_USERS/INITIAL_APPS`를 사용한다. 배열 정렬·fixture 내용은 변경하지 않는다. 새 viewport마다 새 page/초기 상태에서 같은 순서를 실행한다.
2. Playwright clock을 설치·정지하고 `Date`를 **2026-09-22T00:12:00Z = KST 09:12**로 고정한다. `run_for()`로 타이머를 명시적으로 진행한다. 원본 fixture의 날짜·`09:12` 값은 그대로다.
3. 시험 init script에서 `Math.random = () => 0.5`로 고정한다. 원본 `simulatePing()`을 실행하면 **200, 280ms, 09:12**가 된다. 실제 HTTP 검사가 아니다. 초기 404/500 fixture는 그대로 유지하며, 신규 앱 생성/난수 ID 충돌을 시험하지 않았다.
4. `document.fonts.ready` 후 커서를 (0,0)으로 이동하고 페이지 상단에서 캡처한다. 일반 상태는 blur, 검색 focus 상태는 focus 유지. `animations='disabled'`, `caret='hide'`, DPR 1, full-page PNG를 사용한다. 영속 CSS를 주입하거나 원본을 고치지 않는다. JSON은 캡처의 CSS viewport와 전체 문서 너비를 별도로 기록한다.
5. 공개 카드 16개 → 데모 작성자 로그인 시 17개를 확인한다. 가입 오류/중복/승인 대기, 편집·등록 취소, 삭제 확인/취소, 관리자 비밀번호 입력, 모의 재검사, 데모 앱 삭제 완료를 실제 UI로 조작한다. 계정은 원본 `admin`, `교사김코딩`, `비기너개발자`만 사용한다. 계정 생성·운영 계정·실제 외부 앱 열기/검사는 하지 않는다.
6. 390/360px에서는 원본 관리자 메뉴가 숨겨진다. **768px에서 관리자 메뉴로 진입한 뒤 해당 폭으로 resize**했다. `/admin`을 만들거나 React 내부 state를 직접 바꾸지 않았다. 모바일 직접 진입을 구현/검증했다는 뜻이 아니다.

## CDN·글꼴·console 관찰

[cdn-assets.json](cdn-assets.json)은 실제 응답 URL·상태·MIME·바이트·SHA-256·HAR member와 SRI 검사 결과를 담는다. HAR에는 외부 CDN 응답만 있고, 원본 HTML/JSX는 재현 시 저장소에서 읽는다. reference에는 CDN 요청 110건, 고유 URL 22개가 기록되어 있다.

| 자원 | 실제 응답 |
|---|---|
| Tailwind 무버전 주소 | 302 → `/3.4.17`, 200; 정확한 응답을 HAR에 보관 |
| React / ReactDOM | 각각 18.3.1, 200; HTML의 SHA-384 SRI와 응답 바이트 일치 |
| Babel standalone | 7.29.0, 200; SHA-384 SRI 일치 |
| Lucide React | 0.453.0 UMD, 200; `window.LucideReact.Copy` 존재, `LR === window.LucideReact` |
| Pretendard | v1.3.9 dynamic subset CSS와 사용한 WOFF2 15개, 모두 200 |

모든 reference 캡처에서 `document.fonts.status='loaded'`였고, Chrome DevTools Protocol `CSS.getPlatformFontsForNode`로 **h1에 실제 사용된 Pretendard Variable/custom font**를 확인했다. 각 화면 JSON에는 loaded font face의 unicode range도 남겼다. 이는 모든 텍스트가 같은 글꼴이라는 선언은 아니다(프롬프트 등은 원본 `font-mono` 사용).

라이브 baseline/reference/replay에서 JavaScript page error, console error, 실패 요청은 **0건**이다. 페이지 로드마다 Tailwind Play CDN 운영 사용 경고와 Babel 브라우저 변환 경고, React DevTools 안내가 있었다. 숨기지 않고 `run.json`에 기록했다. `color-mix()`는 이 Chromium에서 지원된다. 다른 브라우저의 최소 지원 버전을 확정한 것은 아니다.

네트워크 guard는 현재 로컬 origin과 원본 CDN 3개 호스트만 허용한다. 차단 요청도 **0건**으로, 샘플 앱 URL에 요청하지 않았다. metadata의 비밀번호/사용자는 공개 원본의 데모 fixture이며 운영 데이터가 아니다.

## 캡처 인덱스

각 PNG 옆 같은 이름의 JSON에 화면 텍스트·입력값·localStorage 상태·폰트·색·SVG·너비·넘침 측정값이 있다. full-page PNG의 높이는 CSS viewport 높이보다 길 수 있다. 1440px의 `*-component.png` 5개는 갤러리 카드, 공개 상세 aside, 편집 aside, 관리자 Health 행, 관리자 404 상세 aside의 원본 요소 캡처다.

| 상태 | 1440×1000 | 1024×900 | 768×1024 | 390×844 | 360×844 |
|---|---|---|---|---|---|
| 01 갤러리 | [PNG](reference/1440x1000/01-gallery.png) | [PNG](reference/1024x900/01-gallery.png) | [PNG](reference/768x1024/01-gallery.png) | [PNG](reference/390x844/01-gallery.png) | [PNG](reference/360x844/01-gallery.png) |
| 02 갤러리 검색 focus | [PNG](reference/1440x1000/02-gallery-search-focus.png) | [PNG](reference/1024x900/02-gallery-search-focus.png) | [PNG](reference/768x1024/02-gallery-search-focus.png) | [PNG](reference/390x844/02-gallery-search-focus.png) | [PNG](reference/360x844/02-gallery-search-focus.png) |
| 03 검색 결과 없음 | [PNG](reference/1440x1000/03-gallery-empty.png) | [PNG](reference/1024x900/03-gallery-empty.png) | [PNG](reference/768x1024/03-gallery-empty.png) | [PNG](reference/390x844/03-gallery-empty.png) | [PNG](reference/360x844/03-gallery-empty.png) |
| 04 공개 상세 | [PNG](reference/1440x1000/04-detail-public.png) | [PNG](reference/1024x900/04-detail-public.png) | [PNG](reference/768x1024/04-detail-public.png) | [PNG](reference/390x844/04-detail-public.png) | [PNG](reference/360x844/04-detail-public.png) |
| 05 복사 완료 표시 | [PNG](reference/1440x1000/05-copy-done.png) | [PNG](reference/1024x900/05-copy-done.png) | [PNG](reference/768x1024/05-copy-done.png) | [PNG](reference/390x844/05-copy-done.png) | [PNG](reference/360x844/05-copy-done.png) |
| 06 일반 상세 500 오류 | [PNG](reference/1440x1000/06-detail-error-500.png) | [PNG](reference/1024x900/06-detail-error-500.png) | [PNG](reference/768x1024/06-detail-error-500.png) | [PNG](reference/390x844/06-detail-error-500.png) | [PNG](reference/360x844/06-detail-error-500.png) |
| 07 로그인 | [PNG](reference/1440x1000/07-login.png) | [PNG](reference/1024x900/07-login.png) | [PNG](reference/768x1024/07-login.png) | [PNG](reference/390x844/07-login.png) | [PNG](reference/360x844/07-login.png) |
| 08 로그인 필수입력 오류 | [PNG](reference/1440x1000/08-login-error.png) | [PNG](reference/1024x900/08-login-error.png) | [PNG](reference/768x1024/08-login-error.png) | [PNG](reference/390x844/08-login-error.png) | [PNG](reference/360x844/08-login-error.png) |
| 09 회원가입 | [PNG](reference/1440x1000/09-signup.png) | [PNG](reference/1024x900/09-signup.png) | [PNG](reference/768x1024/09-signup.png) | [PNG](reference/390x844/09-signup.png) | [PNG](reference/360x844/09-signup.png) |
| 10 가입 확인 불일치 | [PNG](reference/1440x1000/10-signup-error.png) | [PNG](reference/1024x900/10-signup-error.png) | [PNG](reference/768x1024/10-signup-error.png) | [PNG](reference/390x844/10-signup-error.png) | [PNG](reference/360x844/10-signup-error.png) |
| 11 승인 대기 로그인 | [PNG](reference/1440x1000/11-login-pending.png) | [PNG](reference/1024x900/11-login-pending.png) | [PNG](reference/768x1024/11-login-pending.png) | [PNG](reference/390x844/11-login-pending.png) | [PNG](reference/360x844/11-login-pending.png) |
| 12 작성자 비공개 상세 | [PNG](reference/1440x1000/12-detail-private.png) | [PNG](reference/1024x900/12-detail-private.png) | [PNG](reference/768x1024/12-detail-private.png) | [PNG](reference/390x844/12-detail-private.png) | [PNG](reference/360x844/12-detail-private.png) |
| 13 편집 | [PNG](reference/1440x1000/13-edit.png) | [PNG](reference/1024x900/13-edit.png) | [PNG](reference/768x1024/13-edit.png) | [PNG](reference/390x844/13-edit.png) | [PNG](reference/360x844/13-edit.png) |
| 14 상세 삭제 확인 | [PNG](reference/1440x1000/14-delete-confirm.png) | [PNG](reference/1024x900/14-delete-confirm.png) | [PNG](reference/768x1024/14-delete-confirm.png) | [PNG](reference/390x844/14-delete-confirm.png) | [PNG](reference/360x844/14-delete-confirm.png) |
| 15 상세 삭제 취소 | [PNG](reference/1440x1000/15-delete-cancel.png) | [PNG](reference/1024x900/15-delete-cancel.png) | [PNG](reference/768x1024/15-delete-cancel.png) | [PNG](reference/390x844/15-delete-cancel.png) | [PNG](reference/360x844/15-delete-cancel.png) |
| 16 등록 | [PNG](reference/1440x1000/16-submit.png) | [PNG](reference/1024x900/16-submit.png) | [PNG](reference/768x1024/16-submit.png) | [PNG](reference/390x844/16-submit.png) | [PNG](reference/360x844/16-submit.png) |
| 17 등록 필수입력 오류 | [PNG](reference/1440x1000/17-submit-error.png) | [PNG](reference/1024x900/17-submit-error.png) | [PNG](reference/768x1024/17-submit-error.png) | [PNG](reference/390x844/17-submit-error.png) | [PNG](reference/360x844/17-submit-error.png) |
| 18 관리자 사용자 탭 | [PNG](reference/1440x1000/18-admin-users.png) | [PNG](reference/1024x900/18-admin-users.png) | [PNG](reference/768x1024/18-admin-users.png) | [PNG](reference/390x844/18-admin-users.png) | [PNG](reference/360x844/18-admin-users.png) |
| 19 사용자 삭제 확인 | [PNG](reference/1440x1000/19-admin-user-confirm.png) | [PNG](reference/1024x900/19-admin-user-confirm.png) | [PNG](reference/768x1024/19-admin-user-confirm.png) | [PNG](reference/390x844/19-admin-user-confirm.png) | [PNG](reference/360x844/19-admin-user-confirm.png) |
| 20 비밀번호 입력/취소 | [PNG](reference/1440x1000/20-admin-password.png) | [PNG](reference/1024x900/20-admin-password.png) | [PNG](reference/768x1024/20-admin-password.png) | [PNG](reference/390x844/20-admin-password.png) | [PNG](reference/360x844/20-admin-password.png) |
| 21 Health Monitor | [PNG](reference/1440x1000/21-admin-health.png) | [PNG](reference/1024x900/21-admin-health.png) | [PNG](reference/768x1024/21-admin-health.png) | [PNG](reference/390x844/21-admin-health.png) | [PNG](reference/360x844/21-admin-health.png) |
| 22 관리자 앱 삭제 확인 | [PNG](reference/1440x1000/22-admin-app-confirm.png) | [PNG](reference/1024x900/22-admin-app-confirm.png) | [PNG](reference/768x1024/22-admin-app-confirm.png) | [PNG](reference/390x844/22-admin-app-confirm.png) | [PNG](reference/360x844/22-admin-app-confirm.png) |
| 23 모의 검사 중 | [PNG](reference/1440x1000/23-admin-checking.png) | [PNG](reference/1024x900/23-admin-checking.png) | [PNG](reference/768x1024/23-admin-checking.png) | [PNG](reference/390x844/23-admin-checking.png) | [PNG](reference/360x844/23-admin-checking.png) |
| 24 모의 검사 완료 | [PNG](reference/1440x1000/24-admin-checked.png) | [PNG](reference/1024x900/24-admin-checked.png) | [PNG](reference/768x1024/24-admin-checked.png) | [PNG](reference/390x844/24-admin-checked.png) | [PNG](reference/360x844/24-admin-checked.png) |
| 25 관리자 상세 404 오류 | [PNG](reference/1440x1000/25-admin-detail-404.png) | [PNG](reference/1024x900/25-admin-detail-404.png) | [PNG](reference/768x1024/25-admin-detail-404.png) | [PNG](reference/390x844/25-admin-detail-404.png) | [PNG](reference/360x844/25-admin-detail-404.png) |
| 26 데모 앱 삭제 완료 | [PNG](reference/1440x1000/26-delete-complete.png) | [PNG](reference/1024x900/26-delete-complete.png) | [PNG](reference/768x1024/26-delete-complete.png) | [PNG](reference/390x844/26-delete-complete.png) | [PNG](reference/360x844/26-delete-complete.png) |

## 소스·렌더링·축소 이미지의 관찰 차이

| 항목 | 소스에서 확인 | 실제 렌더링 / 축소 이미지 | 판정 경계 |
|---|---|---|---|
| 갤러리 배지 | `AppCard`가 `StatusBadge`에 `technical`을 넘기지 않음 | 실제 갤러리는 `정상/오류`. 원본 WebP는 `200 OK`, `500 Internal Server Error` 등의 기술 코드가 보임 | 차이를 관찰했으며 기술 코드로 되돌리거나 미리보기를 기준으로 승인하지 않음 |
| 관리자 배지/상세 | 관리자 Health 및 관리자 상세는 `technical` 사용 | `200 OK`, `404 Not Found`, `500 Internal Server Error`가 실제 표시됨. 일반 상세는 `정상/오류` | 역할별 원본 차이이며 서버 검사 결과가 아님 |
| LR 폴백 | Lucide 전역/Copy가 없으면 빈 span Proxy 사용 | 이번 라이브/재현에서는 정상 UMD 전역과 SVG를 사용; 빈 span 폴백 발동은 관찰되지 않음 | 아이콘 성공을 CDN 실패 조건까지 일반화하지 않음. 폴백을 고치거나 강제로 주입하지 않음 |
| 시간·응답 상태 | 상세는 항상 `오늘`, 관리자 404/500의 응답 시간은 `timeout` | [404 상세 패널](reference/1440x1000/25-admin-detail-404-component.png)에서 그대로 확인 | 실제 오류 원인/검사 일시로 신뢰하지 않음. PRD UI-D06에 연결될 관찰 |
| 작은 화면 | header nav는 `sm` 미만에서 숨김; Health 행은 `min-w-0`와 truncate 사용 | 360px의 정상 행 제목 폭 약 **23px**, URL 15개의 표시 폭 **0px**. 390px 제목 폭 약 **53px** | 넘침 없음과 읽기 가능함을 분리. 레이아웃 변경은 아직 승인되지 않음 |
| 축소 이미지의 범위 | `.thumbnail`은 실행 소스가 아닌 별도 WebP | [원본 그대로 복사한 640×358 WebP](thumbnail-original.webp)는 필터·일부 카드만 담고 header/hero/나머지 화면·상태는 담지 않음 | 생성 시 viewport/DPR/시각/폰트/스크롤 조건을 알 수 없어 전체 원본 기준이나 픽셀 합격 판정에 사용하지 않음 |

5개 viewport의 갤러리 열 수는 **4 / 3 / 2 / 1 / 1**이다. **130개 상태 모두** document/body scrollWidth가 viewport 폭과 같고, 화면 안의 렌더링 요소 경계가 viewport를 벗어난 경우는 없었다. 다만 원본 html/body의 `overflow-x:hidden`과 내부 `truncate`가 존재하므로 이 결과를 접근성/가독성 합격으로 확대하지 않는다. 검색 focus로 너비가 늘어나는 상태도 별도 캡처했다.

## 재현 명령과 실제 검증 결과

프로젝트 루트에서 실행한다. 설치된 Python Playwright와 같은 Chromium 바이너리, Pillow가 필요하다. 아래 명령은 애플리케이션 의존성을 설치하지 않는다. 캡처는 **새 임시 디렉터리**에 기록하며 기존 증거를 덮어쓰지 않는다.

```bash
E=docs/evidence/basic-design-runtime-20260922
python3 "$E/verify.py"
(cd "$E" && sha256sum -c SHA256SUMS)

UI_REPLAY_DIR=$(mktemp -d /tmp/eduvibe-ui-replay.XXXXXX)
python3 "$E/capture.py" --mode replay --har "$E/reference/cdn.har.zip" --out "$UI_REPLAY_DIR"
python3 "$E/verify.py" --candidate "$UI_REPLAY_DIR"
```

새 라이브 원본 또는 CDN 응답을 다시 수집하려면 같은 `capture.py`에 `--mode live-baseline`(고정 없음, 갤러리 1개) 또는 `--mode record`(고정된 전체 상태)를 주고 `--out`에 새 디렉터리를 지정한다. 라이브 재수집은 CDN/브라우저 환경 변화로 기존 결과와 달라질 수 있다. HAR replay도 다른 OS/브라우저의 픽셀 동일성을 보장하지 않는다.

실제 실행한 capture 명령의 출력 경로는 `/tmp/wayfinder-baseline-20260922`, `/tmp/wayfinder-record-20260922-v2`, `/tmp/wayfinder-replay-20260922`였다. `--mode`는 각각 `live-baseline`, `record`, `replay`이며 replay의 `--har`는 `/tmp/wayfinder-record-20260922-v2/cdn.har.zip`이었다. 성공 실행 자료를 이 디렉터리의 baseline/reference로 보관했다. 처음 작성한 harness의 버튼 locator를 수정한 뒤 전체 record/replay를 수행했으며 앱 소스 수정은 없었다.

- **통과:** 원본 11개 SHA-256 전후 일치, PNG/HAR 무결성, CDN 본문 해시, SRI 3개, 130개 화면/상태 assertion, 실패 네트워크/JS 예외 0건. replay의 130개 화면 텍스트·입력값·fixture state·폰트·색·레이아웃 측정값은 reference와 동일하다.
- **엄격한 픽셀 동일성 검사: 실패를 보존.** 135 PNG 중 **133개 완전 동일**. [비교 JSON](checks/replay-comparison.json)에 차이 위치·픽셀 수·채널 최대 차이를 기록했다. `1440x1000/13-edit-component.png`는 10픽셀/최대 채널차 5, `390x844/10-signup-error.png`는 20픽셀/최대 채널차 22가 달랐다. [편집 재실행 이미지](checks/replay-differences/1440x1000/13-edit-component.png), [가입 오류 재실행 이미지](checks/replay-differences/390x844/10-signup-error.png)도 보존했다. 원인은 이 작업에서 확정하지 않았다.
- `verify.py --candidate`는 차이가 있으면 결과 JSON을 출력한 뒤 **exit 1**로 종료한다. 이번 비교도 exit 1이며, 임의 허용 오차·mask·유사도 기준을 추가해 통과시키지 않았다. `verify.py` 단독은 증거 무결성 검사다.

이 증거는 [Phase 1 원본 보존·허용 차이·시각 기준 계약 확정](https://github.com/DomineYH/vibe_coding_archive/issues/6)의 입력이다. 배지/아이콘 기준, 좁은 Health 행의 취급, 동일 환경의 캡처 오차 판정은 그 기존 HITL 질문 안에서 사람이 결정한다. 별도 티켓으로 중복 분할하거나 이식본을 구현하지 않았다. 이 보고서 작성 시 증거 커밋은 **로컬 전용**이며 push/PR을 하지 않는다.
