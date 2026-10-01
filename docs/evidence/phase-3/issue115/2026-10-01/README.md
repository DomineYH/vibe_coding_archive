# #115 / Phase 3 / T01 실행 증거

판정 기준: [#115](https://github.com/DomineYH/vibe_coding_archive/issues/115),
[#113 Testing Decisions](https://github.com/DomineYH/vibe_coding_archive/issues/113),
[전환 ADR](../../../../adr/0001-server-auth-transition-boundary.md).
검증 DB는 매 실행 별 임시 파일이며 기존 개발·운영 DB를 변경하지 않는다.
일반 capability는 false다. 합의된 `APP_ENV=test` factory만 준비 capability를
열고 실제 HTTP·파일 SQLite·쿠키·Web Locks·localStorage로 T01을 검증한다.
회원 로그인 성공을 대신하는 스텁은 없다.

| 검증 경계 | 실제 관찰 / 회귀 조건 |
| --- | --- |
| migration | 기존 ID·앱 소유권·원문·Argon2 해시 보존, WAL/FK 확인; 누락 이력·충돌·미분류 해시는 트랜잭션 중단 |
| 익명 준비 | flow ID 저장→R 발급→R 수신 확인→허가 ID 저장→admitted→익명 실행→현재 S/CSRF 재관찰 |
| 전환 | 단일 pending, 재실행 거절, settle/fence, 미수신 결과의 정확한 세대만 폐기, unavailable 비성공 판정 |
| 시간 / 재시작 | 주입 시계로 60초/15분/30분 경계, GET 비연장; 같은 DB 재시작 시 pending 취소·성공/시계 유지 |
| 보안 | Origin 우선·정확한 Referer fallback, 현재 세대 선택/이전 쿠키 거절, 쿠키 개수/크기 예산, 영속 200회/15분 제한, 16KiB 스트림 제한 |
| 복구 | R 유실, ID만 남음, ID 유실/증명 존재, R 발급 직후 유실, 미수신 S, 두 탭, reset 응답 유실 후 원래 대상 목록 유지 |
| 복원 | 실제 CLI로 임시 백업 DB의 S/R/flow 일괄 폐기, 이전 증명 거절; 운영 복원 실행은 주장하지 않음 |
| 공개 독립성 | fresh 공개 목록/상세는 인증 요청 0회; 준비 실패 중에도 공개 읽기 유지 |

red→green: 준비 endpoint 404, 재시작 pending 잔존, 무-S logout 503,
16KiB 초과 422, 물리 삭제 후 늦은 쿠키 미정리, change_only 연락처 일부
노출, 익명 응답 metadata 불일치 수락을 먼저 실패시킨 뒤 해당 구현을 수정했다.
추가로 R과 유효 S 공존 시 무-S 예외로 잘못 204를 반환하는 회귀를 실패시킨 뒤
현재 S를 독립적으로 판정하도록 수정했다. 서버의 허가/증명 응답을 mock하지 않는다.
응답 유실 테스트는 실제 서버 commit 후 전달을 중단한다.

## 최종 검증

환경: Ubuntu/WSL 로컬, Python 3.12, Node 22.23.2/npm 12.0.2, 잠금된 uv/npm 의존성,
Chromium headless shell **151.0.7922.34**, sRGB, partial raster 비활성,
DPR 1, ko-KR, Asia/Seoul, Noto Sans CJK JP fontconfig.
API 캡처는 Date를 2026-10-01T00:00:00Z로 고정하고 네이티브 타이머를
유지하며, 폰트 완료·두 animation frame·animation 비활성 후 촬영한다.
서버 시간 경계는 별도 주입 시계로 검증한다.

| 실행 위치 / 명령 | 결과 |
| --- | --- |
| backend / `APP_ENV=test uv run --frozen pytest` | **111 passed**, 기존 Starlette 경고 1 |
| backend / `uv run --frozen ruff check .` · `ruff format --check .` | 통과, 28 파일 |
| backend / `APP_ENV=test uv run --frozen pytest tests/contracts/test_auth_flow.py tests/test_auth_migrations.py tests/contracts/test_public_meta_health.py -q` | **38 passed**, 기존 Starlette 경고 1 |
| frontend / `npm run check` | 통과; OpenAPI healthz/readyz 기존 4xx 경고 2, 생성 타입 일치 |
| frontend / `npm test` | **31 files / 808 passed** |
| frontend / `npx playwright test e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js e2e/admin-apps.spec.js` | **54 passed** (mock 회귀) |
| frontend / `npm run test:e2e:api` | 일반 경계 **48 passed** + 준비 경계 **17 passed**, 같은 임시 DB·fixture 1회 삽입·서버 재시작 |
| frontend / `npm run test:e2e:api -- auth-prepare.spec.js` | 최종 오류 코드 수정 후 **17 passed** (실제 HTTP·쿠키) |
| frontend / `npm run test:e2e:api -- auth-prepare.spec.js -g 'actual preparation\|storage failure\|unsupported Web Locks'` | **7 passed**, 15개 캡처 확보 |
| frontend / `npx playwright test --config=playwright.visual.config.js visual/auth.spec.js visual/admin.spec.js` | 최종 **10 passed**, 기존 150개 관찰(소스 40 / product_only 110) |
| frontend / `npm run build:mock` · `npm run build` | 통과; 기존 500kB chunk 안내 유지 |
| frontend / `npm run check:dist` | **96 files**, mock/fixture/Tweaks/보존본/source map 제외 |
| frontend / `npm run check:reference` | **11 original files**, SHA-256/byte count 보존 |
| frontend / `npm run openapi:generate` | 명시적 실행; 생성 타입 커밋, 후속 check 일치 |

API·visual 명령은 위 renderer와 `FONTCONFIG_FILE=visual/fontconfig.conf`를
설정해 실행했다(API config는 지정하지 않으면 기존 기본 browser를 사용).
mock 54건은 기존 기능 회귀 config의 bundled Chromium **153.0.8010.12**를 사용했으며
해당 결과를 고정 renderer의 시각 합격으로 계산하지 않는다.
첫 전체 API 실행의 기존 gallery 대량 캡처 1건은 동시 브라우저 실행 중
30초 timeout이었다. timeout을 늘리지 않고 단독 재실행한 최종 48건은 통과했다.
첫 visual 실행의 3건은 다른 Playwright 실행이 공용 output 디렉토리를
지워 trace 파일이 유실된 ENOENT였다. API output을 `test-results/api`로
분리한 뒤 3건 재검사 및 깨끗한 10건 재실행 모두 통과했다.
마지막 계약 설명을 공용 ErrorEnvelope에 넣어 공개 DTO 비교 1건이 실패했다.
설명을 인증 endpoint로 옮기고 해당 비교를 다시 통과시켰다. 검사/assertion은
유지했고 어떤 기준 이미지도 갱신하지 않았다.

## 요구·사례 연결

[실제 HTTP/DB 검사](../../../../../backend/tests/contracts/test_auth_flow.py),
[migration 검사](../../../../../backend/tests/test_auth_migrations.py),
[실제 브라우저 검사](../../../../../frontend/e2e-api/auth-prepare.spec.js)가 실행 경계다.

| 결정 / T01 적용 범위 | 기대 결과와 증거 | 판정 / 후속 책임 |
| --- | --- | --- |
| I01/I03, Q04/Q06/Q07 | members·owner FK 유지, 검증 이력 backfill, 충돌 중단, 실제 UNIQUE/FK/CHECK/partial UNIQUE 검사 | T01 합격; 가입·최초 대기 정리는 T04, 승인 변경 T05 |
| I04/I06/I10 | 익명 15분·GET 비연장·16KiB 이전 차단 | T01 합격; full/change_only·해싱 풀은 T02/T03 |
| I07/I13/I14/I15/I20 | 준비 ID 저장 순서·R ready, Origin/CSRF, 256비트 별도 난수와 DB SHA-256, 이름별 현재 선택·과거 fallback 금지·8개/2KiB·감소 재관측 | T01 합격; 운영 HTTPS 실기기 쿠키는 T07 |
| I09(준비·익명 한도) | 합산 준비 200회·별도 익명 제한, 재시작 유지·rolling deadline/retry_at | T01 적용 합격; 회원 실패/가입 제한·더미 해시 T02/T04 |
| I16/I17/I21/I22, Q08/Q12 | 실제 동시 2개 HTTP 최초 실행 1회, 머신 정수 초과 순번, unknown/settle/fence/discard, unavailable, reset 부분 완료, 만료·정리·재시작·복원 CLI | T01 합격; 해싱/회원 commit 경합 결합 T07 |
| I18/I19, Q09/Q10 | 익명 문맥·오래된 GET 취소/잠금 해제·늦은 관찰 제외, 공개 fresh/focus 0 auth 요청 | T01 준비 범위 합격; 회원 A/B 초안·비공개 권한 T06 |
| I23/I24, Q11 | 기능 차단/저장 실패 안내·공개 유지, 기존 전송 최소 분리, mapper·정본·생성 타입·mock 회귀, 5 viewport | T01 합격; 6개 실제 OS/browser 수락 T07/U01 |
| I02/I05/I08/I11/I12, Q01/Q02/Q03/Q05 | 회원 암호/로그인/가입/CLI 관리자·승인 실행은 활성화하지 않음 | 적용 제외: T02–T05; 관리자 재인증/계정 삭제·초기화는 Phase 5 |

R23 §8의 익명 적용 사례는 최초 준비·중복 접수/동시 실행·응답 불명·미수령 S·
R 유실·ID 유실·ID만 남음·부분 reset·전부 유실·결과 보관 만료·60초/15분/30분·
쿠키 예산/늦은 이름·기능 차단·재시작/복원·무-S logout 비종결을 위 시험에 연결했다.
회원 계정 전환/업무 요청·암호 해싱 중 종료·승인 해제/삭제 경합은 각 후속 T와
T07의 결합 검수 책임으로 남긴다. 기존 mock reset 회귀는 54건에 포함하지만
실제 쿠키 경합 합격으로 세지 않는다.

## 화면·접근성·독립 재현

[캡처 목록](captures.json)의 준비 정상/저장 실패/미지원 **3상태 × 5크기 = 15개**는
`product_only` 관찰이며 새 baseline이 아니다. [독립 실행 비교](capture-reproducibility.json)는
새 임시 DB·새 browser context에서 다시 얻은 15개 모두 **SHA-256 동일**이다.
label→password Tab/focus, 기존 접근 이름, 잘못된 공유 순번 보존은 실제 browser
검사에 포함한다. 기존 auth/admin visual은 기존 오류 연결·가림·확인·복원을 유지한다.

[원본 로그인 직접 비교](source-login-comparison.json)는 보존된 원본 07-login과
전체 PNG 치수·픽셀 차이를 기록한다. UI-D04의 데모 자료 제거와 기존 UI-D03/07
표시 차이 때문에 원본 픽셀 일치라고 주장하지 않는다. EmptyState 실패 화면은
원본 프레임이 없으며 [기존 시각 관찰](legacy-visual-comparison.json) 역시 source
비교와 product_only를 구별한다. 최대 420px 카드·EV·세그먼트·57px 헤더 구조를
유지했고 원본/기존 baseline·mask·0px 기준은 바꾸지 않았다.

## 자기 리뷰

### Standards

문서 규칙 위반 0. 판단 사항 1: 공유 revision 정규식에서 문자열 타입 검사가
누락돼 숫자/배열이 통과했다. 두 저장 경계의 타입 검사 및 원래 값 보존/요청 0건
browser 회귀를 추가해 해소했다.

### Spec

발견 4, 미해결 0: 이전 GET 취소 신호 누락(복구 중 두 번째 CSRF 조회 포함),
비ASCII CSRF 500, fresh 공개 방문 focus 복귀의 로그인 진입 유실, 만료 R의
401 코드 분류. 각각 실제 red→green 및 읽기 전용 재리뷰로 해소했다.
추가 자체 대조에서 JSON/UTF-8·본문 상한 오류 구분과 retry_at도 red→green으로 맞췄다.

## 범위 / 남은 검증

T02–T07 회원 인증·회원 권한·보호 CRUD·운영 승격은 제외한다.
운영 HTTPS `__Host-` 쿠키, 프록시 신뢰 목록, 실기기/화면낭독기와 U01/U02
운영 점검은 후속 승격 조건이며 로컬 결과로 통과 처리하지 않는다.
소스/기존 baseline을 수정하지 않으며 새 실패 화면은 `product_only` 관찰이다.
원본 응답·쿠키 값·CSRF·DB·trace는 증거 파일에 저장하지 않는다.
