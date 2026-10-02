# #119 / Phase 3 T05 관리자 승인·승인 해제 검수 원장

기준: #119 수용 기준, #113 Testing Decisions의 자동 승인 seam/T05 검증 계약,
R7/R23 인증 경계, R24 승인 경합, R9 최초 승인 대기 정리.
T01 #122·T02 #123·T03 #124·T04 #125 병합 diff를 먼저 대조했다.
원천 계획/ADR/CONTEXT의 회원·승인 이력·승인 해제·아카이브 앱·연결 결과 용어를 사용한다.

## 환경과 재현

시험 소유 `/tmp` 파일 SQLite만 사용한다. Python 3.12.3, 고정 uv/npm lockfile,
Chromium headless-shell **151.0.7922.34**, DPR 1, ko-KR, Asia/Seoul, Pretendard,
reduced motion, animation disabled, srgb/disable-partial-raster를 사용한다.
API E2E runner는 migration·실제 TTY bootstrap·합성 fixture를 한 번 주입하고 서버를
시작/종료한다. 기능 검사에는 이동 시계, 카드 캡처에는 서버/브라우저
2026-10-01T00:00:00Z를 사용한다. 두 단계 사이에 같은 DB를 유지하며 재시작 시
fixture를 재주입하지 않는다. 독립 재실행은 새 임시 DB에서 이 순서 전체를 반복한다.

```sh
# 준비된 R15 원본을 private 경로에서 사용한다. 검사 중 다운로드하지 않는다.
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/chrome-headless-shell

(cd backend && APP_ENV=test uv run --frozen pytest tests/contracts/test_admin_approval.py tests/test_approval_races.py)
npm --prefix frontend run test:e2e:api -- admin-approval.spec.js auth-lifecycle.spec.js
# 위 전체 명령을 다시 실행한 결과와 커밋된 PNG를 바이트 단위로 비교한다.
node frontend/scripts/check-approval-evidence.mjs
```

마지막 명령은 기준 이미지·보존본·증거 PNG를 갱신하지 않는다. `captures.json`의
15개 SHA-256/크기와 독립 재실행의 일치를 검사한다. 카드만 선택하는 `--grep` 명령은
기능 검사 후의 DB를 재현하지 않으므로 이 원장의 재현 명령으로 사용하지 않는다.
브라우저의 외부 사이트 송신은 차단하며 연결 검사/다운로드는 테스트 동작이 아니다.

## 요구·사례와 관찰 경계

| 요구·사례 | 기대 결과 / 실제 증거·명령 | 판정 |
| --- | --- | --- |
| US-26 / 목록·상세·추가 페이지·통계 / UI-D09 | 계약 `test_admin_reads_current_members_and_full_statistics_without_contact`, `test_healthy_apps_counts_only_fresh_healthy_results`와 API E2E `real paging and aggregate stats`: 실제 회원 수, 연락처 없는 허용 DTO, 페이지 24개+추가 페이지, 미검사 healthy 0 및 fresh healthy/stale healthy/http_error/unchecked 혼합에서 healthy 1·다음 만료 시각. 오류 UI는 합성 503으로 구분하고 명시 retry를 검증한다. 새 summary endpoint 없음. | 합격 |
| US-32 / full 관리자 권한 / R24 사례21·28 | 계약 `test_admin_authority_and_key_ownership_are_checked_on_every_endpoint`: 일반 회원 403, change_only 403, R 단독 401, 타 관리자 키와 없는 키 동일 404. 관리자 대상 403. Origin/CSRF·흐름/순번/세대/미종결 전환은 기존 인증 경계를 적용한다. | 합격 |
| US-27·30 / R24 사례1·4·5·9 / 별도 업무 키 | `test_approval_key_commits_history_version_audit_and_result_once`, `test_key_mismatch_version_conflict_and_strict_wire_input`: 승인/이력/버전/감사/결과 원자 commit, 같은 값의 새 키도 버전 증가, 입력 불일치 유지, 확정 키 재실행 409 후 GET. `test_simultaneous_approval_serializes_business_and_terminal_results`: 같은 키·다른 키의 동시 200/409뿐 아니라 error code·succeeded/rejected 결과·버전·성공 감사 1회 및 다른 키의 거절 감사 1회 단언. | 합격 |
| US-28 / 승인 해제·재승인 / R24 사례8·12 | `test_revocation_permanently_revokes_all_old_sessions_and_preserves_public_apps`: 두 프로필의 모든 옛 S 직접 me 401, 재승인 후도 401·승인 이력·대상 회원 소유 앱의 익명 목록/상세 보존. `auth-lifecycle.spec.js`는 두 번째 로그인 직후 활성 S를 캡처하고 DB에서 승인 해제 전 미폐기→해제/재승인 후 폐기를 확인하며 해당 쿠키를 재주입한다. `test_revocation_during_login_verification_fails_terminally`: 해싱 중 해제 뒤 늦은 로그인 409 AUTH_STATE_CHANGED, failed/failure_code·유효 세션 0. | 합격 |
| US-31·52~55 / 응답 유실 / R24 사례13·15·16 | 실제 Node HTTP 전달→서버 200 commit/파일 DB succeeded→브라우저 응답 abort. 화면 unknown/자동 재실행 0회/호출자 쿠키 불변→원래 키 조회로 성공 확인. 성공 후 cancel은 succeeded 유지. 전달 전 abort 시험은 별도로 unresolved→명시 cancel/rejected·OPERATION_CANCELLED·업무 미반영을 단언한다. | 합격 |
| 취소 대 성공 양방향 경합 / R24 사례15 | `test_cancel_and_success_both_commit_orders`: 실제 HTTP/파일 DB write lock을 event로 유지해 두 commit 순서를 보장한다. 취소 먼저면 409 OPERATION_ALREADY_RESOLVED/rejected, 성공 먼저면 cancel 200/succeeded. 단순 상태코드만 검사하지 않는다. | 합격 |
| 원자성·실패 경로 / R24 사례19 | 감사 INSERT·결과 UPDATE의 DB trigger 실패는 503 SERVICE_UNAVAILABLE, 원래 unresolved·미변경 승인/이력/버전. 승인 해제 감사 실패 때 기존 S도 그대로 유효하다. 회원 버전 상한은 순환하지 않고 503으로 업무를 차단한다. | 합격 |
| 키 24시간 / 최종 commit / 만료 정리 / R24 사례18·20 | `test_operation_exact_expiry_and_bounded_cleanup`: 발급부터 24h−1µs GET 200, 경계 GET/PATCH/cancel 410, 만료 후 59분 이내 기존 sweep으로 제거. `test_key_expiry_is_rechecked_immediately_before_business_update`: lock 안 대상 조회 지연 중 경계 도달 시 업무 미반영/unresolved. 정상 restart는 결과/미확정 키 보존, 복원 무효화는 과거 키 제거. | 합격 |
| 최초 승인 대 90일 삭제 / R24 사례25·26 / T04 재사용 | `test_actual_approval_and_initial_pending_deletion_do_not_resurrect`: 실제 관리자 승인과 기존 sweep_pending의 write lock 양방향. 승인 먼저면 보존/succeeded, 삭제 먼저면 USER_NOT_FOUND/rejected·재생성 없음. 기존 독립 원장·현재 자격 재확인·intent 취소 규칙은 재구현하지 않는다. | 합격 |
| 대상 삭제 후 결과/감사 보존 / R24 사례14·26 | `test_restart_preserves_keys_and_target_deletion_does_not_erase_success`: target 삭제 뒤도 다른 관리자의 succeeded/감사 유지, 원래 키 재실행 409, 미확정 키는 USER_NOT_FOUND로 종결. target FK/CASCADE 추가 없음. | 합격 |
| 가입→대기→승인→로그인→새로고침→로그아웃 / US-13~19·26~32 | `auth-lifecycle.spec.js`: 실제 가입 카드·full 관리자 승인·브라우저 cookie 유지/폐기·HTTP·파일 DB 상태. 승인 해제/재승인 후 옛 쿠키를 다시 넣어도 개인 헤더가 열리지 않고 공개 아카이브 앱 유지. | 합격 |
| 묶음 capability / 후속 범위 | 두 API E2E spec의 gate 검사: prepared test boundary에서 가입/관리자 읽기/승인/통계 함께 true. 일반 실행 false. 비밀번호 초기화·삭제·재인증·아카이브 앱 관리/CUD는 false. | 합격 |
| UI-D09 / 5 viewport / 접근성 | `administrator approval cards`의 인라인 확인/unknown/취소 15개 product-only 관찰, keyboard Enter·focus·region 접근 이름·가로 overflow 검사. 기존 mock admin/auth source 비교는 별도 `legacy-visual-comparison.json`. 보존본 및 기존 baseline 수정 없음. | 합격 |
| U01/U02·T07 실제 공개·사람 수락 | 필수 실기기·호스트/proxy/HTTP2·운영 검수·차단 목록 재배포 권리·사람의 제품 화면 수락은 이 티켓의 로컬 검사로 대체하지 않는다. | 미실행 / T07 공개 차단 |
| Phase 5 관리자 초기화/삭제/재인증, Phase 4~5 아카이브 앱 CUD·관리, T06 비공개 상세 격리, T07 전체 쿠키 경합 | 비활성/후속 책임. 실제 실행 기능을 구현·합격으로 세지 않는다. 기존 mock 사례는 회귀 자산이지 실제 API 증거가 아니다. | 적용 제외 |

## 최초 실패 → 원인 → 수정 → 재검증

1. 관리자 목록/업무 키/취소 HTTP가 없는 404에서 각 슬라이스 red를 확인한 뒤
   기존 인증 경계와 T04 schema를 사용해 green으로 만들었다.
2. 엄격한 승인 입력 검사는 FastAPI 기본 `detail` 응답을 발견했다. 관리자/업무 키
   validation을 공통 ServiceError로 맞추고 잘못된 버전/중복 JSON·헤더를 재검증했다.
3. 만료 후 키가 남아 cleanup 시험이 실패했다. 기존 60초 sweep에 업무 키 정리를
   연결했다. 대상 조회 지연 중 만료 시험도 최초에 성공 commit을 허용해 실패했고,
   최종 업무 변경 전/commit 직전 기한·현재 관리자 검사를 보강해 통과했다.
4. CSRF 관찰과 승인 응답의 인증 revision 불일치가 단위 시험에서 red였다.
   같은 요청 context 일치와 실제 응답 metadata 검증을 추가했다. 잘못된 성공 응답은
   unknown을 유지한다. 확정 키의 과거 결과를 현재 boolean으로 추측하지 않는다.
5. API E2E 최초 실행에서 추가 페이지 완료를 기다리지 않은 assertion과 Origin 없는
   시험 취소 요청이 실패했다. 완료 관찰과 실제 Origin을 넣었다. 로그아웃 진행 중
   바로 이동하던 시험도 공개 로그인 버튼이 다시 나타날 때까지 관찰하도록 고쳤다.
6. 승인 성공 후 대상이 다음 페이지로 옮겨지는 실제 화면 실패를 확인했다. 같은
   선택 결과 패널을 목록 위에도 유지하여 결과를 잃지 않게 했다. 실제 가입 완주로
   재검증했다. timeout/assertion/기준 이미지·허용 오차를 줄여 통과시키지 않았다.
7. 초기 visual 명령은 pinned renderer 환경변수 누락으로 기동 전에 실패했다.
   설치된 151.0.7922.34 실행 경로를 지정했다. 초기 일반 Chromium 153 캡처는
   증거로 채택하지 않고 pinned renderer에서 별도 캡처/독립 재실행했다.
8. 전체 pytest 최초 실행은 기존 T04 capability 기대값 1개가 T05 묶음을 포함하지
   않아 253 통과/1 실패였다. 기대값을 명시된 T05 묶음으로 갱신했다. 테스트를
   skip하거나 인증 기능을 다시 끄지 않았다.
9. 독립 Spec 리뷰에서 확정 거절/발급/취소의 최종 관리자·키 검사 누락과 관리자
   본문 크기 상한 누락을 발견했다. stale target 조회 중 키 만료와 세 경로의
   마지막 쓰기 중 관리자 만료, 미인증 초과/분할 본문을 각각 red로 재현했다.
   기존 관리자 검사와 16KiB middleware를 재사용해 수정했다. 영향 계약/경합
   26개가 green이며 권한 만료 시 키/감사 rollback과 unresolved를 단언한다.

## PR #126 독립 리뷰 r1 반영

APPROVE / minor 5건을 아래처럼 반영했다. 테스트 경계는 #113 Testing Decisions의
기존 실제 HTTP·파일 SQLite·브라우저 쿠키이며 외부 사이트 송신은 하지 않는다.

| 지적 | 최초 실패 → 수정 → 재검증 |
| --- | --- |
| offset 상한 | `test_admin_list_offset_bounds_return_defined_validation_errors`가 2^53 입력의 200에서 실패. 서버 Query와 OpenAPI의 관리자 offset 상한을 9007199254740991로 일치시켰다. 음수/상한 초과/2^63/10^30은 422 VALIDATION_ERROR, 상한 자체는 200 빈 페이지를 검사한다. |
| 재승인 시 옛 S 미복구 | 기존 캡처를 유지한 채 승인 해제 직전 `revoked_at IS NOT NULL == 0`을 추가하니 이미 로그아웃한 S라 1로 실패. 두 번째 로그인 직후로 캡처를 옮겼다. 실제 쿠키 재주입·개인 헤더 제한과 해당 full session 행의 해제 전 0→해제/재승인 후 1을 함께 검사한다. |
| healthy 집계의 비영(非零) 값 | 새 계약 검사에서 freshness 조건과 healthy 조건을 각각 제거한 임시 변이가 모두 2 != 1로 실패했다. 구현 조건은 올바르므로 유지했다. 계약/브라우저 API 검사에 fresh healthy·stale healthy·http_error·unchecked 혼합과 healthy 1/next_health_expiry_at을 추가했다. 브라우저 합성 연결 결과는 finally에서 원복한다. |
| 거절된 승인 감사 | 대상 삭제/버전 충돌 후 감사가 빈 배열이라 실패. #113 audit_logs의 행위/대상/시각/결과와 R24 §5의 적법한 일치 요청의 대상 삭제·관리자 보호·버전 충돌 확정 거절 및 §4의 감사 별도 보관을 적용했다. 해당 확정 거절에만 같은 트랜잭션으로 최소 user_approval/rejected를 기록한다. 권한/CSRF/만료/포화·불일치 요청이나 확정 키 재실행은 새 감사 대상으로 확대하지 않았다. 중복 0회, 감사 실패 503/unresolved rollback, 키 sweep 뒤 감사 보존, 경합의 성공/거절 감사 개수를 검사한다. |
| 대상 소유 공개 앱 보존 | 기존 fixture의 소유자가 대상 회원과 달라 계약/브라우저 소유권 단언이 실패. 시험 소유 공개 앱을 대상 회원에게 배정한 뒤 해제와 재승인 각각에서 익명 목록의 ID/소유자 및 상세 item 전체 보존을 검사한다. |

공개 상세의 최초 시험 작성은 item 봉투를 빠뜨려 KeyError/TypeError로 실패했다.
DTO 관찰을 item으로 고친 뒤 실제 소유권 불일치의 red를 확인했다.
대상/키·관리자 최종 검사와 기존 BEGIN IMMEDIATE 경합 경계를 유지한다. 회원 완주
시나리오는 추가 HTTP/DB 관찰 때문에 기존 30초 총 한도에 도달해 이 테스트의 총
한도만 60초로 조정했다. 개별 expect 대기·retries·시각 허용 오차는 변경하지 않았다.
재부팅 뒤 사라진 pinned renderer는 테스트 전 별도로 준비했고 R15는 기존 private
준비 파일을 사용했다. 테스트 중 다운로드하지 않는다.

### r1 반영 후 검사

아래는 이번 변경에서 다시 실행한 결과다. 초기 구현의 추가 검사 결과는 뒤의
d49536e 표에 구분해 보존한다. CI 결과는 push 후 PR에 별도로 기록한다.

| 명령 | 결과 |
| --- | --- |
| `cd backend && APP_ENV=test uv run --frozen pytest tests/contracts/test_admin_approval.py tests/test_approval_races.py -q` | 30개 통과 / 71.35초 |
| `cd backend && APP_ENV=test uv run --frozen pytest -q` | 전체 264개 통과 / 801.09초 / 기존 Starlette deprecation 경고 1개 |
| `cd backend && uv run --frozen ruff check .` / `uv run --frozen ruff format --check .` | 통과 / 50개 파일 포맷 통과 |
| `npm --prefix frontend run check` / `npm --prefix frontend test` | 통과 / 33개 파일·846개 통과 |
| `npm --prefix frontend run test:e2e -- e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js` | 영향 mock E2E 45개 통과 |
| `npm --prefix frontend run test:e2e:api -- admin-approval.spec.js auth-lifecycle.spec.js` | 기능 6개 + 캡처 5개 통과 |
| `node frontend/scripts/check-approval-evidence.mjs` | 위 재현 결과와 커밋된 PNG 15장 byte-for-byte 일치·captures.json 전체 일치 |
| `npm --prefix frontend run test:e2e:api` (인자 없음) | 일반 52개 통과/기존 gate 29개 skip + prepared 45개 통과 + 캡처 15개 통과 = 112개 통과/29개 skip |

OpenAPI 생성도 다시 실행했고 생성 타입의 변경은 없었다. API E2E가 바꾼 무관한
Phase 2 증거 PNG는 원복했다. 이번에 새 증거 PNG나 시각 baseline을 갱신하지 않았다.

## Standards

독립 Standards 리뷰: 문서화된 기준 위반 0개, 실행할 코드 냄새 지적 0개.
승인 모듈은 목록·승인 업무의 공통 경계를 갖고 기존 인증·유지보수 구현을
재사용한다. 300줄은 검토 신호로 취급했고 관련 없는 분할·리팩터링은 하지 않았다.

## Spec

독립 Spec 리뷰: 최종 권한/키 검사와 본문 상한 누락 2개를 발견했다. 위 9번의
red→green 및 수정분 재리뷰로 두 지적 모두 해소했다. 범위 초과와 남은 지적 없음.

최종 지적 수: Standards 0개 / Spec 0개(발견한 P2 2개 수정 완료).

## 초기 구현 검사 (d49536e)

명령은 저장소 루트에서 실행한다. 위 환경변수는 backend/API E2E에도 적용한다.

| 명령 | 최종 실제 결과 |
| --- | --- |
| `cd backend && APP_ENV=test uv run pytest` | 260개 통과 / 506.22초 / 기존 Starlette deprecation 경고 1개 |
| `cd backend && uv run ruff check .` / `uv run ruff format --check .` | 통과 / 50개 파일 포맷 통과 |
| `npm --prefix frontend run check` | 생성 타입 일치·tsc·ESLint·Prettier 통과 |
| `npm --prefix frontend test` | 33개 파일 / 846개 통과 |
| `cd frontend && npm run test:e2e -- e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js` | 영향 mock 인증/관리자 45개 통과 |
| `npm --prefix frontend run test:e2e:api` (인자 없음) | 일반 실행 52개 통과 / prepared capability 대상 기존 gate 29개 skip; prepared 실제 인증 45개 통과; 고정 시계 캡처 15개 통과. 합계 112개 통과 / 기존 gate 29개 skip |
| `cd frontend && npm run test:visual -- visual/auth.spec.js visual/admin.spec.js` | pinned renderer 10개 통과 / 기준 이미지 갱신 0개 |
| `npm --prefix frontend run build` / `run check:dist` / `run check:reference` | 통과 / API dist 96개 파일에서 mock·참조·source map 없음 / 원본·보존본 11개 SHA-256·바이트 일치 |
| `npm --prefix frontend run openapi:generate` | 성공 / 생성 타입 커밋 / 기존 healthz·readyz 4XX 미지정 경고 2개 유지 |
| 위 두 API spec 재현 명령 / `node frontend/scripts/check-approval-evidence.mjs` | 최종 수정 후 새 임시 DB에서 기능 6개 + 캡처 5개 통과. 커밋된 확인/unknown/취소 15장과 byte-for-byte 일치; 두 JSON 원장의 SHA-256·크기도 `cmp` 일치. 서로 독립된 3회 실행에서 동일 결과 |

전체 API E2E가 기존 Phase 2 증거 경로에 출력한 PNG는 종료 후 원복했다. 과거 증거와
baseline을 stage하지 않았다. 새 테스트 skip, assertion 약화, 시각 허용 오차 변경 없음.
PR 생성 후 현재 workflow가 실행한다. 로컬 결과와 CI 결과를 혼동하지 않는다.

원문 DB·비밀번호·CSRF·세션/복구 쿠키·연락처·해시는 첨부하지 않는다.
로컬 구현 완료, 자동 검사, 사람의 시각 수락과 실제 인증 공개 승인을 구분한다.
