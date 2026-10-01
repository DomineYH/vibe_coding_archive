# #117 / T03 관리자 자격증명·본인 비밀번호 변경 검수 원장

범위: #113 T03, US-21~25/42/52~55의 관리자 자격증명 부분. T01(#122)/T02(#123)의
실제 흐름·허가·세대 쿠키·Argon2 게이트·rolling 제한·결과 복구를 재사용한다.
자동 승인 seam은 제품 화면→서비스/mapper→HTTP→시험 소유 파일 SQLite/브라우저 쿠키,
관리 CLI→파일 SQLite, 지연 HTTP→commit→미수령 결과 확인이다.
backend 경합 보완 seam은 TestClient의 ASGI HTTP와 실제 파일 SQLite다. uvicorn/브라우저
경합 검증으로 계산하지 않으며, 실제 uvicorn/브라우저의 지연 HTTP는 응답 유실 사례다. mock 합격을 실제 인증으로
계산하지 않는다. 운영 계정·배포·baseline 변경은 실행하지 않았다.

## 구현과 공통 영향 평가

- `bootstrap-admin`/`recover-admin`: 실제 stdin/stdout TTY, getpass 숨김 입력·재확인·명시적 YES.
  관리자 0명/아이디 충돌/일반 회원 승격/기존 관리자만 복구를 BEGIN IMMEDIATE에서 검사한다.
  자격증명·회원 버전·세션 폐기·최소 감사는 한 commit이며 감사 실패 전체 rollback이다.
- 고정 R15 NCSC 100k(2026.1, 190c6f7bd58c847ceadfe57d9853592737f059e8,
  SHA-256 c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0)는
  명시적 개별 준비 후 전체 목록을 무결성 확인해 사용한다. 원문/파생 목록을 저장소나 패키지에
  포함하지 않는다. 시험 fixture 취득도 런타임 기동과 분리한다. 누락/오염은 활성 시험 기동 거부.
- 임시 비밀번호 24시간; change_only=min(발급+15분, 임시 만료). 제한 Self에 연락처/recent-auth 없음.
  NFC·15~128 code point·공백/대소문자 보존·전체 문자열 차단·임시와 다른 값, 확인값 미전송.
- 본인 변경의 최종 BEGIN IMMEDIATE에서 흐름/S/CSRF/허가의 현재 유효성과 회원 ID·버전·해시를
  재대조한다. 임시 자격증명 소모/다른 change_only 폐기와 새 full S가 원자적으로 commit된다.
  완료 시각부터 8시간/30분/관리자 recent-auth 15분. 평상시 로그인은 recent-auth를 열지 않는다.
- `0004_session_recent_auth`는 세션 nullable 열만 추가한다. 회원 ID/아카이브 앱 소유권/기존 해시와
  세션을 보존하며 공개 DTO에 새 값을 노출하지 않는다. 공개 읽기·migration·seed·mock 관리자 및
  공유 인증 API/mapper/모델의 영향을 평가해 backend 전체, frontend 단위 전체와 관련 브라우저,
  API 전체 및 auth/admin visual을 검사한다. 일반 실행은 auth off; 시험 /meta는 T01–T03 세 capability
  묶음 on이고 가입·관리자 재인증·일반 회원 초기화·삭제는 off이다.

## 요구·사례·기대 결과 연결

| #117 수용 기준 / #113 계약 | 실행 seam·증거 | 판정 |
| --- | --- | --- |
| R15 bootstrap/recovery·TTY·비출력·원자 감사 | `tests/test_admin_bootstrap.py`: 실제 PTY 최초 생성, 기존 관리자/일반 회원/없는 대상/정규화 충돌 거부, 재확인 불일치, 비대화형 거부, 로그인 상태 복구 폐기, DB 감사 trigger 실패에 회원/세션 rollback | 합격 |
| 임시 24h·짧은 change_only·제한 Self | CLI 실제 저장 자료, `test_auth_password.py` 제한 DTO/me, 더 이른 임시 만료 경계, full 시작 시계·재시작 유지; T02 임시 만료 로그인/비집계 회귀 | 합격 |
| 비밀번호 정책·브라우저 확인·full 거절 | HTTP 길이/같은 값/실제 목록 차단·공백/대소문자 보존, 직접 full API 403 SESSION_KIND_NOT_ALLOWED, API E2E 불일치 확인 요청 0회·본문 password만 | 합격 |
| 최종 commit 재검사·한 번 소모·완료 브라우저 full | backend 보완 seam(ASGI HTTP)에서 실제 Argon2의 반환만 지연; 파일 DB에서 S 만료/폐기·임시 만료·회원 버전/해시·허가 만료·흐름 폐기·settle 8변형 및 두 브라우저 동시 소모, 다른 제한 세션 401 | 합격 |
| 서버 commit 후 응답/S 미수령 | E2E 서버에 실제 POST를 전달해 200 commit 후 browser 응답을 중단. 원래 결과 확인·해당 full만 discard, 새 비밀번호로 다른 브라우저 로그인/refresh 유지, 원 브라우저 재로그인. password change 재실행/rollback 없음 | 합격 |
| 실제 TTY→파일 DB→제품 로그인→첫 변경→full 재관측 | API runner가 빈 시험 DB에서 실제 CLI bootstrap한 first-admin을 브라우저에서 첫 변경/reload; 기존 synthetic admin은 실제 CLI recover 후 연결 | 합격 |
| 운영 쿠키 회귀·공개/seed/mock 영향 | HTTP HTTPS 운영 속성: __Host-/Secure/HttpOnly/Path=/·SameSite=Lax, Domain/Expires/Max-Age 없음; 관련 이전 계약과 최종 회귀 명령 | 합격 |
| 화면·접근성·증거 | 기존 카드/EV/57px header, 5 viewport 정상·동일값 오류의 product-only 관찰, keyboard 순서/접근 이름/aria-invalid·describedby·오류 focus; 아래 독립 캡처 | 합격 |

## 최초 실패→수정→재검증

1. 미구현 CLI(2)와 제한 로그인(503)으로 첫 red를 확인한 뒤 각 slice를 구현해 green.
2. 공통 AuthError가 필드 오류를 받지 못해 500이던 결함을 HTTP 길이/동일값/차단 검사로 발견;
   필드 오류 envelope를 보강하고 terminal failed로 저장해 재제출 가능함을 확인했다.
3. 인증 재관측 시 PasswordChangeCard가 unmount돼 서버 필드 오류가 사라지는 것을 실제 browser에서
   발견; 폼 상태를 기존 AuthView로 이동해 보존하고 첫 오류 focus를 연결했다. 5 viewport green.
4. 직접 full 변경 호출이 SESSION_KIND_NOT_ALLOWED 대신 422이던 red를 확인하고 공통 실행 proof에서
   종류를 검사해 403 green. T02의 rolling/불능 해시/최종 snapshot/로그아웃 만료 검사는 유지했다.
5. 시험 harness의 중복 로그인 button locator와 discard 뒤 password-change 경로의 기대를 교정했다.
   discard 후 기존 로그인 링크를 이용한다. 검증 조건·서비스 성공·기준 이미지·허용 오차를 약화하지 않았다.
6. mock e2e/visual을 병행 시작해 5173 예약 거부와 이전 Playwright 산출물 삭제(ENOENT)가 발생했다.
   제품/픽셀 실패가 아니며 해당 768×1024 visual을 순차 실행해 통과하고 mock 45개도 통과했다.
7. backend 전체의 축소 checkout seed 회귀가 실패했다. 새 모듈이 import 때 인증 연구 메타데이터를
   읽어 auth off인 공개 API 시작을 막았다. 메타데이터를 인증 준비에서만 지연 읽도록 고치고
   seed 전체/공개 API/본인 변경 27개를 재검사해 통과했다.

## 최종 명령·결과

| 실행 위치 / 명령 | 실제 결과 |
| --- | --- |
| backend / `uv run pytest` (전체 한 번) | 194 collected: **193 passed / 1 failed**, 448.41s. 실패는 축소 checkout seed 시작의 메타데이터 eager-read, 아래 재검사로 해결 |
| backend / `uv run pytest tests/test_dev_seed.py tests/contracts/test_auth_password.py tests/contracts/test_public_meta_health.py -q --tb=short` | **27 passed**, 48.21s; seed 8 + password 17 + public meta 2 |
| backend / `uv run pytest tests/contracts/test_auth_password.py tests/test_admin_bootstrap.py -q --tb=short` | **22 passed**, 57.31s; 중복 guard 제거 및 CLI 24h 검사 후 |
| backend / `uv run ruff check .` · `uv run ruff format --check .` | 리뷰 수정 뒤 통과, 40 files formatted |
| frontend / `npm run check` | 통과; 기존 healthz/readyz OpenAPI 경고 2, 생성 타입 일치 |
| frontend / `npm test` (전체 한 번) | **32 files / 828 passed** |
| frontend / `npx playwright test e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js` | **45 passed**, 1.5m; mock 회귀이며 실제 인증으로 계산하지 않음 |
| frontend / `npm run test:e2e:api` (전체 한 번, pinned Chromium) | 일반/auth off **49 passed / 21 conditional skipped**, 3.8m; 준비된 실제 인증 **39 passed**, 3.0m (T01 17 + T02 13 + T03 9). off에서 인증 실행 사례는 환경상 제외하고 별도 준비 실행에서 모두 검사 |
| frontend / `npm run test:e2e:api -- auth-password.spec.js` (r2 정정·독립 pinned 재현) | 기능 **5 passed**, 24.2s + 별도 고정 시계 캡처 **5 passed**, 23.8s; 커밋된 change-only/same-password 10 PNG 모두 SHA-256 동일 |
| frontend / `npm run test:visual -- visual/auth.spec.js visual/admin.spec.js` | **9 passed / 1 harness ENOENT**, 5.6m; 아래 1건 재검사 포함 모든 10 화면 검사 통과 |
| frontend / `npm run test:visual -- visual/admin.spec.js --grep 768x1024` | **1 passed**, 23.6s; 기준 이미지 변경 없음 |
| frontend / `npm run build:mock` · `npm run build` · `npm run check:dist` · `npm run check:reference` | 모두 통과; 기존 Vite 큰 chunk 안내 유지 |
| frontend / 리뷰 후 `npm run check` · `npx vitest run tests/auth-view.test.jsx tests/api-auth-login.test.ts tests/api-auth.test.ts` | check 통과 / **3 files, 22 passed** |
| frontend / 리뷰 후 `npm run test:e2e:api -- auth-password.spec.js` (pinned) | **10 passed**, 42.6s; 두 탭 초안 회귀 포함, 최종 10 PNG도 첫 독립 실행과 SHA-256 동일 |
| frontend / `npm run openapi:generate` | 계약 설명 갱신·생성 타입 커밋; 정상 `openapi:check`에서 일치 |

8. 독립 Spec 리뷰가 본인 변경 초안이 같은 관리자의 로그아웃→재로그인 뒤 남는 회귀를 지적했다.
   실제 두 탭 E2E에서 기대 empty/관찰 old draft red를 확인했다. AuthRoute key에 기존 인증 scope를
   재사용하고 관찰 세대만 제외해 같은 scope의 오류 재확인은 보존하면서 흐름·회원·권한·마지막
   전환 이력 변경은 재마운트하도록 수정했다. 동일값 오류 5 viewport를 포함해 6개 green.

전체 스위트는 마지막에 한 번 실행했다. 새 실패/리뷰 수정은 관련 파일만 재검사하며 최초
실패를 위 수치에서 지우지 않는다. 기존 API E2E가 과거 Phase 2 관찰 PNG를 다시 쓰는
부작용은 모두 원래 추적 내용으로 복원했다(62개); 이 PR은 그 파일을 변경하지 않는다.


## 화면·접근성·미실행/제외

[캡처 목록](captures.json)은 change-only/same-password 10개와 준비 로그인 5개다.
[독립 재현 비교](capture-reproducibility.json)의 **10/10**은 두 독립 실행과 리뷰 반영 뒤 최종 실행에서도 SHA-256이 같다.
[로그인 원본 직접 비교](source-login-comparison.json)는 전체 PNG의 치수/픽셀 차이를 기록한다.
3개는 치수 불일치, 치수가 같은 2개도 UI-D03/UI-D04의 기존 데모/본문 차이가 있으며
원본과 픽셀 일치라고 주장하지 않는다.

변경 전용 카드에 대응하는 보존본 frame은 없으며 `product_only`로 분류한다. 기존 로그인의
보존본 직접 비교와 제품 회귀는 구별한다. 새 baseline, reference PNG, mask, tolerance 변경 없음.
고정 Chromium 151.0.7922.34/sRGB/partial-raster off, DPR1, ko-KR/Asia-Seoul,
폰트 `visual/fontconfig.conf`, 시험 서버/브라우저 시계 2026-10-01T00:00:00Z,
animation off로 두 독립 DB/서버/browser 실행을 비교한다. CLI의 실제 시계는 동작하며,
화면 관찰의 짧은 세션 발급 시계만 시험 서버 seam에서 고정한다.

r2 minor-1에 따라 재현 명령을 정정했다. `--grep` 없는 아래 명령이 기능 검사 뒤 별도
서버에서 고정 시계 캡처를 실행한다. 명시적 `--grep` 선택은 움직이는 시계를 사용한다.
명시적으로 준비한 R15 원본과 Chromium 151.0.7922.34 실행 파일의 절대 경로를 설정한다.

```sh
cd frontend
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/chrome-headless-shell-linux64/chrome-headless-shell
export FONTCONFIG_FILE="$PWD/visual/fontconfig.conf"
npm run test:e2e:api -- auth-password.spec.js
```

위 명령을 직접 실행한 뒤 `test-results/api/*/change-only.png`와 `same-password.png`를
5개 viewport별로 `git show HEAD:docs/evidence/phase-3/issue117/2026-10-02/visual/<파일명>`의
커밋된 PNG 바이트와 비교했다. SHA-256 **10/10 일치**이며 기존 재현 비교 JSON의 해시와도
일치했다. 코드·기준 이미지·커밋된 관찰 PNG는 변경하지 않았다.

가입/승인·사용자 탭(T04/T05), 비공개 보호 요청·활동 연장(T06), 전체 응답 경합/실기기·실제
운영 호스트 성능·브라우저/백업/정리·사람의 시각/보조기술 수락(T07)은 이 티켓의 실행 합격으로
세지 않는다. U01(운영 연락/준비/실기기)·U02(목록 재배포 권리)는 T07 공개 gate로 남는다.
로컬 자동 합격은 인증 공개 승인이 아니다. 비밀·원문 DB·쿠키·CSRF·연락처는 증거에 첨부하지 않는다.


## Standards

독립 code-review 1차: hard violation 0, judgement call 1.
`auth_password.py`의 종류 guard가 공통 `execution_context`와 중복되고 도달 불가라는
지적을 반영해 삭제했다. 수정 hunk 재리뷰: **hard violation 0 / 남은 judgement call 0**.
Lazy 메타데이터 읽기와 기존 인증 scope 재사용도 surgical/stdlib 규칙에 맞는 것으로 확인됐다.

## Spec

독립 code-review 1차: **P2 1건**(계정 전환 뒤 본인 변경 초안 보존).
R23 §4의 같은 흐름·회원·현재 권한·마지막 전환 이력 조건을 AuthRoute key에 연결하고 실제
같은 회원 logout→relogin 브라우저 실패를 고쳤다. 수정 hunk 재리뷰: **미해결 0건**.
T03 이외 누락/잘못된 동작/범위 확장 지적은 없었다. 최종 실행과 증거 집계는 구현 워커가 확인했다.

두 축 최종 합계: Standards 0 / Spec 0. 사람의 시각 수락·운영 공개 gate 판정은 포함하지 않는다.


## PR #124 독립 리뷰 minor 반영

opus 5.5 r1 판정 APPROVE(blocker/major 0)의 minor 1~8을 같은 브랜치에서 반영했다.
9번은 위 seam 구분에 기록만 했으며 경합 E2E를 추가하지 않았다.

| 항목 | 처리·검증 |
| --- | --- |
| 1 | 최종 실행 proof 확인 뒤 회원 검증 실패를 `failed`/failure_code로 commit. 임시 만료 경합이 executing/None으로 남는 red → failed/AUTH_REQUIRED green. 실행 proof 자체가 실패하면 리뷰 제안대로 R settle에 맡긴다. S 만료·폐기는 settle/cancelled 뒤 새 익명 S·재로그인, 폐기 flow는 새 flow·재로그인을 단언한다. |
| 2 | 기능 검사는 움직이는 서버 시계, 5개 카드 캡처는 별도 고정 시계 서버. 혼합 spec 인자의 flow-state 시계 진행 검사가 red → green. 인자 없는 기본 실행도 이 분리를 사용한다. 명시적 grep 선택은 움직이는 시계로 보존한다. |
| 3 | 8개 경합 변형별 정확한 HTTP status/error code/state/failure_code와 미변경·full 미발급을 단언한다. |
| 4 | 실제 commit·응답/쿠키 abort 뒤 flow-state의 원래 succeeded/result_session_generation 확인. SQLite에서 정확한 결과 full 세대의 미폐기→폐기와 다른 브라우저 full 미폐기를 단언한다. T02 조회 helper를 공유한다. |
| 5 | member_session은 full 또는 change_only이며 보호 기능은 별도로 full을 요구해야 한다는 docstring으로 교정. 후속 보호 API를 구현하지 않는다. |
| 6 | 다음 세대 쿠키 예산을 executing commit·해싱 전에 확인하고 초과는 failed/AUTH_COOKIE_BUDGET_EXCEEDED. 검증 호출 없음·회원 무변경·full 미발급을 단언한다(red → green). |
| 7 | 공개 fixture는 목록을 요구하지 않는다. 인증 시험·API 러너는 명시적으로 준비한 PASSWORD_BLOCKLIST_PATH를 사본으로 사용하며 자동 다운로드 없음. 외부 접속 차단 공개/인증 pytest를 각각 red → green. R15 원본 전체 SHA-256·크기·행 수 검사를 유지하고 누락/오염 거절도 유지한다. CI의 개별 취득은 테스트 전 명시적 setup이다. 원문·파생 목록 커밋/패키징 없음. |
| 8 | unchanged(ID/account_version/hash), temporary_valid(expiry > at) 술어만 공유. 회원 재대조와 임시 만료 기준은 그대로다. |
| 9 | ASGI·파일 DB의 backend 보완 seam과 실제 uvicorn·브라우저의 응답 유실 seam 구분 기록. 추가 구현 없음. |

반영 diff의 code-review 재검토: Standards hard violation 0 / judgement call 0, Spec 0.
아래 결과는 이 반영 diff에서 다시 실제 실행한 결과다. 전체 backend는 이번에 모두 green이다.
인증 검증에는 명시적으로 준비한 R15 원본 경로를 설정했으며, 일반 API e2e는 Python 외부
접속을 거부하는 시험 환경에서도 완료했다(루프백 HTTP만 허용).

| 위치 / 명령 | 결과 |
| --- | --- |
| backend / `uv run pytest tests/contracts/test_auth_password.py tests/contracts/test_auth_login.py -q` | 55 passed, 68.36s |
| backend / `uv run pytest tests/test_password_test_provisioning.py -q` | 네트워크 접속 차단 공개·인증 자식 pytest 모두 완료, 2 passed, 5.04s |
| backend / `uv run pytest` | **197 passed**, 328.98s; 실패·skip 0 |
| backend / `uv run ruff check .` · `uv run ruff format --check .` | 통과 / 41 files formatted |
| frontend / `npm run check` · `npm test` | 통과(기존 OpenAPI 경고 2) / 32 files, 828 passed |
| frontend / `npx playwright test e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js` | 45 passed, 1.3m; mock 회귀 |
| frontend / `npm run test:e2e:api -- auth-password.spec.js` | 기능 5 passed, 26.9s + 별도 고정 시계 캡처 5 passed, 27.3s |
| frontend / 인자 없는 `npm run test:e2e:api` (외부 네트워크 차단, pinned Chromium) | 일반/auth off 49 passed / 22 조건부 제외, 2.3m + 준비된 기능 36 passed, 2.0m + 별도 고정 시계 캡처 5 passed, 34.1s. off의 제외는 별도 준비 경계에서 검사 |

공유 API 계약·화면·기준 이미지는 이 리뷰 반영에서 변경하지 않았다. 과거 Phase 2 관찰 PNG
62개의 러너 재생성분은 원래 내용으로 복원했으며 커밋하지 않았다.


CI 첫 실행(186d381)의 backend 준비 단계는 RUNNER_TEMP가 `/tmp` 바깥이라 test DB
경로 정책에서 거절됐다. 목록 취득만 하는 명시적 준비 CLI를 development 환경으로 수정했다.
같은 `/tmp` 바깥 DB 설정으로 실제 prepare-password-blocklist CLI를 실행해 성공했고,
R15 전체 SHA-256·835538 bytes를 다시 확인했다. 테스트 환경과 DB 경로 정책은 변경하지 않았다.
