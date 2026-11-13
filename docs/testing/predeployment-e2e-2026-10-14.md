# 배포 준비 E2E 전체 결과 — Stage A+B (2026-10-14)

이 문서는 Stage A(준비 + 정적·단위·백엔드 통합 + mock/visual)와 Stage B(API 필수 변형 + native HTTPS static/functional)의 실제 실행 증거 보고다. 배포 승인이 아니다. 기준 revision은 `f4bec40a69205029ee299eb20c15b82d96808e79`이고 `docs/plans/predeployment-e2e-2026-10-14.md`의 격리·보존·무변경 경계를 따랐다. 제품·설정·테스트·baseline·락파일은 변경하지 않았다. **종합 판정은 FAIL이다** — 설명되지 않은 재현 실패(visual auth 5, HTTPS fault 드릴 3, HTTPS health 정지 계약 1, 단위 timeout 1)가 남아 있고, 실제 호스트 게이트(실제 도메인 TLS·systemd·원격 백업·외부 health 등)는 NOT RUN이다.

## 결과 요약

| 구분               | 판정                       | 수량 / 근거                                                                               |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------------- |
| 격리 사본·툴체인   | 준비 완료                  | tracked 2818파일 SHA256 원본 일치(AGENTS.md 1건 제외·설계 사항), pinned 4종 기록          |
| 프론트 정적·빌드   | PASS                       | `check`, `build:mock`, `build`, `check:dist`, `check:reference` 전부 exit 0               |
| 프론트 단위        | **FAIL**                   | `npm test` 15F/1952P, 대상 재실행 1F/143P(14건 미재현), CI green이어도 FAIL 유지          |
| 백엔드 lint        | PASS                       | `ruff check .`, `ruff format --check .` exit 0                                            |
| 백엔드 전체        | CI_REUSED                  | 로컬 전체는 coordinator 지시로 중단(INTERRUPTED), run 38397453184로 대체 판정             |
| mock E2E           | PASS                       | 14파일 163/163 PASS, exits 0                                                              |
| visual E2E         | **FAIL**                   | unique 156 중 151 PASS / 5 FAIL / 0 skip (auth 5케이스 2회 반복 관찰, 이슈 #245)          |
| API E2E (HTTP)     | 최초 실패 관측·재실행 통과 | 13 호출. 최초 준비 상태 136P/1F/1skip; 편집 재실행 6/6P. 미준비 예상 skip 118은 별도 집계 |
| native HTTPS       | **FAIL**                   | static 9/9 PASS; functional 72/76 중 반복 관측 실패 4(recovery 드릴 3·health 정지 계약 1) |
| 호스트 운영 게이트 | NOT RUN                    | 실제 도메인 TLS·systemd UID 분리·원격 백업·외부 health·용량 실측 — 계획상 본 실행 범위 밖 |

## 계획 부칙 — CI 증거 재사용의 근거

계획 §정적·단위·운영 통합은 "기존 동일 revision/환경 CI가 있으면 유효성을 확인해 재사용한다"고 허용한다. Stage A 도중 coordinator가 run 38397453184를 독립 검증(headSha 일치, backend/frontend 양 잡 성공, Backend tests·Real age encryption/decryption·Vite→Uvicorn forwarded-header·Safe logging/retention·Service syntax/migration 단계 성공)했고, 동일 revision 전체 pytest의 로컬 반복을 중단하도록 지시했다. 이에 따라 로컬 pytest는 174 passed / 0 failed 지점에서 SIGINT로 정상 종료했고 이는 **로컬 PASS로 보고하지 않는다**(INTERRUPTED_BY_COORDINATOR, exit 2). 백엔드 전체 논리 회귀 행은 CI_REUSED로 표기하며 제한은 다음과 같다: CI OS는 ubuntu-24.04, 로컬은 WSL2 Ubuntu 26.04.1(kernel 6.18) — OS 차이를 명시한다. Python 3.12.3 / uv 0.11.28 / `uv.lock` / 소스 SHA256 manifest는 동일함을 확인했다. 로컬 미실행 항목(`dev_proxy_chain`, `requires_age`, `service_units` 계열)은 로컬 NOT RUN이며 CI 해당 단계 성공으로 연결한다. Stage B의 API·HTTPS 브라우저 E2E는 CI로 대체하지 않고 로컬에서 실행한다.

## 격리 실행 환경 (재사용 가능한 변수 포함)

쓰기는 `/tmp/eduvibe-predeploy-20261014/`(0700)와 본 보고 파일뿐이다. 사본은 `git archive HEAD` + tracked 작업트리 덮어쓰기 없이 HEAD 내용이며, 기존 사용자 삭제(CONTEXT.md 부재)를 사본에도 그대로 반영하고 AGENTS.md는 HEAD 버전을 유지했다. 원본-사본 SHA256 비교: 2818파일 중 차이는 AGENTS.md 1건(설계 사항, `evidence/manifest-diff.txt`). 두 lockfile 해시 동일. `/mnt/c`(9p) 대신 Linux tmpfs에서 실행했으며 이는 계획이 우려한 cold-start 지연을 제거하는 차이다(문서화 목적).

```bash
# Stage B 재사용 환경 (source /tmp/eduvibe-predeploy-20261014/env.sh)
ROOT=/tmp/eduvibe-predeploy-20261014
RUN_ROOT=$ROOT/snapshot            # 격리 사본
EVIDENCE=$ROOT/evidence            # 0700 증거 루트
PATH=$TOOLCHAIN/npm12/node_modules/.bin:$TOOLCHAIN/node/bin:\
$TOOLCHAIN/age-root/usr/bin:$TOOLCHAIN/nginx-root/usr/sbin:$PATH
PASSWORD_BLOCKLIST_PATH=$EVIDENCE/password-blocklist-ncsc.txt   # R15 검증 완료(0600)
FONTCONFIG_FILE=$RUN_ROOT/frontend/visual/fontconfig.conf
PLAYWRIGHT_CHROMIUM_EXECUTABLE=$TOOLCHAIN/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell
PLAYWRIGHT_BROWSERS_PATH=$TOOLCHAIN/pw-browsers     # Playwright 1.63.0 chromium-1243
XDG_DATA_HOME=$TOOLCHAIN/xdg                        # xdg/fonts에 Liberation 설치됨
APP_ENV=test, HEALTH_CHECKS_ENABLED=false, CI=true
# native HTTPS 전용: $ROOT/ns-shadow-etc.sh 로 user+mount namespace 안에서
# 최소 비민감 /etc 섀도(nginx mime.types 포함)를 제공 — 실제 /etc 무변경, ns 종료 시 소멸
```

| 구성 요소        | 버전 / 출처                                                                  | 검증                                                                   |
| ---------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Node             | 22.23.2 (nodejs.org 공식, SHASUMS256 대조 `d60acfe0…`)                       | `node --version` = v22.23.2                                            |
| npm              | 12.0.2 (로컬 prefix 설치)                                                    | `npm --version` = 12.0.2                                               |
| Python           | 3.12.3 (기존 uv 관련 설치 사용)                                              | `uv run --frozen python --version`                                     |
| uv               | 0.11.28 (기존 시스템 설치)                                                   | `uv --version`                                                         |
| 브라우저(mock)   | Playwright 1.63.0 Chromium (공식 CDN)                                        | `npx playwright install chromium` exit 0                               |
| 브라우저(visual) | chrome-headless-shell **151.0.7922.34** (CI와 동일 URL)                      | `--version` 출력 일치, ldd 미해결 없음                                 |
| 폰트             | fonts-noto-cjk 1:20240730(사전 설치), fonts-liberation 1:2.1.5-3build1(추가) | 두 패턴 모두 Noto Sans CJK JP, Liberation Mono 확인                    |
| nginx            | 1.28.3-2ubuntu1.11 (서명 패키지 추출, 전역 설치 없음)                        | `--with-http_ssl_module`, `nginx -v` 동작                              |
| age              | 1.2.1-1build1 (동일 방식)                                                    | `age`/`age-keygen` = 1.2.1 (CI 정규식 충족)                            |
| R15 차단 목록    | metadata 고정 URL(commit 190c6f7b)                                           | size 835538 / sha256 `c2e56968…` / 99839 non-empty 일치, 제품 CLI 검증 |

`npm ci`(350 packages)와 `uv sync --locked`는 사본에서 exit 0. npm 12의 install-scripts 경고(esbuild postinstall 보류)는 platform binary가 optional dependency로 설치되어 빌드·테스트에 영향 없음을 확인했다. 시작 시 포트 5173/5174/8000/8080/8443 모두 가용이었고 실행은 종료까지 소유 프로세스만 정리했다. 다운로드는 pinned 공급원(nodejs.org, Chrome for Testing GCS, npm/Pypi 레지스트리, raw.githubusercontent, 우분투 아카이브)뿐이며 health 송신은 비활성(`HEALTH_CHECKS_ENABLED=false`)을 유지했다.

## 실행 결과 (명령 단위)

| 명령 (사본 기준)                                                                    | exit  | 수량 / 비고                                                                                            |
| ----------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `npm run check`                                                                     | 0     | openapi lint/check + typecheck + eslint + prettier, 68s                                                |
| `npm test`                                                                          | **1** | 15 failed / 1952 passed (4파일, 대부분 5000ms timeout + assertion 3건)                                 |
| └ 동일 조건 대상 재실행(실패 4파일, 1회)                                            | **1** | 1 failed / 143 passed — submit-view issuance timeout 재현, 14건 미재현(flaky 후보)                     |
| `npm run build:mock`                                                                | 0     | 18s                                                                                                    |
| `npm run build`                                                                     | 0     | 18s                                                                                                    |
| `npm run check:dist`                                                                | 0     | 96파일, mock/reference/sourcemap 없음                                                                  |
| `npm run check:reference`                                                           | 0     | 원본 11파일 SHA256·바이트 일치                                                                         |
| `uv run --frozen ruff check .` / `ruff format --check .`                            | 0/0   | 168파일 formatted                                                                                      |
| `APP_ENV=test uv run --frozen pytest -ra`                                           | 2     | **INTERRUPTED_BY_COORDINATOR**: collected 1837, 174 passed / 0 failed, 475s 후 중단                    |
| `dev_proxy_chain`, `requires_age`(CI=true), `service_units` 계열 3명령              | —     | 로컬 NOT RUN — CI_REUSED(run 38397453184 해당 단계 성공)로 연결                                        |
| mock 14파일 (`--workers=1 --retries=0`, 원본 timeout, 고유 output/private reporter) | 0×14  | **163/163 PASS**, skip 0                                                                               |
| visual 6파일 1차(폰트 결손 환경)                                                    | 3/6   | gallery 1F+93 미실행, app-create 15F는 폰트 환경 실패; auth 5F는 원인 미확정 — **최초 증거 별도 보존** |
| └ 폰트 복구 후 원래 설정 1회 재실행(gallery/app-create/auth)                        | 1/3   | gallery 94/94, app-create 25/25 PASS, auth 15/20(동일 5케이스 재실패)                                  |

### visual 최종 unique 상태

파일별 고유 테스트 합계(1차 통과 3파일 + 재실행 3파일): **156 = 151 PASS / 5 FAIL / 0 skip**. admin 5, app-create 25, app-create-capture 7, app-delete 5, auth 20(15P/5F), gallery 94. reporter JSON에서 산출(`evidence/suites-visual*/…/results.json`). baseline 변경·옵션 사용 없음, failfast 없음, 첫 실패 증경 보존.

## 실패 분류와 미검증

1. **프론트 단위 FAIL(유지)** — 1차 15F 중 14건은 재실행에서 소멸(flaky 후보, timeout 패턴). submit-view issuance 1건은 timeout이 2회 반복 관찰되었으나 assertion 위반이 아니고 동일 revision CI green이므로 제품 회귀 단정 불가. **원인 미확정.** CI green은 이 FAIL을 대체하지 않는다.
2. **visual 폰트 환경 결함(복구 완료)** — 로컬 Liberation Mono 부재 → 브라우저 렌더링이 DejaVu Sans Mono로 대체, gallery 폰트 단언 실패 및 app-create 픽셀 diff 발생. coordinator 승인으로 서명 패키지 fonts-liberation을 /tmp에 추출해 복구했고 gallery 94/94·app-create 25/25로 소멸 — 제품/baseline 무관한 환경 복구였음이 재현으로 확인. 1차 증거는 ENVIRONMENT_FAILURE로 별도 보존.
3. **visual auth 5케이스(원인 미확정, 2회 반복 관찰)** — 두 실행 모두 같은 5뷰포트 사례가 실패했지만 오류는 다르다. 최초 1440×1000은 `net::ERR_INSUFFICIENT_RESOURCES`(auth.spec.js:260)와 후속 `ENOSPC`·context 종료가 기록됐고, 다른 4뷰포트는 `register()`의 form 가시성 단언(:45)이 실패했다. 재실행의 1440×1000은 `page.evaluate: Target crashed`(:58), 나머지 4개는 리소스 오류다. 최초 오류를 모두 리소스 오류로 요약했던 설명은 triage에서 원본 로그에 따라 정정했다. 원인과 오류 간 인과관계는 미확정이다. **미완료 검증**: 해당 5뷰포트 인증·비공개 상세 진입 흐름의 전체 실행. `capture()`는 baseline이 있는 화면의 픽셀 차이를 측정하고 `product_only`는 제품 캡처·폭과 기능 단언을 기록한다. 픽셀 차이 자체는 단언하지 않으므로 전 화면 픽셀 동일성이 검증됐다는 뜻이 아니다. 실패 전 캡처는 존재할 수 있으며 동일 revision CI 성공이 이 로컬 실패를 해결하지 않는다.

정제 초안(등록은 coordinator): `issues/draft-unit-test-timeout-flaky.md`, `draft-visual-font-environment-gap.md`, `draft-visual-auth-repro-local.md` (절대 경로 `/tmp/eduvibe-predeploy-20261014/issues/`, 단위·인증 시각 2건은 GitHub 이슈 #244·#245로 등록됨). 테스트 작업자는 GitHub 쓰기를 수행하지 않았으며, 이슈 등록은 코디네이터가 수행했다.

## Stage B — API 필수 변형 및 native HTTPS 실행 결과

실행 방식: 명시적 spec 파일을 항상 나열한 경계 그룹 21회 호출(러너 특성상 옵션만 전달하면 기본 행렬이 선택되지 않음). `--workers=1 --retries=0`, 원본 timeout·config, 호출별 고유 `--output`과 비공개 reporter로 내부 실행마다 결과 보존. 내부 그룹 사이에서만 중단되는 러너 특성 때문에 미실행 그룹은 식별 후 경계 후속 호출로만 보충했다(통과 그룹 전면 재실행 없음). 인벤토리: `/tmp/eduvibe-predeploy-20261014/inventory-stageB.json`.

| 호출                                | 모드                        | 내부 실행 / raw 결과                                                                     | exit |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ---- |
| sB00-selfcheck                      | `--nginx` + `--list`        | 9개 나열만, 서버 기동 없음 — ns·nginx prepare·migration/bootstrap 플로밍 검증            | 0    |
| sB11-static-https                   | `--nginx`                   | 기동 실패(진단 후 환경 수리) — **ENVIRONMENT_FAILURE 보존**                              | 1    |
| └ sB11r-static-https                | `--nginx`                   | static-serving 9/9 PASS (HTTPS 인증서·쿠키·헤더 예산·dotfile 차단 등)                    | 0    |
| sB01-prepared                       | prepared 24파일             | 138 = 136P / 1F(app-edit timeout) / 1 예상 skip; capture·reset-recovery 그룹 미실행      | 1    |
| └ sB01f-reset-recovery              | prepared                    | reset-recovery 7/7 PASS (latch 격리 내부 실행 보충)                                      | 0    |
| └ sB01f-capture4                    | prepared                    | functional 21P(중복) + **fixed-clock capture 20P** (러너 분리 의미 보존)                 | 0    |
| └ sB13-app-edit-repro               | prepared                    | app-edit 6/6 PASS — **1차 timeout 미재현(flaky 후보, 1차 증거 보존)**                    | 0    |
| sB02-extra-gallery                  | prepared (apps 동반)        | gallery-query/paging/ime/races/zero-result + meta 32/32 PASS                             | 0    |
| sB03-support                        | configured support          | prepared·unavailable 2내부실행 2/2 PASS                                                  | 0    |
| sB04-candidate                      | synthetic candidate         | approved·pending·invalid·revoked 4상태 전부 PASS                                         | 0    |
| sB05-candidate-unavail              | `--auth-unavailable`        | pending 일반 경계 1/1 PASS                                                               | 0    |
| sB06-faults                         | fault launcher·소켓         | 7파일 66/66 PASS (functional 46 + fixed-clock captures 20)                               | 0    |
| sB07-health-http                    | controlled health           | health-real 6/6 PASS (외부 송신 없음)                                                    | 0    |
| sB08-empty-adminlist                | `--admin-apps-empty`        | 진성 0앱 DB 관리자 목록 1/1 PASS                                                         | 0    |
| sB09-unavail-normal                 | `--auth-unavailable`        | 16P + **117 예상 skip**(prepared 전용·fault testIgnore) — 경계 단언 실행                 | 0    |
| sB10-unavail-gallery                | `--auth-unavailable`        | 31P + 1 예상 skip                                                                        | 0    |
| sB12-functional-https               | `--nginx-functional` 12파일 | 기동 실패(동일 환경 수리) — **ENVIRONMENT_FAILURE 보존**                                 | 1    |
| └ sB12r-functional-https            | `--nginx-functional`        | functional 49P + capture 15P + support 1P + recovery-drill 2P/**3F**; health 그룹 미실행 | 1    |
| └ sB14-recovery-process-https-repro | `--nginx-functional` 단독   | 동일 3케이스 반복 관찰(2P/3F) — 아래 분류 1                                              | 1    |
| └ sB15-health-https                 | `--nginx-functional` 단독   | 5P/**1F** — 아래 분류 2                                                                  | 1    |
| └ sB15r-health-https-repro          | `--nginx-functional` 단독   | 동일 1케이스 반복 관찰(5P/1F)                                                            | 1    |

중복 원장: `apps.spec.js` 명시 실행 3회(sB01·sB02·sB10), support configured 3내부실행(sB03×2+sB12r), health-real 실제 3회(sB07·sB15·sB15r); sB12r 내부 health는 미실행, capture 분리 재실행 겹침 21건(sB01f). 모두 별도 기록으로 합산하지 않았다.

### native HTTPS 환경 수리 (제품 발견과 구분 — 전부 task-owned /tmp)

1. **ns 캡 권한**: `unshare --user --map-root-user --mount`에서 nginx(매핑 root)가 임시 디렉터리 `chown(nobody)` 시도가 EINVAL로 실패. 검증된 해법: `unshare --user --map-current-user --keep-caps --mount` — uid 1000 유지·네임스페이스 단위 CAP 유지로 마운트 가능 + nginx 비root 실행(chown 시도 없음).
2. **섀도 확장**: `/etc`에 `/etc/fonts`(fonts.conf·conf.d·conf.avail) 추가, `/usr/share/fontconfig`(conf.d 심링크 절대 대상) 섀도 마운트, `/var/lib` 빈 tmpfs(컴파일 기본 fastcgi/uwsgi/scgi temp 경로). ns 안에서 `nginx -t` 성공, fc-match Noto×2 + Liberation Mono 확인.
3. 최초 2회 기동 실패(sB11·sB12)는 위 환경 미비 — **ENVIRONMENT_FAILURE로 별도 보존**, 수리 후 재실행이며 기존 실패는 소멸 처리하지 않았다.

### Stage B 실패 분류와 미검증

1. **HTTPS fault 드릴 3케이스(내부 원인 미특정, 2회 반복 관찰)** — `auth-recovery-process.spec.js`의 `:151·:250·:279`가 `--nginx-functional`에서 `Error: private process drill failed; keep auth stopped`로 실패. 이 메시지는 `auth-fault-launcher.mjs` 381-384행의 **일괄 catch**가 내보내는 것으로, 드릴 내부 예외의 존재만 전달하며 어느 단계가 실패했는지·auth 중단 사전조건 충족 여부조차 특정하지 않는다. 동일 파일 HTTP fault 모드(sB06)는 전부 통과, 동일 revision CI도 통과 — HTTPS 여부와 WSL2 환경이 함께 존재해 분리 불가. **미검증**: 해당 3계약의 HTTPS 로컬 증명. 반복 관찰은 비우연성 입증이 아니다.
2. **HTTPS health 정지 계약 1케이스(2회 반복 관찰)** — `health-real.spec.js:311 › disable cancels queued work…`에서 `expect(disabled.status).toBe(3)`가 **Expected 3 / Received 1**. exit 3(HEALTH_STOP_REQUIRED)은 fail-closed 계약이며 관찰된 exit 1은 그와 다른 결과지만, 내부 경로가 가려져 제품 위반 단정은 불가(362행 stdout 단언 미도달). HTTP(sB07)는 6/6 통과.
3. **app-edit timeout 1회 관찰** — sB01에서 30s timeout(page/browser closed), 단독 재실행(sB13) 6/6 PASS로 미재현. flaky 후보로 기록, 제품 결함으로 단정하지 않고 최초 실행 실패와 미재현 결과를 기록한다. 기존 #243에 추가 관측으로 연결한다.

GitHub 등록 완료: [#246 HTTPS 복구·마이그레이션 드릴 실패](https://github.com/DomineYH/vibe_coding_archive/issues/246), [#247 HTTPS 연결 검사 중지 종료 코드 불일치](https://github.com/DomineYH/vibe_coding_archive/issues/247). 원인 미확정과 두 차례 관측 조건을 각 이슈에 기록했다.

## BLOCKED / NOT RUN 및 한계

- 실제 호스트 운영 게이트(실제 도메인 TLS·ingress, systemd 실서비스 UID/cgroup, 원격 백업 내구성·RPO/RTO 실측, 실제 DNS/외부 health 활성, 로그 보존·용량 실측): **NOT RUN** — 계획이 명시한 별도 호스트 게이트로, localhost·pytest·CI로 대체 불가.
- 로컬 백엔드 전체 및 CI 강제 3명령: 로컬 **NOT RUN**(INTERRUPTED 후 CI_REUSED 대체, OS 차이 명시).
- §13.2 성능(p95 500ms 목표): 미측정 — PASS 기록 없음.
- 환경 한계: WSL2 커널/OS 차이(모든 로컬 결과에 공통 적용), harness 소속 playwright-mcp 상주 프로세스 존재(소유 아님, 정리하지 않음), tmpfs 3.9GB 중 약 2.4GB 사용.

## 증거 위치 (비공개 0700/0600)

- 진행 원장: `/tmp/eduvibe-predeploy-20261014/progress.json` (호출별 start/exit/counts 이력)
- 로그: `$ROOT/logs/` (npm-ci, uv-sync, frontend-check/test/test-rerun, build·check 4종, ruff 2종, pytest-full, r15-prepare, chrome151-version, pw-install)
- Stage A 브라우저 증거: `$EVIDENCE/suites-mock/`, `$EVIDENCE/suites-visual/`, `$EVIDENCE/suites-visual-first-ENVFAIL/`
- Stage B API 증거: `$EVIDENCE/api/<호출레이블>/` (console.log, exit.txt, 내부 실행별 reporter results.json, `api-summary.tsv`), 인벤토리 `$ROOT/inventory-stageB.json`, nginx 진단 `$EVIDENCE/api/nginx-diag/`
- 준비 증거: `$EVIDENCE/manifest-*.txt`, `source-git-meta.txt`, `pytest-partial-INTERRUPTED_BY_COORDINATOR.txt`, `nginx-selfcheck/`
- 정제 이슈 초안: `/tmp/eduvibe-predeploy-20261014/issues/` 5건 (단위 timeout→#244, visual auth→#245 등록됨; HTTPS 복구 드릴→#246, HTTPS health 정지 계약→#247 등록됨; 폰트 환경 초안은 복구 완료 기록)
- 이번 작업의 저장소 산출물: 계획 파일과 본 보고 파일. 기존 사용자 변경을 보존했고 제품 소스는 변경하지 않았다.

## GitHub 문제 기록

- [#244 프런트엔드 단위 테스트 시간 초과](https://github.com/DomineYH/vibe_coding_archive/issues/244)
- [#245 인증 시각 검증 리소스 오류·Target crashed](https://github.com/DomineYH/vibe_coding_archive/issues/245)
- [#246 HTTPS 복구·마이그레이션 드릴 실패](https://github.com/DomineYH/vibe_coding_archive/issues/246)
- [#247 HTTPS 연결 검사 중지 종료 코드 불일치](https://github.com/DomineYH/vibe_coding_archive/issues/247)

모두 `bug`·`needs-triage`로 등록했다. 제품 결함과 실행 환경 문제의 원인 구분은 후속 조사 대상이며, 이번 요청에서 수정·배포는 수행하지 않았다.

## 증거의 영구 보관

원본 실행 경로는 `/tmp/eduvibe-predeploy-20261014/`이며, 로그·결과 JSON·실패 산출물·실행 인벤토리·보고서 사본은 다음 사용자 전용 디렉터리(0700)에 보관한다. 이 증거는 GitHub에 첨부하지 않는다.

`/home/dominelinux/.local/share/eduvibe-e2e-evidence/2026-10-14-7zjg3mxw`

독립 보고서 대조 검토의 결과는 위 디렉터리의 `final-review.md`로 보관한다. 런타임 준비 파일·격리 사본은 후속 재현을 위해 임시 경로에 유지하고, 이 작업용 Herdr pane과 테스트 서버는 종료한다.

## 2026-10-14 triage 후속 기록

Codex `gpt-6-astra`·`medium`으로 #244~#247의 원문·코드·기존 증거를 확인하고 원래 테스트의 실패 사례를 각각 하나씩 집중 실행했다. #244는 1 PASS(제목 제외 10)로 미재현, #245는 리소스 오류 및 후속 ENOSPC로 1 FAIL, #246은 일반 복구 드릴 오류로 1 FAIL, #247은 Expected 3 / Received 1로 1 FAIL이었다. 이번 실행은 별도 network/PID namespace·새 캐시를 사용했으므로 과거 실행과 환경이 완전히 같지 않다. 원인 동일성이나 해결을 단정하지 않는다. #245의 충분한 저장 공간 조건 및 trace 완전성은 검증하지 못했다.

네 이슈에 진단·안정화 Agent Brief를 등록하고 `bug`·`ready-for-agent`로 전환했다. #245 본문도 최초 오류별 매핑과 시각 검증 범위에 맞게 정정했다. 원래 집계와 FAIL 판정은 유지하며 제품 수정·전체 회귀·배포는 수행하지 않았다.

후속 증거·게시 기록은 영구 보관 디렉터리의 `triage-244-247/`에 보관한다. 기존 `final-review.md` 및 고정 SHA-256 보고서 사본은 triage 이전 버전에 대한 검토 기록으로 보존하고, 정정된 본 보고서는 별도 `predeployment-e2e-2026-10-14-triage-corrected.md` 사본으로 보관한다.
