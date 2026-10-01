# #116 / Phase 3 / T02 실행 증거

판정 기준: [#116](https://github.com/DomineYH/vibe_coding_archive/issues/116),
[#113 Testing Decisions](https://github.com/DomineYH/vibe_coding_archive/issues/113),
[전환 ADR](../../../../adr/0001-server-auth-transition-boundary.md).
검증 DB는 매 실행 별 임시 파일이며 기존 개발·운영 DB를 변경하지 않는다. 일반
capability는 모두 false이고, 합의된 `APP_ENV=test` factory만 `auth_login`·
`auth_logout`을 한 쌍으로 연다(`auth_password_change`는 T03까지 false).
회원은 `backend/tests/support.py`의 합성 Argon2id 회원이며 비밀번호·쿠키·CSRF·
원문 DB는 증거에 넣지 않았다.

## 검증 결과

| 실행 위치 / 명령 | 결과 |
| --- | --- |
| backend / `APP_ENV=test uv run --frozen pytest` | **163 passed**, 기존 Starlette 경고 1 (T02 신규 37) |
| backend / `uv run --frozen ruff check .` · `ruff format --check .` | 통과, 33 파일 |
| backend / `pytest tests/contracts/test_auth_login.py tests/test_auth_limits.py tests/test_auth_restart.py` | 신규 3개 파일 통과 |
| frontend / `npm run check` | 통과; 기존 OpenAPI 4xx 경고 2, 생성 타입 일치 |
| frontend / `npm test` | **32 files / 827 passed** |
| frontend / `npm run test:e2e -- e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js` | **45 passed** (mock 회귀; 실제 인증 합격으로 계산하지 않음) |
| frontend / `npm run test:e2e:api` | 일반 경계 **48 passed** + 준비 경계 **29 passed**(auth-prepare 17 + auth-login 12) |
| frontend / `npm run test:visual -- visual/auth.spec.js visual/admin.spec.js` | **10 passed**, Chromium 151.0.7922.34, 기준 이미지 변경 없음 |
| frontend / `npm run build:mock` · `npm run build` · `check:dist` · `check:reference` | 통과; dist 96 files, 원본 11 files 해시 일치 |
| frontend / `npm run openapi:generate` | 명시적 실행; 생성 타입 커밋, 이후 `openapi:check` 일치 |

고정 renderer(Chromium 151.0.7922.34 headless shell)는 이 환경에 없어
Chrome for Testing 공식 저장소에서 같은 버전을 받아 저장소 밖에 두고 썼다.
visual·API 캡처는 이 renderer, `FONTCONFIG_FILE=visual/fontconfig.conf`,
DPR 1, ko-KR, Asia/Seoul, 브라우저 Date 2026-10-01T00:00:00Z 고정, animation 비활성이다.
mock e2e 45건은 기본 bundled Chromium이며 고정 renderer 합격으로 세지 않는다.

## 요구·사례 연결

| 요구 (#116 AC) | 기대 결과와 증거 | 판정 |
| --- | --- | --- |
| Argon2id·트랜잭션 밖 검증·최종 재확인 | `test_login_issues_a_full_session…`, 프로필 기록 테스트, 해싱 중 승인 해제/해시 변경/삭제/settle/허가 만료 경합 6건 | 합격 |
| 로그인 응답만으로 화면을 열지 않음·별명 헤더·새로고침 복원 | api-auth-login 단위(관찰 시 서버 me), e2e 1번(헤더 별명·아이디 비노출·reload·저장소 비밀 없음) | 합격 |
| full 8시간·30분·비연장·재시작 유지 | 주입 시계 경계(30분, 8시간−1µs), GET 비연장, `test_auth_restart.py` 3건 | 합격; 활동 연장은 아래 후속 |
| 계정 전환은 로그아웃부터·다른 기기 유지·무-S 204 | 409 ALREADY_AUTHENTICATED(admit), 두 클라이언트 격리, e2e 6·7번 | 합격; 가입 409는 T04 |
| 동일 INVALID_CREDENTIALS·더미 해시·미승인/임시 만료 순서 | 미존재/오답/미사용 해시 동일 응답+매 건 argon2 검증, 승인/해제 5조합 | 합격; 임시 만료 실행은 T03 |
| rolling 10/200·16KiB·해싱 포화·DB 잠금 | 6 + 계약 테스트(재시작 유지, 차단이 창을 연장하지 않음, 413/400/422 구별, 503 AUTH_BUSY+Retry-After, 실제 잠금 DB_BUSY) | 합격 |
| 응답 유실은 unknown·replay 없음·private/no-store | 단위(오염 응답 unknown, 확정 거절 rejected), e2e 4번(실제 연결 중단→결과 확인→재로그인), 헤더 검사 | 합격; 서버 commit 후 응답 유실·S 미수령 결합은 T07 |
| 실제 HTTP·파일 DB·쿠키 E2E | e2e-api/auth-login.spec.js 7건 + 5 viewport 5건 | 합격 |
| 화면 구조·5 viewport·접근성 | 아래 | 관찰 완료; 사람의 시각 수락 아님 |

최초 실패→수정: 허가 대기 0인 게이트가 빈 슬롯도 거절한 결함(포화 테스트로 발견), 같은 시계에서
만료된 익명 S를 재사용한 테스트 오류, 상태 재조회가 만료된 흐름에 의존한 테스트 헬퍼 오류,
확정 거절(401/403)이 쓰기 불확실성으로 unknown 분류된 전송 오류를 각각 수정하고 재검증했다.
리뷰 반영: 일반 로그인이 recent_auth 창을 열던 것을 제거(T03/Phase 5 소관),
깨진 증거 링크를 이 문서로 해소했다.

## 화면·접근성·독립 재현

[캡처 목록](captures.json)의 정상 카드·자격증명 오류·미승인 안내·로그인 후 헤더
**4상태 × 5크기 = 20개**는 `product_only` 관찰이며 새 baseline이 아니다.
[독립 실행 비교](capture-reproducibility.json)는 새 임시 DB·서버·browser context의
두 번 실행에서 **20개 모두 SHA-256 동일**이다. label→password Tab 순서, 라벨 접근
이름, 오류 `role=alert`는 browser 검사에 포함한다.
[원본 로그인 직접 비교](source-login-comparison.json)는 07-login·08-login-error와
치수·픽셀 차이를 기록하며(치수가 다른 경우 mismatch 표기) UI-D03/UI-D04 차이 때문에
원본 픽셀 일치라고 주장하지 않는다. 최대 420px 카드·EV·세그먼트·57px 헤더를 유지했고
기준 이미지·mask·허용 오차는 바꾸지 않았다. 로그인 후 gallery 첫 viewport 상태는
기존 화면에 별명·로그아웃만 더한 것이다.

## 범위 / 남은 검증

- 제외(후속 T): 가입의 ALREADY_AUTHENTICATED 409(T04), change_only 로그인·임시 만료 실행·
  본인 비밀번호 변경(T03), 비공개 상세·계정 전환 화면 격리(T06), 서버 commit 후 응답 유실·
  S 미수령·브라우저 재시작 e2e·실제 OS/브라우저 수락(T07).
- 비활동 30분 연장: T02에는 연장할 보호 요청이 없어 세션은 로그인 후 30분에 만료한다.
  보호 요청이 생기는 T06 이후에 세션과 흐름 만료를 함께 연장해야 한다.
- 계정+IP/IP 실패 한도는 해싱 전 확인·해싱 후 기록이라 동시 오답은 한도를 소폭 넘을 수 있다.
- 해싱 풀·Argon2 시간은 후보값이며 운영 호스트 실측은 T07 전 보장하지 않는다.
- 고정 renderer 부재로 공식 저장소에서 동일 버전을 받아 사용했다(저장소에 포함하지 않음).
