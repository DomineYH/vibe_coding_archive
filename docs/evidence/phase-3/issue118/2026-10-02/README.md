# #118 / T04 가입·최초 승인 대기·만료 정리 검수 원장

범위: #113 T04 / US-03~13, US-51~55 중 가입·최초 대기. 선행 T01~T03
(PR #122/#123/#124)의 실제 흐름·쿠키·CSRF·Argon2 게이트·차단 목록·로그인
최종 대조·CLI를 재사용한다. 새 repository/mock 계층이나 승인 실행 API는 없다.

## seam과 영향 평가

자동 승인 seam: 제품 화면→authService/공통 mapper→실제 uvicorn HTTP→시험 소유
임시 파일 SQLite/브라우저 쿠키. 보완 seam은 ASGI HTTP→파일 SQLite와 실제 유지관리
CLI→운영 DB/독립 재삭제 원장이다. backend 해싱 지연·write lock 경합은 ASGI/DB
보완 증거이며 실제 브라우저 Set-Cookie 경합으로 계산하지 않는다.

회원/공유 API/새 migration·유지관리와 공통 오류 mapper를 변경하므로 공개 읽기·seed·
기존 mock 인증/관리자와 전체 backend, frontend 단위, 실제 API 전체, 관련 mock
E2E/visual 및 build/dist/reference를 최종 검증한다. 일반 실행 auth_register는 off,
기존 APP_ENV=test prepared factory에서만 on이며 관리자 승인은 계속 off다.
0004는 T03가 이미 적용했으므로 원래 계획 이름의 책임을 0005_member_approval에
추가했다. 적용한 migration은 수정하지 않는다. 회원 ID/앱 소유권/가입일/승인 이력은 유지한다.

## 요구·사례·기대 결과

| 요구 | 실행 증거 | 판정 |
| --- | --- | --- |
| R7 trim/NFC/code point/별명 중복·원 입력 control/bidi 거절 | test_auth_register.py: Hangul 조합/NFC emoji 별명, 동일 정규화 키 중복, 제어/bidi/비가시·길이 경계, 중복 별명 | 합격 |
| 새 암호 15~128·공백/대소문자·고정 목록 | 실제 R15 목록을 외부 다운로드 없이 명시적 사본으로 검증; 가입 후 정확한 원 비밀번호/불일치 로그인, 전체 문자열 차단 | 합격 |
| 선택 수집·확인/권한 입력 거절·부분 회원 없음 | HTTP 비허용 role/approved/password_confirm·선택 nonempty 거절; null/빈 값 수락. API 브라우저 확인 불일치 요청 0, 실제 본문 확인 | 합격 |
| 동시 같은 키 한 건·S 유지·회원 S 없음 | HTTP 동시 201/409 LOGIN_ID_TAKEN·정확히 1 회원·미종결 전환 없음, 브라우저 실제 쿠키 전후 일치와 SQLite 회원 세션 0 | 합격 |
| full 가입 거절·본문/해싱 제한·최종 현재 S | ALREADY_AUTHENTICATED, 413 PAYLOAD_TOO_LARGE, 503 AUTH_BUSY/Retry-After 1, 해싱 중 S 폐기 후 401 AUTH_REQUIRED/회원 없음 | 합격 |
| rolling 100/시간 | BEGIN IMMEDIATE에서 요청 슬롯 먼저 예약; 99건 뒤 동시 요청 정확히 422/429와 코드, 차단 후 100 유지·Origin/CSRF 실패 미집계·창 경계 | 합격 |
| 정확한 비밀번호만 최초 대기·해제 경위·90일 기한 | HTTP/브라우저 wrong/missing INVALID_CREDENTIALS, correct ACCOUNT_NOT_APPROVED. 최초 대기 날짜/90일 안내, 해제 안내에 최초 만료 없음; 만료 도달 후 정리 전 로그인도 INVALID_CREDENTIALS/failed 기록 | 합격 |
| 최초 90일 정리·원 가입일 유지·양방향 승인 경합 | 실제 CLI/파일 DB: 정확한 90일과 1µs 전, 승인 선확정 보존/삭제 선확정 늦은 approval UPDATE 0, 과거 승인 해제 보존 | 합격 |
| R9 내구성·백업 재삭제 | 독립 FULL commit 원장 실패 시 삭제 없음/readiness 503, 운영 삭제 rollback 뒤 intent 재적용, 운영 DB만 백업 복원 뒤 같은 ID 재삭제, 원장 없으면 restore CLI 거절, 앱 ID만 기록 | 합격 |
| 응답 미수령·중복 클릭 | 서버 실제 POST→201 commit 뒤 browser abort. pending DB/회원 세션 0·원 익명 쿠키 유지, 요청 1건, 안내 후 동일 자격증명 로그인 대기 관찰 | 합격 |
| 다섯 viewport·키보드/오류 연결·원본 구분 | 실제 API signup/수집 오류/pending 15 PNG; tab 순서·필수/선택 접근 이름·aria-invalid/describedby·첫 오류 focus. 원본 전체 비교와 product_only 구분 | 합격 |

재삭제의 확정점은 운영 write lock을 잡고 독립 원장의 삭제 intent를 FULL commit한 시점이다.
운영 반영 실패를 성공이라고 표시하지 않고 readiness를 거부하며 재실행은 확정 intent를
반영한다. 뒤늦은 승인으로 삭제를 되돌리지 않는다. 독립 원장에 회원/앱 ID·시각만 보관한다.
운영 DB와 함께 원장까지 되돌리는 복원은 허용하지 않는다. 원장 정리는 전체 사본 목록과
만료 증거 +7일이 필요하다. 운영 증거가 없으므로 삭제 시각만으로 원장을 지우지 않는다.

## 최초 실패→수정→재검증

- 준비한 목록 경로를 빠뜨린 첫 실행은 fixture 설정에서 실패했다. 기존 검증된 R15 사본을
  명시적으로 지정한 다음 미구현 register 503 red를 확인하고 S 유지 가입을 green으로 구현했다.
- 입력 계약 16건 red→정규화/차단/임의 필드·선택 수집 거절 및 카운트 green.
- sweep-pending CLI 미구현 red→원장/최종 원자 재검사/재삭제 green.
- API 어댑터 미구현 red→현재 익명 S 헤더/기존 mapper green.
- 실제 브라우저 중복 아이디가 unknown 안내로 표시됐다. 공통 전송 계층의 LOGIN_ID_TAKEN
  누락을 단위 red로 확인하고 공통 오류 계약에 추가해 필드/409 rejected green.
- 최초 대기 날짜·승인 해제 경위 red→정확한 암호 검증 뒤 별도 안내·90일 경계 green.
- Spec 리뷰가 사전 90일 고지/retryAt 시각/OpenAPI 성공·401 선언 누락을 발견했다.
  단위에서 고지/시각 red→green, 계약·생성 타입 갱신 뒤 check와 재리뷰를 통과했다.
- 초기에 E2E 버튼 이름을 잘못 선택했고 pinned가 아닌 Chromium으로 시작했다. 실제 제품의
  '가입 신청하기' 이름과 Chromium 151.0.7922.34로 교정한 독립 실행만 최종 증거로 계산한다.

## 최종 실행

목록 취득은 시험 실행과 분리했다. 아래 인증 명령에는 명시적으로 준비한
PASSWORD_BLOCKLIST_PATH를 지정했고 browser 검사에는 Chromium 151.0.7922.34 및
FONTCONFIG_FILE을 지정했다. 외부 송신은 기존 loopback-only 브라우저 guard와
backend 네트워크 차단 provisioning 회귀로 확인한다. 로그 전체·원문 DB·암호·쿠키·
CSRF·연락처나 목록 원문/파생 목록은 첨부·커밋·패키징하지 않는다.

| 위치 / 명령 | 실제 결과 |
| --- | --- |
| backend / `APP_ENV=test uv run --frozen pytest` 첫 통합 실행 | 226 passed / 1 failed, 658.33s. 기존 T03-only 시험 capability exact-set 기대를 T04에 맞춰 보정했다. 실패를 숨기지 않으며 아래 마지막 전체 green으로 확인한다 |
| backend / `APP_ENV=test uv run --frozen pytest` 마지막 전체 실행 | **228 passed / 실패·skip 0**, 293.52s. 기존 Starlette 사용 중단 경고 1개 유지 |
| backend / `uv run --frozen pytest tests/contracts/test_auth_register.py tests/test_pending_retention.py -q` | 29 passed, 33.62s; 이후 앱 ID 기록 1건과 change_only 종류 1건 추가를 각각 8/8 및 2/2 대상 검증했다. 마지막 전체에 모두 포함 |
| backend / `uv run --frozen pytest tests/contracts/test_auth_login.py -q -k meta` | 1 passed / 36 deselected, 4.37s; 정확한 허용 집합에 auth_register만 추가, 관리자 capability 차단 유지 |
| backend / `uv run --frozen ruff check .` · `uv run --frozen ruff format --check .` | 통과, 46 files already formatted |
| frontend / `npm run check` | 통과. 기존 healthz/readyz OpenAPI 경고 2개만 유지; 생성 타입 일치 |
| frontend / `npm test` | 최종 **33 files / 832 passed**, 33.74s. 리뷰 전 830 passed 뒤 사전 고지/retryAt red→green을 추가했다 |
| frontend / `npm test -- tests/auth-view.test.jsx tests/api-auth-register.test.ts` | 리뷰 수정 후 **2 files / 11 passed**, 7.16s |
| frontend / `npx playwright test e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js` | **45 passed**, 2.9m; mock 회귀, 실제 인증 증거와 구분 |
| frontend / 인자 없는 `npm run test:e2e:api` | 일반/auth off **50 passed / 29 조건부 제외**, 3.9m; 준비된 실제 기능 **39 passed**, 3.2m; 별도 고정 시계 화면 **10 passed**, 1.5m. off의 제외 사례는 prepared 단계에서 실행 |
| frontend / `npm run test:e2e:api -- auth-register.spec.js` | 최종 독립 재현 기능 **3 passed**, 30.1s + 고정 시계 **5 passed**, 26.1s. 아래 read-only 원장 검사 **15/15 PNG 바이트 일치** |
| frontend / `npm run test:visual -- visual/auth.spec.js visual/admin.spec.js` | **9 passed / 1 timeout**, 6.4m. 390×844 auth가 테스트 전체 60초 제한을 넘었다. 기준 이미지·비교 범위·timeout 변경 없이 아래 같은 case 재실행 |
| frontend / `npm run test:visual -- visual/auth.spec.js --grep 390x844` | **1 passed**, 40.3s. 전체 대상 10개 각각 통과; 첫 timeout 기록 유지 |
| frontend / `npm run build` · `npm run check:dist` · `npm run check:reference` | 최종 통과. API dist 96 files/mock·reference·source map 비포함, 보존본 11개 SHA-256/바이트 일치. 기존 큰 chunk 안내 유지 |
| frontend / `npm run openapi:generate` | register 401/201 메타데이터 설명·헤더 보정과 생성 타입 반영; check에서 일치 |

기존 API runner가 다시 쓴 Phase 2 관찰 PNG 62개는 경로별로 원래 추적 내용에
복원했다. 이 PR은 해당 파일·source reference·baseline을 수정하지 않는다.

## 독립 재현과 시각 경계

signup 정상은 보존본 09-signup과 전체 PNG 치수/픽셀을 비교한다. 기존 UI-D01의 추가
필드/길이 힌트·UI-D04의 데모 표시 제거 때문에 source와 픽셀 일치로 세지 않는다.
수집 비활성 오류와 최초 pending 성공 카드는 대응 원본 frame이 없어 product_only다.
[캡처 목록과 source 비교](captures.json)에서 세 상태와 두 검증 분류를 구분한다. reference/baseline/
mask/tolerance는 변경하지 않는다. Chromium 151.0.7922.34/sRGB/partial-raster off,
DPR1/ko-KR/Asia-Seoul/Pretendard, 서버와 브라우저 2026-10-01T00:00:00Z,
animation off를 고정한다. 독립 DB/서버/browser 두 번 실행의 15 PNG 바이트를 확인한다.

```sh
cd frontend
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/chrome-headless-shell-linux64/chrome-headless-shell
export FONTCONFIG_FILE="$PWD/visual/fontconfig.conf"
npm run test:e2e:api -- auth-register.spec.js
node scripts/check-registration-evidence.mjs
```

`--grep` 없는 runner가 기능 검사 뒤 별도 고정 시계 서버에서 캡처한다. 두 번째 명령은
실제 test-results/api의 15 PNG를 커밋된 visual 파일과 직접 바이트 비교하며 불일치면 실패한다.
현재 UI 소스·시각 baseline·증거를 변경하지 않는 read-only 재현 명령이다.

## 미실행·제외

T05 관리자 승인 API/화면·가입→승인 완주, T06 비공개 보호 요청, T07 전체 지연 쿠키·
실기기/호스트/proxy/운영 백업 사본 만료·원장 정리·사람 시각/보조기술 수락은 본 티켓
합격으로 계산하지 않는다. U01 실제 지원 주소·운영 준비·실기기와 U02 목록 재배포 권리는
T07 공개 gate다. support null을 유지하며 주소/수락을 발명하지 않는다.


## Standards

독립 1차: 문서화된 규칙 위반 0건. 후보/앱 조회의 같은 최초 대기 조건은 possible
Duplicated Code 판단 사항 1건이지만 동일 write lock의 각 대상 조회에 필요하며,
단일 사용 추상화를 추가할 근거가 없으므로 수정 요청으로 세지 않았다.
추가 code/contract/test 재리뷰도 위반 0건. 지적된 기존 Phase 2 PNG 재생성분은 복원했다.

## Spec

독립 1차 지적 3건: 가입 전 90일 자동 삭제 고지, 가입 RATE_LIMITED의 서버 retryAt 시각,
register OpenAPI 201 실제 메타데이터와 401 선언. 모두 반영했다. 최종 재검토는
**잔여 Spec 지적 0건**이며 독립 원장·최종 S/rolling 경계·T05/T07 제외 구분도 확인했다.
최종 합계: Standards 규칙 위반 0 / Spec 미해결 0. 사람 시각 수락/운영 공개는 포함하지 않는다.
