# #120 / Phase 3 T06 비공개 상세·보호 화면 격리 검수 원장

정본은 [#120](https://github.com/DomineYH/vibe_coding_archive/issues/120)의 AC 1–10,
[#113](https://github.com/DomineYH/vibe_coding_archive/issues/113)의 T06 및 공통 검증 계약,
인증 전환 ADR, R7/R23/R24다. 기준 구현은 T05 `c80d24a`다.
아래 PASS는 로컬 자동 검증이며 사람의 시각 수락·운영 인증 공개 승인이 아니다.
T07 전체 쿠키 경합과 U01/U02 공개 gate는 이 작업의 합격으로 대체하지 않는다.

## 환경과 독립 재현

Python 3.12.3, uv 0.11.28, 기존 frozen lockfile과 준비된 R15 원본을 사용했다.
실행 Node 24.21.0/npm 12.2.0은 저장소 지정 22.23.2/12.0.2와 다르다.
패키지·차단 목록·브라우저를 다운로드하지 않았다. 사용자 설치 후 pinned Chromium
headless-shell 151.0.7922.34가 기동했다. DrvFS 의존성 import 지연을 피하려고
기존 설치를 Linux cache에 복사해 단위 검사에 사용했다. 폰트가 기존 Vite 허용
경로 밖으로 벗어나지 않도록 브라우저 검사에는 원래 frontend 의존성을 사용했다.
검사 deadline, skip, retry, baseline, tolerance는 변경하지 않았다.

브라우저 조건: DPR 1, ko-KR, Asia/Seoul, Pretendard Variable, reduced motion,
light, srgb/disable-partial-raster, animation disabled, 외부 송신 차단.
기능 검사에는 이동 시계, 캡처에는 서버와 브라우저 모두
`2026-10-01T00:00:00Z`를 사용했다. 시험 소유 임시 파일 SQLite에 migration,
실제 CLI bootstrap, 합성 회원/앱 fixture를 한 번만 넣는다. 기능→고정 시계 서버
재시작 사이에는 같은 DB를 유지하고 fixture를 재주입하지 않는다. 독립 실행은
새 임시 DB에서 전체 순서를 반복한다. 시험 종료 시 임시 DB를 제거한다.

```sh
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/chrome-headless-shell
npm --prefix frontend run test:e2e:api -- auth-access.spec.js
# 새 임시 DB로 위 전체 명령을 다시 실행한 뒤, 읽기 전용 비교:
node frontend/scripts/check-access-evidence.mjs
```

최종 첫 독립 실행은 기능 6 PASS / 1.2m, 캡처 5 PASS / 1.1m였다.
두 번째는 기능 6 PASS / 58.2s, 캡처 5 PASS / 1.0m였다.
[captures.json](captures.json)의 35 PNG와 두 번째 실행을
[capture-reproducibility.json](capture-reproducibility.json)에서 바이트/SHA-256/
크기로 비교했다. 35/35 동일, pixelTolerance 0, baselineUpdated false다.
모든 신규 상태는 `product_only`다. full-page 높이는 viewport보다 클 수 있다.
기존 source 비교는 별도 legacy 기록에 남기며 신규 기준 이미지로 승인하지 않는다.
기본 API 전체 통합 이후의 T06 35개도 같은 읽기 전용 검사에서 모두 동일했다.

## 명령과 증거 경계

| ID | 실행 명령 / 증거 위치 | 경계 |
| --- | --- | --- |
| B1 | `(cd backend && APP_ENV=test uv run --frozen pytest tests/contracts/test_auth_access.py tests/contracts/test_public_apps.py -q)` | 실제 loopback socket HTTP, httpx cookie jar, migrated 임시 파일 SQLite. 최초 묶음 55 PASS / 676.69s, 이후 추가 expiry/race 6 PASS / 69.61s. |
| B2 | `(cd backend && APP_ENV=test uv run --frozen pytest tests/contracts/test_auth_access.py -k 'terminal_transition or adopt_current' -q)` | 완료된 failed/cancelled와 실제 A→logout→B 뒤 옛 문맥 3 PASS, 29 deselected / 12.94s. |
| U1 | `npm --prefix frontend run test -- tests/auth-state.test.ts tests/api-auth-access.test.ts tests/api-apps.test.ts tests/api-app-write.test.ts tests/admin-api.test.ts tests/openapi-contract.test.js` | 순수 관찰/전송 계약 98 PASS / 6.25s. 응답은 단위 fixture이며 실제 인증 증거로 세지 않는다. |
| U2 | `npm --prefix frontend run test -- tests/auth-continuity.test.jsx`; `npm --prefix frontend test` | 최종 continuity 8 PASS / 3.82s. 전체 frontend는 auth-isolation/auth-route/auth-view를 포함해 DOM, cache, return_to와 target 재검증을 검사한다. 별도 API 증거는 E1이다. |
| E1 | `npm --prefix frontend run test:e2e:api -- auth-access.spec.js` | 실제 서버·동일 browser context의 두 tab·발급 쿠키·SQL 상태·기존 제품 DOM; 두 번의 전체 독립 실행 위에 기록. |
| E2 | `npm --prefix frontend run test:e2e:api -- auth-access.spec.js apps.spec.js detail.spec.js meta.spec.js` | 마지막 S/flow/R 보완 이후의 정확한 구현: 기능 16 PASS (1.9m), 캡처 5 PASS (1.0m), wall 186.10s. 최종 35 PNG도 V1의 독립 두 실행과 byte-identical. |
| V1 | `node frontend/scripts/check-access-evidence.mjs` | 5 viewport × 7 상태의 읽기 전용 독립 PNG 비교 35 PASS. |
| V2 | `npm --prefix frontend run test:visual -- visual/auth.spec.js visual/admin.spec.js` | 기존 mock auth/admin의 source/product 비교. 실제 API 인증 합격과 분리. 최종 결과는 아래 통합 표와 legacy JSON. |
| M1 | `npm --prefix frontend run test:e2e -- --config=playwright.local-mock-120.config.js e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js e2e/app-create.spec.js e2e/app-edit.spec.js` | 기본 mock config를 상속하고 설치 executable/outputDir만 지정한 임시 config. 74 PASS, 실제 API 성공으로 세지 않음. |

쿠키·CSRF·비밀번호는 시험 프로세스 메모리에서만 사용한다. 증거에는 값이나 원문
DB를 남기지 않는다. 합성 A/B 내부 ID와 별명, 상태, 개수만 관찰한다. 늦은 성공
시험은 `route.fetch()`로 실제 backend 200을 받은 뒤 전달을 지연한다. 네트워크
abort는 실패 UI용 fault injection이며 성공한 인증/Set-Cookie 경합 증거가 아니다.

## AC별 요구 → 사례 → 기대 → 관찰 → 판정

| AC / 스토리 | 사례와 기대 결과 | HTTP / DB / cookie / 화면 증거·명령 | 판정 |
| --- | --- | --- | --- |
| 1 / US-33–35 | 현재 approved full A의 소유 상세와 full admin만 private 200. 익명/B/change_only 및 revoked/expired는 없는 UUID와 같은 404. 역할 주장·cookie만으로 허용하지 않음. | B1 `test_private_detail_permission_matrix_and_identical_missing`, exact-expiry, revoke 양방향; E1 permission matrix와 old-S 재주입. private 200의 owner DTO는 id/nickname만. change_only 소유자도 404. | PASS |
| 2 / US-01·15·29·35 | 목록/검색/total/facets는 공개 집합, headerless는 cookie 유무와 무관하게 익명. partial/empty/noncanonical context는 422. 비공개 존재/로그인 ID/연락처/자격증명 미노출. | B1 permission/header matrix + 기존 public contracts; E1 private 검색 items=[]/total=0, headerless private 404, owner allowlist. /meta·/apps·private/missing 16개의 malformed 조합 검사. | PASS |
| 3 / US-38 / I18 | 요청의 flow/revision/generation/pending을 동일 BEGIN IMMEDIATE에서 검사. 새 B cookie가 옛 A 요청을 승인하지 않음. late response metadata와 tab observation 비교, replay 0. | B1 stale/pending은 public/private/missing 모두 409; read/revoke 양방향 commit lock; B2 failed/cancelled 같은 S도 옛 revision 409, A context+B cookie 409. U1 invalid metadata CONTRACT_ERROR, late success/error AbortError. E1 실제 backend 200 지연 뒤 A→logout→B 화면/저장소에 A body 없음. | PASS |
| 4 / US-36–37·53 | blur/hide/notification 즉시 보호 본문·nickname/header·제어를 DOM/a11y/keyboard에서 제외. 알림 없이 focus/history/pageshow도 재확인. 실패는 가림+공개 열람+명시 retry. | U2 auth-isolation late completion, DOM absence; E1 focus/blur, clipboard button에서 Tab 이동, 링크/heading 제거, 실제 flow-state 재확인·fault abort 실패·pageshow/POP 복원. V1 concealed/checking/error의 15 PNG. | PASS |
| 5 / US-19·39 | 공개/회원 cache를 mode·ID·role·kind·flow·session/observation generation으로 분리. browser persistent protected body 없음. ordinary revision만 바뀌면 같은 identity-history의 draft/pending intent 복원. A→logout→A/A→B→A, 권한/target 상실은 폐기. | U1 auth-state scope/currentness; U2 new/edit draft, pending admin intent, identity history, target loss/regain, fresh pending target deletion. E1 actual recovery-cookie rotation: revision 변경/identity revision 동일, confirmation 복원·write count 불변; logout→동일 admin은 폐기. local/sessionStorage private sentinel 없음. | PASS |
| 6 / US-01–02·37 | 엄격한 return_to parser 유지, fresh meta/capability/대상 권한 재검사. false/meta failure/denied를 허용으로 해석하지 않음. public detail은 failed/stale auth와 독립, 새 public visitor auth 요청 0. | U2 route/view parser와 current-meta return cases; 공개 detail은 독립 headerless probe 후 표시, private는 captured proof로만 조회. E1 public visitor 요청 감시 authCalls=[]; private/missing 동일 화면. 기존 mock auth e2e: non-admin 로그인 성공 후 return_to=/admin 거절은 login URL 유지+alert (이전 /admin 403 도착 assertion 변경). #113 T06은 복귀 전 권한 확인을 요구하고 승인 계획 §2는 실패 시 기존 safe error/recheck 경로 유지를 명시한다. 인증된 header의 gallery/logout 이용 가능; 로그인 재제출은 ALREADY_AUTHENTICATED이며 이를 새 로그인으로 처리하지 않음. | PASS |
| 7 / US-28–29·33–39·54 | 실제 A/B/admin/change_only 행렬, 다중 tab·refresh/history·hide/restore, revoke→reapprove old S 거부. archive CUD/admin archive list는 열리지 않음. | E1 여섯 기능 여정, B1/B2. 실제 관리자 발급 operation key+approval HTTP 두 번, DB full active S=0, 이전 cookie/context private 404·새 login만 200, public items 동일. CUD POST/PATCH/DELETE 405, admin/apps GET 404, 관련 caps false. | PASS |
| 8 / US-54 / I24·Q06–12 | 실제 HTTP/임시 SQLite/cookie/제품을 연결, shared schema/transport/state 영향 평가 후 public/seed/admin/auth 회귀. API 실패→mock fallback 없음. | backend full, frontend full, 기본 API runner 두 boundary, mock auth/admin 및 draft/write-outcome, check/build/dist/reference. mock admin_users_read/admin_approval false→true는 이미 구현된 mock user/approval 서비스를 현재 capability gating에서 계속 접근시키는 선언 수정. API archive 기능 cap false 유지. schema migration/member model/lockfile 변경 없음; OpenAPI 타입은 명시 generator로만 생성. CI는 coordinator 책임으로 아래 NOT RUN. | r1 frontend/browser PASS; backend full 1 FAIL → seed 8 PASS / CI NOT RUN |
| 9 / US-53·55 / UI-D02·03·07·09 | 기존 EV/card/header 구조 유지, 5 viewport 고정 조건, 독립 source/product 비교. 숨긴 private body 접근 불가; focus/label/error/이름 유지. | V1 35/35 byte-identical; E1 keyboard/accessibility DOM assertions, 기존 auth/admin visual V2 및 legacy JSON. [UI 차이 기록](../../../../ui-deviations.md)의 T06 설명. 사람·screen reader·실기기 acceptance 별도. | AUTOMATED PASS / historical T05 원인 BLOCKED / HUMAN NOT RUN |
| 10 / US-55 | 모든 AC의 사례/기대/명령/관찰/판정 및 first failure→fix→retest 기록. 비밀/원문 DB 없음, 자동 baseline/type/lock 갱신 없음. | 본 원장, captures/reproducibility/legacy JSON, test source, 아래 TDD·통합·유예 표. V1은 읽기만 한다. 기존 검사 생성 PNG는 보존본을 변경하지 않고 원복한다. | PASS |

## 결정·원천 사례의 적용 범위

| 요구 | T06 기대 / 연결 증거 | 판정·후속 책임 |
| --- | --- | --- |
| I01 / Q06–07 | 내부 ID·별명 분리, 기존 members/FK/seed 소유권 유지. B1 DTO, public/seed 회귀, E1 A/B 소유권. | PASS; 새 model/migration 없음. |
| I02–03 / Q01·04–05 | 비밀번호/등록·최초 pending·연락처 정책 재선택 없음. 기존 전체 backend 및 auth-register/lifecycle 회귀. | REGRESSION PASS; T03/T04 정본 유지. |
| I04–06 / R7 Q7·9·22·23 | full idle 30분/absolute 8시간, approved ordinary screen activity만 갱신. S만 absolute cap; flow/live R은 별도 30분 inactivity, revision 불변, expired R/S 복구 금지. denied/me/headerless 비활동. revoke→reapprove 모든 옛 S 불가·public 보존. | B1 activity/expiry/cap/commit-order + E1 revoke PASS. change_only/anonymous activity 확대 없음. |
| I07–12 / Q02–03 | 기존 CSRF/Origin, 로그인 예외, rate/resource cap, bootstrap/change_only, 승인 권한 유지. E1 실제 operation key/Origin·full admin, backend 및 승인/lifecycle 회귀. | REGRESSION PASS; reset/delete/reauth execution은 Phase 5 제외. |
| I13–17 | 기존 발급별 S/R와 prepare/transition/settle/recovery 흐름 유지. E1 shared cookie switch, actual recovery rotation 및 기존 auth 회귀. | T06 사용 경로 PASS; exhaustive late Set-Cookie·loss/settle branches는 T07. |
| I18–19 / R23 §4·부록 B·§8 | atomic originating context, no replay, hidden before reproof, identity-change continuity. B1/B2/U1/U2/E1. | PASS for T06; §8의 모든 cookie/header/body loss 지점은 T07 NOT RUN. |
| I20–22 | cookie budget/retention/restart/backup 정책 변경 없음. 기존 backend 전수 회귀. | REGRESSION PASS; 실운영 backup/proxy/late-cookie 결합은 T07. |
| I23 / US-02 / U01–02 | 새 방문 public independence 및 지원 불가/실패 UI는 공개만. 지정 6 OS/browser·HTTPS/HTTP2·호스트/운영·재배포 권리·사람 수락 필요. | LOCAL cases PASS; device/operation/HUMAN NOT RUN, T07 공개 gate. |
| I24 / Q08–09·11–12 / US-54–55 | 기존 transport/mapper/capability/UI 재사용, real API와 mock 회귀 분리, 각 slice 증거. | LOCAL PASS; coordinator CI/publication NOT RUN. |
| Q10 / US-34 | private owner/admin read만 연결. archive CUD/admin archive 목록 false 및 direct refusal. | E1 PASS; Phase 4–5 구현 제외. |
| R24 revoke/reapprove / R9 보관 | 승인 이력 유지·old S 영구 폐기·public 소유 앱 유지, DTO/증거 비밀 제외. | B1/E1 및 기존 T05/lifecycle PASS. pending deletion·approval 전 경합은 T05 회귀. |
| T01–05 | 공통 auth boundary·관리자 approval·메타/공개/seed를 변경 영향 대상으로 검증. | 기존 구현 재사용 및 regression PASS. |
| T07 / Phase 4–6 | 전체 실제 cookie 경합/restore/device/release; archive writes/list; admin reset/delete/reauth; 외부 연결 worker. | 적용 제외 / 후속 티켓 책임, 구현·합격으로 세지 않음. |

## 최초 실패 → 수정 → 재검증

1. 승인 owner의 실제 private GET이 404였다(1 FAIL / 9.88s). 기존 경계에
   optional context와 owner/admin scope를 연결했고 HTTP 행렬을 통과했다.
2. partial `/meta` context가 200이었다(1 FAIL / 11.99s). 공용 all-or-none
   canonical parser를 적용해 16 malformed 조합을 422로 만들었다.
3. 성공한 screen read가 idle을 연장하지 않았다(1 FAIL, 1 PASS / 35.84s).
   revision을 올리지 않는 bounded activity를 추가했다. exact-expiry와 read/revoke
   두 commit 순서는 구현과 함께 추가한 회귀이며 별도 behavioral red로 주장하지 않는다.
4. auth-state 모듈 부재의 suite red 후 3 PASS / 1.31s. protected adapter는
   captured headers/no-store/metadata/late success/error 모두 6 FAIL / 2.41s였다.
   caller snapshot·strict success metadata·observation currentness로 98 PASS / 6.25s.
5. 기존 public list 422 테스트 하나가 새 OpenAPI와 달랐다(89 PASS, 1 FAIL).
   변경된 optional-context 계약의 허용 error tuple을 명시했고 동일 회귀를 통과했다.
6. owner detail component에서 captured context가 전달되지 않아 heading이 없었다.
   public/member query와 synchronous late guard로 7 PASS / 2.95s. ordinary revision
   recheck 때 draft 및 pending admin confirmation이 사라지던 red를 stable
   identity-history key와 hidden/inert tree로 고쳐 198 PASS / 6.07s.
7. public return이 stale auth 때문에 AbortError, 거절된 admin return은 generic
   network message였다(2 FAIL, 14 PASS / 4.70s). 독립 public probe와 안전한
   destination error 표시로 22 PASS / 4.25s. 별도 작은 후속 commit이다.
8. edit target 권한을 잃었다가 되찾으면 옛 draft가 되살아났다(FAIL / 3.30s).
   definitive denial 시 draft references를 지워 통과했다. pending admin target
   재검증 테스트는 처음 transient loading을 봐서 잘못 green이었다. fresh target
   get을 기다리는 assertion으로 강화했고 continuity 7 PASS / 4.27s였다.
9. 브라우저 최초 실패는 change-only fixture, logout 완료/flow generation 가정,
   direct admin Origin 및 synthetic blur/focus setup이었다. 실제 issued context,
   logout 완료, Origin, explicit focus를 사용해 여섯 real journeys를 두 번 통과했다.
   failed-terminal HTTP 추가 검사도 full 상태 login 금지 정책을 먼저 만났으므로
   익명 S의 failed login으로 setup을 고쳤다. 보안 결함 red로 주장하지 않는다.
10. DrvFS에서 seed server 기존 10초 startup과 Vitest worker import가 실패했다.
    기존 설치 Linux copy로 같은 test/deadline을 재실행: seed 1 PASS / 53.69s.
    혼합 Vitest/Chai 경로의 131 matcher 오류는 동일 dependency tree로 고쳤다.
    Vite 외부 font 경로 오류는 원래 frontend 의존성 복원으로 고쳤다. 이러한
    infrastructure 실패는 TDD behavioral red가 아니며 timeout/retry 완화 없음.
11. 기본 API 전수의 기능 단계는 ordinary 53 PASS/29 기존 skip, prepared 51
    PASS였지만 고정 캡처는 10 PASS/10 FAIL이었다. T03의 마지막 기능 사례가
    `admin-user`를 change_only로 남기므로 신규 T06 admin 캡처 5개는 실제 404였다.
    T06은 기존 `approval-admin` full fixture를 사용하고 login helper가 full을
    명시적으로 검증하도록 고쳤다. DB fixture를 재주입하거나 권한을 복구하지 않는다.
    초기 미커밋 T06 캡처는 이 발견 후 최종 fixture로 전체 독립 실행 두 번을 다시
    수행해 대체한다. 기존 reference/시각 baseline/issue119 증거는 그대로 유지한다.
12. 같은 전수 캡처에서 기존 T03 field-error 5개가 사라졌다. cache scope의
    observation/revision을 password form key로 사용해 재확인 중 remount되는 T06
    회귀였다. terminal revision 증가 뒤 오류/값/focus 보존과 identity-history 변화
    뒤 폐기 시험이 먼저 1 FAIL / 5.18s였다. AuthRoute form key를 기존 identity
    history 경계로 분리해 continuity 8 PASS / 3.82s, frontend 881 PASS / 15.20s.
13. 서로 다른 port/output directory의 API/mock browser 두 작업을 동시에 실행하자
    공유 DrvFS import가 지연됐다. API 첫 public load 1 FAIL/4 PASS/1 interrupted,
    mock 첫 admin 여정 1 FAIL/16 PASS/1 interrupted/56 NOT RUN에서 중단했다.
    browser 작업을 순서대로 실행해 같은 deadline을 유지했다. 임시 mock config는
    설치된 pinned executable과 격리 output directory만 지정하며 최종 제거한다.
14. 최종 정책 대조에서 full S의 absolute cap을 flow/R에도 적용한 오류를 발견했다.
    I04/I21 및 기존 `advance(activity=True)`는 S의 8시간 제한과 flow/R의 별도
    30분 inactivity를 구분한다. 같은 near-absolute 사례의 live/expired R 두 조합이
    먼저 2 FAIL / 7.64s였다. S만 absolute로 cap하고 flow/live R은 30분을 유지해
    2 PASS / 6.32s였다. expired R 및 absolute-expired S는 되살리지 않는다.
    계획의 “일관된 activity 갱신”을 별도 수명 규칙에 맞췄으며 정책/TTL 변경이 아니다.

## 독립 리뷰 r1 반영 (2026-10-03)

리뷰 `1a8a4e1`의 REQUEST_CHANGES에 대한 별도 red→green 및 증거다.
기존 통합 기록은 아래에 보존하고 r1 최종 결과는 이 절에 기록한다.

| 지적 | 최초 실패 → 수정 → 재검증 |
| --- | --- |
| MAJOR-1 / AC4 | auth-isolation에서 blur→storage→focus를 지연 proof 중 실행: 3 PASS/1 FAIL, 3.84s; 해제 후 heading 없음. visible 복귀는 in-flight guard 전에 pageAway=false: 4 PASS/2.99s. focus/visibility→visible/pageshow 세 복귀를 같은 seam에서 검사. 실제 E2E는 route.fetch로 실제 flow-state 200을 받은 뒤 지연 전달하고 focus 후 proof 완료까지 heading 0, 완료 후 복원. fabricated success 없음. |
| explicit retry / AC4 | concealed 상태에는 버튼이 없어 4 PASS/1 FAIL, 3.02s. Header concealed/checking에 기존 다시 확인 제어를 제공하고 visible 명시 retry가 away를 해제한 뒤 재증명: 5 PASS/2.93s. 실패하면 private DOM 없음, 다시 확인 성공 때만 복원. Detail/edit/submit/admin/auth의 명시 retry가 같은 동작을 사용한다. |
| MINOR-2 / I19 | BrowserRouter의 실제 back은 getCurrentAuthState를 2회 실행하여 7 PASS/1 FAIL, 3.53s. 새 entry layout effect 하나가 location.key를 처리하고 별도 POP layout/native popstate 제거. isolation+continuity 16 PASS/3.78s. R23 §4의 “새 진입·새로고침·뒤로가기 복원·탭/창 복귀 때는 ... 서버에서 재확인”에 따라 push 재증명은 유지. 실제 client push→back의 flow-state 요청도 1회 단언한다. |
| MINOR-3 / AC6·AC8 | mock admin_users_read/admin_approval enabled 선언은 기존 mock read/approval 구현의 가용성을 반영해 demo 접근을 유지. API archive cap은 바꾸지 않음. non-admin return_to=/admin은 로그인 성공 뒤 login URL+safe alert 유지; #120 AC6/#113 T06의 복귀 전 권한 확인 및 승인 계획 §2 safe error/recheck 경로에 부합. 기존 e2e expectation 변경을 AC6/AC8와 ui-deviations에 명시. |
| NIT / contract | getApp 200 네 header 각각 member-bound-only description. openapi:generate로 타입 comment 생성; lint/type consistency PASS. List BEGIN IMMEDIATE 및 auth-unready 동작은 변경하지 않음. |
| 추가 AC8 mock Health Monitor 회귀 | broadened admin-apps 포함 mock 82 PASS/1 FAIL (276.65s): manual retry 직후 진행 중 대신 완료. 같은 targeted case 재FAIL, T05 isolated source 1 PASS/7.4s, 같은 Linux dependency에서 r1 source 재FAIL. tagged probe: getBatch 진행 알림이 일반 mock-reset→auth restore→batch query remove→즉시 getBatch 반복을 일으켜 4단계를 213ms에 소진했다. mock-health-updated data 알림으로 health/list/admin data만 invalidate하고 batch query·인증 proof는 보존. 기존 E2E assertion 그대로 1 PASS/13.3s. auth notification의 protected cache 제거·가림은 유지. probe는 checkout 밖에서만 사용하고 제거했다. |

### r1 최종 검사

| 명령 | 결과 / 소요 시간 |
| --- | --- |
| `npm --prefix frontend test` | 최종 후속 mock 알림 수정 뒤 886 PASS / 38 files / 12.46s (wall 13.25s). 이전 integration 18.00s도 PASS. |
| targeted isolation/continuity/return/apps/auth-view | 78 PASS / 5.78s. |
| `npm --prefix frontend run test:e2e:api` (인자 없음) | 최종 mock 알림 수정 뒤 재실행: 125 PASS / 기존 gate 29 skip / wall 517.91s. ordinary 53 PASS/29 skip (2.6m), prepared 52 PASS (3.7m), fixed 20 PASS (2.1m). 이전 integration 125 PASS/813.60s도 기록하며 후속 root/mock 변경 때문에 한 번 재검사했다. |
| `npm --prefix frontend run test:e2e:api -- auth-access.spec.js` | 독립 새 DB: 기능 7 PASS (1.7m)+capture 5 PASS (1.3m), wall 209.91s. |
| `node frontend/scripts/check-access-evidence.mjs` + 두 manifest `cmp` | 35/35 PNG 및 JSON byte-identical; 최종 default API run도 앞의 두 독립 재현과 byte-identical. concealed/checking 10 PNG만 새 retry header를 기록; owner/restored/error/denied/admin 25 PNG는 pre-r1과 동일. 기준·mask·tolerance 변경 없음. |
| `check` / `build:mock` / `build` / `check:dist` / `check:reference` | 최종 후속 mock 수정 뒤 재실행 모두 PASS / wall 37.12s / builds 5.02s·4.89s. 이전 integration wall 약 126.00s도 PASS. dist 96 clean files, reference 11 byte/SHA 불변. |
| `uv run --frozen ruff check .` / `ruff format --check .` | PASS, 52 files. |
| backend full (b42f822 이후 최초 전수) | 296 PASS/1 FAIL/기존 warning 1, 2084.77s. 기존 test_dev_seed startup가 10s readiness deadline을 넘음. 원래 DrvFS venv로 실행됨: cwd에 backend prefix를 잘못 붙인 relocation이 실패한 뒤 full command는 정상 실행했으며 이 환경 실수를 기록한다. deadline/테스트 변경 없음. |
| backend seed 영향 재검사 | UV_PROJECT_ENVIRONMENT에 준비된 Linux dependency venv를 지정하여 `APP_ENV=test uv run --frozen pytest tests/test_dev_seed.py -q`: 8 PASS/108.49s (wall 114.80s). full suite를 반복하지 않음. |
| affected mock auth/recovery/admin/admin-apps/create/edit | 최종 83 PASS / wall 184.17s (3.0m). 최초 82 PASS/1 FAIL은 위 health data notification 회귀로 수정했다. 기존 assertion/timeout/retry 그대로. |
| `test:visual -- visual/auth.spec.js visual/admin.spec.js` | 최종 10 PASS / wall 315.88s. 150 legacy records: admin 55는 T05와 동일, auth 95 중 private-member-detail 5 source metrics만 historical T05와 다름. 재현 T05/최종 r1 PNG direct product 비교는 5/5 동일. |

### MINOR-1: source 비교와 product 회귀의 분리

T05 원본 product PNG는 issue119에 보존되어 있지 않고 legacy JSON만 남아 있다.
따라서 historical PNG의 가시적 원인을 단정하지 않는다. `git archive c80d24a`
소스를 별도 일반 디렉터리에서 기존 의존성으로 실행했다 (branch/worktree 변경,
다운로드, 기준 변경 없음). 같은 Chromium/locale/timezone/fonts/clock/config에서
5 private-only 사례 5 PASS/24.6s; 원래 전체 auth sequence는 4 PASS/1 deadline FAIL,
4.2m (1440의 private 캡처 이후 마지막 reset에서 기존 60s deadline 초과).
전체 sequence에서 생성된 private PNG도 모두 비교했다.

[직접 product 비교](mock-private-detail-comparison.json)는 재현 T05와 보존된
pre-r1 T06 private-member-detail PNG 5장을 비교해 **모두 byte-identical,
productDifferentPixels=0**을 입증한다. 최종 r1 private PNG도 5/5 동일하여 이 화면의 재현된 product 회귀는 없다.
반면 historical T05 source differentPixels 394038/307085/342465/176633/172962는
재현되지 않고 T05 재실행도 T06의 406634/319307/355303/188519/184735를 낸다.
이는 historical source 메타데이터의 불일치이며 T06 product 회귀로 판정할 근거가
아니다. 원래 T05 PNG의 위치를 요청했다. 원본이 확보되기 전 historical increment의
가시적 원인 확정은 **BLOCKED**이며 재현 결과로 baseline을 갱신하지 않는다.

## 통합 검사 결과

최종 impact-set 브라우저·static/build 결과를 기록한다.

| 명령 | 결과 / 소요 시간 |
| --- | --- |
| `APP_ENV=test uv run --frozen pytest -q` (backend) | 293 PASS, 기존 deprecation warning 1 / 1072.79s. 초기 통합 시 한 번 실행. 이후 추가 3개는 B2; 마지막 S/flow/R 경계 보완은 아래 영향 검사로 검증하며 전수 재실행하지 않음. |
| final backend access/public + lifetime impact | 65 PASS / 202.55s (`test_auth_access.py test_public_apps.py`); 10 PASS/71 deselected / 49.59s (`test_auth_flow.py test_auth_login.py -k 'expiry or expires or recovery or idle or absolute or activity'`). 마지막 helper는 protected detail에서만 호출되며 관련 records의 만료/복구 회귀를 함께 검사한다. |
| admin approval / races / public meta / seed backend impact | 39 PASS, startup 1 FAIL / 636.75s → 같은 seed test 1 PASS / 53.69s. |
| `uv run --frozen ruff check .` / `ruff format --check .` | PASS, 52 files formatted. |
| `npm --prefix frontend run openapi:generate` | PASS, 명시 generator 1s. 이후 check는 non-mutating. |
| `npm --prefix frontend test` | 최종 881 PASS / 38 files / 15.20s (wall 15.92s). 후속 password-field 회귀 수정 후 실행. |
| `npm --prefix frontend run test:e2e:api` | 최종 124 PASS / 29 기존 intentional skip / wall 554.13s. ordinary 53 PASS/29 skip (2.4m), prepared 기능 51 PASS (4.1m), fixed captures 20 PASS (2.5m). 초기 10 capture FAIL은 위 11–12에서 수정했다. |
| mock auth/recovery/admin 및 create/edit/detail regression | 최종 74 PASS / 4.0m (wall 242.13s), 기존 deadline/retry 그대로. 설치 browser 경로만 선택하는 임시 config와 격리 output directory를 사용한 뒤 제거. 최초 auth 묶음 44 PASS, return message 1 FAIL / 2.0m → 위 보완 반영. |
| `npm --prefix frontend run test:visual -- visual/auth.spec.js visual/admin.spec.js` | 10 PASS / 5.3m (wall 320.81s). [legacy-visual-comparison.json](legacy-visual-comparison.json): 150 records, 110 product-only, source 38 dimensions mismatch + 2 compared/nonzero pixel difference. 145 records는 T05와 동일, private-member-detail 5개의 pixel 수는 달라졌으며 사람 수락은 NOT RUN. |
| `check` / `build:mock` / `build` / `check:dist` / `check:reference` | 최종 모두 PASS / combined wall 49.59s. API build 5.22s, dist 96 files clean, reference 11개 byte/SHA 불변. |
| remote CI / 사람·screen reader·실기기·운영 release | NOT RUN. push/PR 금지이므로 coordinator CI 담당; T07/U01/U02 공개 gate. |

## 검수 상태

r1 코드 수정과 사용 가능한 자동 검증을 마쳤다. backend full의 기존 seed startup deadline 1 FAIL은 준비된 Linux dependency에서 seed 8 PASS로 영향 재검사했으며 전수 PASS로 바꿔 기록하지 않는다. MINOR-1 historical source increment의 가시적 원인은 원본 T05 PNG 부재로 BLOCKED다. 기존 source와 차이가 있는
프레임은 자동 승인하지 않는다. 제품-only 캡처의 동일성은 재현성 증거이며 source
수락이나 운영 공개를 뜻하지 않는다. user README/CLAUDE/routing/storage/.env,
기존 reference/baseline 및 issue119 증거는 수정·staging하지 않는다.
기존 API 검사들이 자기 legacy 목적지에 쓴 77 PNG는 읽기 전용
[legacy-api-capture-comparison.json](legacy-api-capture-comparison.json)의 bytes/SHA/
dimensions 기록 후 원복했다. source pixel 합격이나 새 baseline으로 세지 않는다.
마지막 대상 API 실행이 다시 생성한 61 legacy PNG도 원복했다. 임시 browser config를
제거하고 원래 backend/frontend 의존성 디렉터리를 복원했다.

최종 r1에서도 기존 API 목적지의 generated PNG를 explicit paths로 원복하고, 임시 mock config와 checkout 밖 진단 source/probe를 제거했다. frontend/backend 원래 의존성 디렉터리는 보존된다.
