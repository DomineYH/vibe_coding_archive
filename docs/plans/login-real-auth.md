# 로그인 실제 인증 연결 계획

작성일: 2026-10-01. 상태: 문서 계획 확정(권장안 일괄 위임), 구현·테스트·배포·공개 승인 아님. 이번 작업은 이 계획, CONTEXT.md, ADR만 변경한다. 기존 코드·계약·README·환경 설정·storage와 GitHub 기록은 변경하지 않는다.

## 문제와 완료 기준

Phase 1은 브라우저 데모 인증이고 현재 FastAPI는 공개 읽기만 제공한다. 같은 제품 화면에서 **가입 → 최초 승인 대기 → 관리자 승인 → 실제 로그인 → 새로고침 유지 → 로그아웃**을 실제 HTTP·파일 SQLite·브라우저 쿠키로 검증하는 PRD Phase 3을 계획한다. 로그인 endpoint 성공만으로 완료하지 않는다. 승인 해제, 임시 관리자 첫 비밀번호 변경, 다중 탭 및 응답 유실 복구도 해당 인증 경계의 일부다.

진행은 ① 확정 결정·현재 구현 대조 → 출처와 차이 확인, ② 의존 순서대로 질문·권장안·근거 기록 → 자동 승인 또는 미결 분리, ③ 수직 슬라이스와 검증 명령 작성 → 범위·API·데이터·화면·검증 누락 점검 순서다. 사용자의 지시에 따라 답변을 기다리지 않았으며, 자동 승인을 개별 사람 답변으로 표현하지 않는다.

## 근거와 우선순위

- [R7: #7 resolution][R7]은 입력·세션·승인·오류의 원천이다. [R23: #23 resolution][R23]은 동일 브라우저 전환의 최종 원천이며 부록 A/B까지 적용한다. 이미 확정된 내용은 재질문하지 않는다.
- [PRD](../../PRD/PRD_EduVibe_Archive_v1.0.md) §6, §7.6, §9~10, §12 Phase 3, §13과 [CONTEXT](../../CONTEXT.md)를 따른다. 고정 쿠키명과 GET CSRF의 익명 발급은 R23이 명시적으로 변경했다.
- [#34](https://github.com/DomineYH/vibe_coding_archive/issues/34), [#35](https://github.com/DomineYH/vibe_coding_archive/issues/35), [#44](https://github.com/DomineYH/vibe_coding_archive/issues/44)는 데모의 완료 범위이며 실제 보안 검증 증거가 아니다. #44를 읽었다는 이유로 Phase 5를 앞당기지 않는다.
- [#77](https://github.com/DomineYH/vibe_coding_archive/issues/77) 및 [#78](https://github.com/DomineYH/vibe_coding_archive/issues/78)~[#85](https://github.com/DomineYH/vibe_coding_archive/issues/85)의 What to build / Acceptance criteria / Blocked by 방식을 슬라이스에 적용한다.
- [#9][R9], [#15][R15], [#24][R24]는 R7/R23에서 연결된 개인정보·개발 기반·승인 경합의 추가 확정 근거다. 이들의 기존 결정을 이번 자동 승인으로 새로 선택한 것은 아니다.
- [늦은 쿠키 조사](../research/auth-transition-late-cookie.md)는 Chrome headless·직접 HTTP/1.1 재현 근거다. 그 문서의 고정 이름 전제·후보 단계는 이후 R23보다 우선하지 않으며 실기기·proxy 전체 검수 완료를 뜻하지 않는다.
- 계약 정본은 [OpenAPI](../../contracts/openapi.yaml), 분류 정본은 [catalog](../../contracts/catalog.json)이다. 구현 때 정본→생성 타입→실제 서버 응답→mapper를 대조하며 이 문서는 두 번째 편집 API 정본이 아니다.

## 범위와 비범위

| 범위               | 이번 실제 연결                                                                                    | 경계                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 로그인·로그아웃·me | 승인 full, change_only, 익명/만료, 역할·세션 회전·복원                                            | 모든 보호 요청은 서버 판정; 로그인 응답만으로 화면 해제 금지                 |
| 세션·CSRF·복구     | R23 준비·사전 접수·종결·미수령 폐기·초기화 전체                                                   | 고정 쿠키·JWT·localStorage 토큰으로 축약 금지                                |
| 가입·승인 대기     | 정규화·중복·해시·미승인 저장·90일 만료 안내/정리                                                  | 자동 로그인 없음; 선택 연락처 실수집 비활성                                  |
| 관리자             | bootstrap/recovery CLI, 첫 본인 비밀번호 변경, 기존 사용자 탭 목록/상세/승인/해제, 실제 기본 통계 | 승인 처리 키·결과 조회·취소·account_version·최소 감사 포함                   |
| 열람 권한          | 공개는 기존대로; 승인 full의 본인 비공개 상세 및 관리자의 비공개 상세 읽기                        | 공개 목록·검색·facets는 계속 공개 집합; 관리자 앱 목록/쓰기 기능은 열지 않음 |
| 운영 준비          | 명시적 migration, 재시작 종결, 만료 정리, 인증 readiness, 합성 시험 CLI                           | 실제 운영 계정 생성·배포·실수집·실기기 확보는 이 문서 작업의 실행 범위 밖    |

비범위: 앱 CUD·내 앱/관리자 앱 관리 확장(Phase 4~5), 일반 회원 비밀번호 초기화·계정 삭제·관리자 재인증(Phase 5), 외부 연결 검사·worker(Phase 6), OAuth/JWT/자동 이메일·SMS/새 프로필·새 관리자 화면. 관리자 계정 삭제·승인 해제·웹 비밀번호 초기화는 이후에도 금지한다. 복구 프로토콜은 reauthenticate kind를 보존하지만 해당 실행 기능은 비활성이다.

## 결정 로그

계승 행은 질문이 아니라 확정 결정의 점검 축이다. 새 질문은 선행 결정이 정해진 라운드에서만 다뤘다. 상태의 **자동 승인(권장안)**은 코디네이터 지시에 따른 채택을 뜻한다. 미결은 해당 공개/운영 경로만 차단하며 독립 구현 계획은 계속 작성했다.

### 라운드 0 — 확정 결정 계승

| ID / 질문·점검 축                | 권장안 또는 계승 내용                                                                        | 근거                              | 상태     |
| -------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------- | -------- |
| I01 식별·정규화는?               | 내부 ID·로그인 아이디·별명 분리. trim/NFC·허용 문자·code point 길이, 아이디 정규화 키 유일성 | [R7 §1][R7]                       | 계승-#7  |
| I02 새 비밀번호는?               | NFC, 15~128자, 공백/대소문자 보존, 로컬 전체 문자열 차단 목록, 확인은 브라우저만             | [R7 Q3·16·19][R7]                 | 계승-#7  |
| I03 가입·승인 상태는?            | 가입은 미승인·자동 로그인 없음. 최초 대기와 승인 해제 경위 분리                              | [R7 Q5][R7]                       | 계승-#7  |
| I04 세션 수명·기기는?            | full 절대 8시간/비활동 30분, 익명 15분, 다중 기기 허용·일반 로그아웃은 현재 세션만           | [R7 Q7~9·11][R7]                  | 계승-#7  |
| I05 임시 자격증명은?             | 24시간, change_only=min(발급+15분, 임시 만료), 변경 완료 때 소모                             | [R7 Q20~22·34~36][R7]             | 계승-#7  |
| I06 활동·승인 해제는?            | me/CSRF/polling으로 연장 없음. 승인 해제는 대상 전체 세션 폐기·공개 앱 유지                  | [R7 Q9·23][R7], PRD §6.3          | 계승-#7  |
| I07 Origin·CSRF는?               | Origin 우선·없을 때 exact Referer, null/둘 다 없음 거부. 현재 S에 결합된 CSRF                | [R7 Q27][R7]                      | 계승-#7  |
| I08 로그인·가입 예외는?          | full/change_only에서 409, 잘못된 자격증명 401을 전역 로그아웃으로 바꾸지 않음                | [R7 Q26·38][R7]                   | 계승-#7  |
| I09 남용 방지는?                 | rolling account+IP 10/15분·IP 200/15분 실패, 가입 IP 100/시간, 더미 해시                     | [R7 Q12·29·31·37][R7]             | 계승-#7  |
| I10 자원 상한은?                 | 본문 16KiB, 해싱 동시 2·대기 4·1초 후보, 포화 503·Retry-After 1; 실측 별도                   | [R7 Q13·30][R7]                   | 계승-#7  |
| I11 최초 관리자 경로는?          | 관리자 0명일 때 bootstrap, 기존 관리자만 recovery, hidden input·임시 암호·감사 원자성        | [R7 Q15·32~35][R7]                | 계승-#7  |
| I12 재인증·초기화 경계는?        | 승인에는 recent-auth 불필요. 초기화/삭제 15분 recent-auth, 재인증 별도 operation은 Phase 5   | [R7 Q10·24~25][R7], PRD Phase 3/5 | 계승-#7  |
| I13 고정 쿠키로 연결해도 되는가? | 불가. S/R 모두 발급마다 새 이름, 서버가 현재 세대 선택·과거 fallback 금지                    | [R23 §2·6][R23]                   | 계승-#23 |
| I14 최초 준비는?                 | ID 발급→공유 저장→R 발급→수령 확인→사전 접수→익명 S 발급                                     | [R23 §3·부록 A][R23]              | 계승-#23 |
| I15 전환 실행은?                 | 공통 Web Lock, 요청 전 ID 저장, 60초 허가, 최초 한 건 실행·최종 순번 재검사                  | [R23 §3·부록 B][R23]              | 계승-#23 |
| I16 결과 유실은?                 | unknown 유지, settle/상태 확인; 성공 새 S 미수령이면 정확한 그 세션만 폐기                   | [R23 §5][R23]                     | 계승-#23 |
| I17 증명 유실은?                 | S로 R 교체, ID만 있으면 eligibility, ID 유실은 명시적 reset, 전부 유실은 제한적 새 방문      | [R23 §5][R23]                     | 계승-#23 |
| I18 보호 요청은?                 | 흐름·순번·세대 검증, 미종결 차단, 실제 반영과 원자 검사, 자동 재실행 금지                    | [R23 §4·부록 B][R23]              | 계승-#23 |
| I19 탭 복귀·초안은?              | 가림→서버 확인; 같은 회원만으로 복원 금지, last_identity_change_revision 대조                | [R23 §4][R23]                     | 계승-#23 |
| I20 쿠키 정리·예산은?            | 관측한 영구 무효 이름만 삭제, 새 발급 포함 8개/2KiB, 감소 재관측 후 발급                     | [R23 §6][R23]                     | 계승-#23 |
| I21 흐름·결과 수명은?            | 흐름/R 비활동 30분, 결과 조회 30분·종결 후 1시간 내 삭제; GET 연장 없음                      | [R23 §6][R23]                     | 계승-#23 |
| I22 재시작·복원은?               | 정상 재시작은 미종결 차단 후 준비, 성공/유효 S 유지. 백업 복원은 S/R/흐름/허가 폐기          | [R23 §7][R23]                     | 계승-#23 |
| I23 지원·공개 조건은?            | 필수 기능 실제 동작 검사, 미지원은 공개만. 6개 OS/브라우저 환경 실제 검수                    | [R23 §7·9][R23]                   | 계승-#23 |
| I24 API·mock·화면 정본은?        | 기존 서비스/mapper·wire 재사용, GET csrf는 읽기만, 데모 분리·5 viewport 유지                 | [R23 §9·부록 A/B][R23]            | 계승-#23 |

### 라운드 1 — 범위와 도메인

| ID / 질문                             | 권장안                                                                                       | 근거                                                                          | 상태              |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| Q01 로그인만 구현할 것인가?           | PRD Phase 3의 가입·승인·세션을 함께 연결한다. 승인 없는 가입자를 대기 상태에 방치하지 않는다 | PRD Phase 3, [#35](https://github.com/DomineYH/vibe_coding_archive/issues/35) | 자동 승인(권장안) |
| Q02 관리자 기능은 어디까지인가?       | 사용자 목록/상세·승인/해제·기본 통계·CLI만 포함. #44 초기화/재인증은 후속                    | PRD Phase 3/5, [R24 §10][R24]                                                 | 자동 승인(권장안) |
| Q03 첫 관리자도 본인 변경이 필요한가? | change_only→full을 이번에 포함한다. 고정 관리자 비밀번호나 full 직접 발급 우회는 없다        | I05·I11, PRD Phase 3의 bootstrap                                              | 자동 승인(권장안) |
| Q04 ‘승인 대기’는 모두 90일 삭제인가? | 최초 승인 대기와 승인 이력을 용어집에 분리. 과거 승인 후 해제는 자동 삭제 대상 아님          | [R9 Q16·35][R9], [R24 §3][R24]                                                | 자동 승인(권장안) |
| Q05 실제 연락처도 받는가?             | 비활성 유지, 미전송/null/정규화 빈 값만 허용하고 nonempty는 필드 오류; 주소 미설정 안내 유지 | [R9 Q8·44][R9], OpenAPI RegisterInput                                         | 자동 승인(권장안) |

### 라운드 2 — 저장·전환·가용성

| ID / 질문                                           | 권장안                                                                                                       | 근거                                                                                           | 상태              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------- |
| Q06 새 users 테이블로 바꿀 것인가?                  | members와 앱 FK를 유지하고 인증 컬럼을 추가한다. pending/revoked는 동일 미승인 권한·서로 다른 경위로 해석    | [models.py](../../backend/app/models.py), I01·I03                                              | 자동 승인(권장안) |
| Q07 기존 seed 계정을 자동 이관/승인할 것인가?       | ID/소유권 보존. 해시·정규화·이력 사전 검사, 충돌/출처 불명 이력은 중단·명시적 보정; 자동 암호/날짜/승격 없음 | [0002](../../backend/alembic/versions/0002_public_apps.py), [R15 §6][R15]                      | 자동 승인(권장안) |
| Q08 세션만 먼저 공개하고 복구는 나중에 붙일 것인가? | 각 슬라이스는 독립 시험하되 활성화 전 준비·복구·로그아웃·본인 변경까지 통합 검증                             | I13~I23, [ADR](../adr/0001-server-auth-transition-boundary.md)                                 | 자동 승인(권장안) |
| Q09 프런트 전환 지점은 어디인가?                    | 기존 authService·mapper·API adapter와 app의 mock 전용 복원/가림 분기를 capability 기반으로 연결              | [auth adapter](../../frontend/src/services/api/auth.ts), [app](../../frontend/src/app/app.jsx) | 자동 승인(권장안) |
| Q10 로그인으로 앱 쓰기도 여는가?                    | 공개 목록은 유지하고 비공개 상세의 소유자/관리자 읽기만 실제 권한 연결. 쓰기·관리자 앱 목록은 비활성         | PRD §6.5·Phase 3/4, [main.py](../../backend/app/main.py)                                       | 자동 승인(권장안) |
| Q11 공통 전송 계층을 새로 설계할 것인가?            | 기존 fetch/error/mapper를 재사용하고 순환 의존성이 생기는 최소 전송 부분만 분리                              | [api/apps.ts](../../frontend/src/services/api/apps.ts), 기존 auth import                       | 자동 승인(권장안) |
| Q12 검증을 마지막 티켓으로 모을 것인가?             | 매 슬라이스 HTTP·파일 DB·화면까지 검증하고 마지막은 결합 경합/공개 gate만 담당                               | [#77](https://github.com/DomineYH/vibe_coding_archive/issues/77), R23 §8~9                     | 자동 승인(권장안) |

### 라운드 3 — 근거 없는 운영 선택

| ID / 질문                                                                 | 권장안                                                                                    | 근거                                                                     | 상태                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| U01 실제 문의 주소·운영자 준비·지원 실기기 검수 일정을 무엇으로 정하는가? | 구체값을 선택할 근거 없음. null 안내·공개 보류 유지; 소유자가 설정/증거를 제공해야 함     | [main.py](../../backend/app/main.py)의 support null, R9·R23 공개 조건    | 미결(사람 결정 필요) |
| U02 차단 목록을 배포 패키지에 재배포할 권리가 있는가?                     | 권리 확인 근거 없음. 이미 선정된 고정 목록의 개별 준비/검증만 계획, 패키지 포함 승인 없음 | [R15 §8][R15], [출처 조사](../research/password-blocklist-provenance.md) | 미결(사람 결정 필요) |

총 38개 기록: 계승 24개(#7 12개, #23 12개), 자동 승인 12개, 미결 2개. 상세 R7/R23의 개별 Q 수를 다시 센 숫자가 아니라 위 결정 로그 행 수다.

## 현재 구현과 차이

| 현재 파일                                                   | 관찰 사실                                                                                   | 실제 연결 작업                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| backend/app/main.py                                         | apps_read만 true, 인증 라우터 없음                                                          | 인증 라우터·준비 검사·capability 조건 연결                    |
| backend/app/models.py, alembic/versions/0002_public_apps.py | members에 raw login_id UNIQUE, nullable hash, pending/approved/revoked; 세션/흐름/전환 없음 | 정규화 키·계정 이력·인증 영속 상태 추가                       |
| frontend/src/services/api/auth.ts                           | 22개 메서드가 FEATURE_UNAVAILABLE                                                           | 기존 AuthService의 준비/복구 포함 실제 HTTP 구현              |
| frontend/src/app/app.jsx                                    | 초기 상태·restoreAuth·beginAuthTransition·초기 복원·상세 보호가 mock 분기                   | 인증 capability에 따라 API 관찰·캐시/가림·흐름 복구 연결      |
| frontend/src/services/api/apps.ts                           | credentials:include 및 getCsrf 연계 전송 존재                                               | 일반 보호 요청 인증 메타데이터 추가; auth↔apps 순환 의존 방지 |
| frontend/e2e/auth*.spec.js                                  | mock 저장소를 직접 조작                                                                     | 데모 회귀 유지, e2e-api에 실제 인증 시나리오 별도 작성        |
| frontend/e2e-api/{meta,apps,detail}.spec.js                 | 인증 요청 0회 기대                                                                          | 공개 방문/비활성 0회는 유지하고 활성 기존 인증 복원과 분리    |
| contracts/openapi.yaml                                      | R23 경로/DTO 이미 존재, 일부 보안/오류 선언은 구현 전 대조 필요                             | 아래 차이만 정본·생성 타입·mapper·서버 검사로 정합화          |

## DB 스키마와 마이그레이션

물리 이름은 기존 members를 유지한다. 아래는 구현해야 할 최소 저장 책임이며 ORM 객체를 응답으로 직접 노출하지 않는다. SQLite WAL·연결별 FK·요청별 Session·명시적 Alembic을 유지한다.

| 테이블                     | 컬럼/제약·인덱스                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| members 확장               | 기존 id/login_id/nickname/email/phone/password_hash/is_admin/approval_status 유지. login_id_key UNIQUE NOT NULL(정규화 후 ASCII 소문자), account_version 양수 기본 1, created_at/updated_at, first_approved_at nullable, must_change_password bool, temporary_password_expires_at nullable. pending=최초 대기, revoked=승인 해제 경위; DTO approved는 approved 상태만 true |
| sessions 신설              | token_hash PK(난수 원문 저장 금지), flow_id FK, issued_seq, member_id nullable FK, kind anonymous/change_only/full CHECK, csrf_token, created_at/authenticated_at/last_activity_at/absolute_expires_at/expires_at/revoked_at. UNIQUE(flow_id,issued_seq), member_id 및 만료 인덱스. member_id NULL은 anonymous만 허용                                                      |
| auth_flows 신설            | UUID PK, revision/issued_seq 상수 재사용 없는 정규 십진 문자열, current_session_generation, current_recovery_seq, recovery_ready/ever_ready, last_identity_change_revision, created_at/last_activity_at/expires_at/revoked_at. 현재 세대가 자기 흐름의 자격증명을 가리킴을 트랜잭션에서 검증                                                                               |
| recovery_credentials 신설  | flow_id FK·issued_seq 복합 유일, token_hash UNIQUE, recovery_csrf_token, 발급/만료/폐기 시각. S와 별도 권한·난수; R 원문 저장 금지                                                                                                                                                                                                                                         |
| auth_transitions 신설      | transition_id PK=`flow_id.접수전revision`, flow_id FK, kind CHECK, 출발 세대/접수전·후 revision, permit_expires_at, state CHECK, result_session_generation/failure_code nullable, admitted_at/terminal_at. 흐름당 admitted/executing 최대 1개인 부분 UNIQUE index, terminal_at 정리 인덱스                                                                                 |
| write_operations 승인 부분 | R24 기존 계약: key·actor 회원 FK·kind=user_approval·target_id·expected_account_version·approved·발급/만료·unresolved/succeeded/rejected·반영 버전/승인값/시각·안전한 실패 code. target 삭제 CASCADE로 다른 관리자의 결과를 지우지 않음. 인증 transition ID와 별개                                                                                                          |
| audit_logs 및 유지관리     | 승인/해제·CLI 자격증명 변경·작업 취소의 최소 행위/대상/시각/결과, 업무와 같은 트랜잭션. 대상 삭제 CASCADE 없음. 법정 접속기록과 일반 감사의 보관 구분은 R9 유지; 비밀번호·토큰·연락처 원문 금지                                                                                                                                                                            |
| rate_limit_events          | 용도별 최소 식별 키·발생/만료 시각, rolling 집계 인덱스. 비밀/원시 요청 저장 없음. 프로세스 재시작으로 제한을 우회하지 않도록 SQLite 영속화, 만료 후 1시간 내 정리                                                                                                                                                                                                         |

revision/issued_seq는 SQLite INTEGER overflow로 순환시키지 않는다. Python 정수로 증가 후 정규 십진 문자열로 저장하고 compare-and-swap은 이전 값 동등 비교로 한다. 시퀀스의 문자열 사전식 최대값으로 현재 S를 선택하지 않는다. CSRF 원문은 기존 토큰을 재조회하기 위한 제한된 자격증명 저장소에만 두며 전환 결과/로그/브라우저 영속 저장소에는 복제하지 않는다.

마이그레이션은 현 head `0002_public_apps` 뒤 `0003_auth_identity`(회원·흐름/세션/전환·제한·CLI 최소 감사), `0004_member_approval`(승인 작업키·가입 유지관리)에 책임별로 추가하는 계획이다. 이미 적용한 0001/0002를 고치지 않는다. T01/T04가 각각 자기 revision을 포함하고, 시작 시 create_all/자동 upgrade 없이 head를 검사한다.

1. 원본 DB의 정규화 아이디 충돌·부적합 값·해시 출처·승인 이력/가입 시각 누락을 먼저 검사한다. 충돌을 suffix·회원 병합으로 숨기지 않는다. 실제 과거 시각을 migration 시각으로 꾸며 90일을 새로 시작하지 않는다. 누락/불명 데이터는 migration 전 명시적 보정 자료가 필요하며 없으면 인증 전환을 중단한다.
2. 시험·개발 합성 자료는 전용 fixture/명시적 seed의 근거 있는 시각을 사용한다. null/알 수 없는 password_hash는 로그인 불가 상태로 남기며 데모 평문·공개 암호를 자동 주입하지 않는다. 유효한 기존 Argon2 해시는 유지한다. 브라우저 mock 데이터는 이관하지 않는다.
3. nullable 추가→검증된 backfill→유일성/CHECK 강화 순서로 SQLite batch migration을 적용한다. 앱 ID·owner FK·원문·공개 여부를 보존하고 foreign_key_check 및 공개 읽기 회귀를 확인한다. 불가역 자격증명/회원 이력을 버리는 downgrade 대신 별도 환경의 백업 복원 절차를 사용한다.
4. 비밀번호 해싱은 설치된 pwdlib[argon2]의 Argon2id로 트랜잭션 밖에서 수행한다. 초기 파라미터는 설치 버전의 권장 프로필을 명시적으로 기록·시험하고 호스트 실측 전 운영 성능을 보장하지 않는다. S/R은 secrets의 256비트 난수와 SHA-256 검증값을 사용하며 비밀번호 저장용 해시와 혼동하지 않는다. 최종 DB 처리에서 회원 존재·승인·account_version·자격증명·현재 흐름/S/허가를 재검사하고 세션 회전/결과와 함께 commit한다. 잠금은 기존 5초 상한 뒤 503 DB_BUSY, 무한 재시도 없음.
5. 최초 미승인 90일 정리는 삭제 직전 first_approved_at 없음·가입 기한·현재 상태를 원자 재확인한다. 승인 선확정이면 삭제하지 않는다. 보관·재삭제 기록/백업 적용은 R9와 연결하며, 정리 기능 미구현 상태에서 실제 가입 공개를 허용하지 않는다.

## API 계약

모든 경로는 `/api/v1` 기준, snake_case JSON·허용 필드만 수락한다. 공통 오류는 `{error:{code,message,fields?,request_id,reasons?,retry_at?,server_time?}}`이다. 실제 토큰/해시/DB 내부 오류는 응답·로그에 넣지 않는다. 본인/관리자 응답은 private, no-store, 토큰/흐름 응답은 no-store다.

### 회원·관리자 경로

| 요청                                                                          | 성공 응답                                                                                                                      | 주요 거절/연결                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST /auth/register `{login_id,password,nickname,email?,phone?}`              | 201 RegisteredUser `{id,login_id,nickname,approved:false,pending_expires_at}`; S 회전/자동 로그인 없음                         | 409 LOGIN_ID_TAKEN/ALREADY_AUTHENTICATED; 422 필드 오류. 확인·role·approved 입력 거부                                                                     |
| POST /auth/login `{login_id,password}`                                        | 200 AuthResult `{user:Self,csrf_token}` + 새 S + 최종 인증 메타데이터                                                          | 401 INVALID_CREDENTIALS, 403 ACCOUNT_NOT_APPROVED/TEMP_PASSWORD_EXPIRED, 409 ALREADY_AUTHENTICATED                                                        |
| GET /auth/me                                                                  | 200 Self; full은 id/login_id/nickname/role/approved/must_change_password/session_kind/expires_at/email/phone/recent_auth_until | 401 AUTH_REQUIRED. change_only는 연락처/recent_auth_until 제외, 실제 짧은 expiry 반환                                                                     |
| POST /auth/password `{password}`                                              | 200 AuthResult + 새 full S; 다른 change_only 폐기                                                                              | 403 SESSION_KIND_NOT_ALLOWED(full), 401 만료/폐기, 422 정책 위반, 최종 검사 경합 거부                                                                     |
| POST /auth/logout 본문 없음                                                   | 204, 현재 S 폐기. S 없음은 Origin 검증 후 204                                                                                  | S 있으면 해당 CSRF·전환 필요. 204를 미확인 다른 전환의 종결로 해석하지 않음                                                                               |
| GET /admin/users, /admin/users/{id}                                           | 기존 AdminUserPage(items/pagination/stats/server_time)·AdminUser DTO; 전체 집계/현재 대상·account_version                      | full 관리자만. 기본 목록 연락처 제외. 정상 가동은 실제 healthy 결과만 집계하며 미검사 0                                                                   |
| POST /write-operations (kind=user_approval), PATCH /admin/users/{id}/approval | 사전 key 발급 후 명시 `{approved,expected_account_version}` + Idempotency-Key; 기존 AdminUser 응답                             | R24 발급부터 24시간 실행/조회·만료 후 1시간 내 기록 정리·소유자·버전 검증, 관리자 대상 금지. 승인/해제+버전+전체 대상 세션 폐기(해제)+감사+결과 원자 반영 |
| GET /write-operations/{key}, POST /write-operations/{key}/cancel              | 기존 처리 결과 DTO; cancel도 결과를 반환                                                                                       | 조회/cancel은 현재 관리자·키 소유 확인, R만으로 불가. unknown→조회→명시적 동일 제출/취소; 자동 최신 버전 치환 금지                                        |
| GET /apps/{id} 인증 읽기                                                      | 기존 상세 DTO·소유자 또는 관리자만 비공개 허용                                                                                 | 무권한/없는 비공개 모두 동일 404, change_only는 익명 범위                                                                                                 |

새 비밀번호 입력과 기존 비밀번호 검증을 구별한다. 가입/변경/임시 암호 생성은 15~128 정책을 적용하지만 로그인 DTO의 기존 minLength=1을 임의로 바꿔 과거 자격증명 검증을 막지 않는다. 본문 최대 16KiB·더미 해시·과부하 제한을 함께 적용한다. 정확한 비밀번호에만 미승인→임시 만료 순으로 알리며 미존재/삭제/불일치는 동일 INVALID_CREDENTIALS다.

### 준비·복구 경로

S는 해당 흐름의 유효한 현재 세션, R은 복구 자격증명이다. 표의 상태 변경은 Origin 검증이 기본이며, 최초 준비 3개 경로만 사전 CSRF 면제다. `f`=flow_id, `t`=transition_id, `r`=expected_revision, `g`=expected_session_generation. 아래 DTO 필드의 정확한 필수/null/enum은 OpenAPI와 R23 부록 A/B를 따른다.

| 요청·본문                                                                                                | 권한                                                | 성공                                                                         |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| POST /auth/flows `{restart_from:[]}`                                                                     | Origin·초기 IP 제한, 이전 흐름 재시작 조건 재검사   | 201 `{flow_id,revision,expires_at}`; 쿠키 없음                               |
| POST /auth/flows/{f}/recovery-cookie                                                                     | 최초 미준비 흐름·Origin·초기 제한                   | 201 `{flow_id,revision,recovery_csrf_token,expires_at}` + R                  |
| POST /auth/flows/{f}/ready `{expected_revision:r}`                                                       | R·복구 CSRF                                         | 200 `{flow_id,revision,expires_at,ready:true}`                               |
| POST /auth/flows/{f}/abandon                                                                             | 한 번도 ready 아님·Origin·초기 제한; 순번 면제      | 200 `{restart_eligible:true}`                                                |
| GET /auth/recovery-context                                                                               | 증명된 S 또는 R만 탐색                              | 200 `{items:[{flow_id,revision,proof_kind}]}`; 증명 없음은 빈 배열           |
| GET /auth/flows/{f}/recovery-csrf                                                                        | R                                                   | 200 기존 복구 토큰/순번/만료, 회전·연장 없음                                 |
| POST /auth/flows/{f}/recovery-cookie/rotate `{expected_revision:r,expected_session_generation:g}`        | 현재 S·세션 CSRF                                    | 201 R 결과+새 R; 미종결 종결/옛 R 폐기 원자 처리                             |
| GET /auth/flows/{f}/restart-eligibility                                                                  | 자격증명 불필요                                     | 200 `{restart_eligible:boolean}`만; 활성 흐름 변경 없음                      |
| POST /auth/transitions `{flow_id,transition_id,kind,expected_revision,expected_session_generation}`      | 작업별 S 또는 최초 익명 발급 R, 해당 CSRF·준비 완료 | 201 `{flow_id,transition_id,kind,revision,permit_expires_at}`                |
| POST /auth/anonymous-session `{expected_revision:r}`                                                     | R·복구 CSRF·사전 허가/연결 헤더                     | 201 `{flow_id,revision,session_generation,csrf_token,expires_at}` + S        |
| GET /auth/csrf                                                                                           | 현재 S·flow ID, 예상 순번/세대는 생략 가능          | 200 `{csrf_token,expires_at}` + 현재 인증 메타데이터; 새 S 발급 없음         |
| GET /auth/flow-state `?transition_id=t`(선택)                                                            | R·flow ID; 예상 순번/세대 불필요                    | 200 AuthFlowState, 아래 상태 필드                                            |
| POST /auth/transitions/{t}/settle `{flow_id,expected_revision:r}`                                        | R·복구 CSRF                                         | 200 `{flow_id,revision,transition_id,result}`; 늦은 실행 차단·기존 성공 보존 |
| POST /auth/transitions/{t}/discard-session `{flow_id,expected_revision:r,expected_session_generation:g}` | R·복구 CSRF·그 성공의 미수령 세션                   | 200 `{flow_id,revision}`; 다른 최신 S로 치환 금지                            |
| POST /auth/flows/{f}/reset `{expected_revision:r,expected_session_generation?:g}`                        | 명시적 선택·S/R·대응 CSRF; S는 세대 필요            | 200 `{restart_eligible:true}`                                                |

AuthFlowState: `flow_id, revision, server_time, expires_at, recovery_ready, session_generation, session_cookie_present, last_identity_change_revision, pending_transition, requested_transition, next_transition_id`. 전환 조회 가능은 `{transition_id,availability:'available',kind,state,permit_expires_at,result_session_generation,failure_code}`, 조회 불가는 `{transition_id,availability:'unavailable',execution_blocked}`다. 상태는 admitted/executing/succeeded/failed/cancelled/expired이며 unavailable은 실패 상태가 아니다.

일반 보호 요청과 응답은 `X-EduVibe-Flow-Id`, `X-EduVibe-Auth-Revision`, `X-EduVibe-Session-Generation`을 검증·대조한다. 실행 요청에는 `X-EduVibe-Transition-Id`, unsafe 요청에는 대응 `X-CSRF-Token`을 추가한다. 접수 전 ID의 순번과 실행 시 접수 후 revision을 혼동하지 않는다. 본문/경로가 같은 문맥을 제공하면 중복 헤더를 강제하지 않으며 둘 다 오면 일치해야 한다. 연결 헤더 없는 공개 요청은 쿠키가 와도 익명 범위, 불완전한 문맥은 422다.

### 오류와 기존 계약의 정합화

| 상태/code                                                                                                          | 사용자/서비스 처리                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 400 BAD_REQUEST / 413 PAYLOAD_TOO_LARGE / 422 VALIDATION_ERROR                                                     | 잘못된 JSON·UTF-8 바이트 상한·필드 오류 분리, 몰래 절단 없음           |
| 401 INVALID_CREDENTIALS / AUTH_REQUIRED / RECOVERY_REQUIRED                                                        | 입력 실패·S 없음·R 없음 구별, 일괄 전역 로그아웃 금지                  |
| 403 ACCOUNT_NOT_APPROVED / TEMP_PASSWORD_EXPIRED / PASSWORD_CHANGE_REQUIRED / SESSION_KIND_NOT_ALLOWED / FORBIDDEN | 승인·임시 만료·변경 전용·세션 종류·역할 제한 분리; 비공개 404 우선     |
| 403 ORIGIN_REJECTED / CSRF_INVALID                                                                                 | 자동 재전송 없음; 상태/토큰 확인 후 사용자 제출                        |
| 409 ALREADY_AUTHENTICATED / LOGIN_ID_TAKEN                                                                         | 먼저 로그아웃 또는 입력 수정                                           |
| 409 AUTH_STATE_CHANGED / AUTH_TRANSITION_PENDING / AUTH_COOKIE_BUDGET_EXCEEDED                                     | 상태 재확인·종결 또는 쿠키 정리 후 재관측, 현재 쿠키 임의 폐기 없음    |
| 409 USER_STATE_CONFLICT / OPERATION_KEY_MISMATCH 등 R24 업무 오류                                                  | 인증 전환 결과와 별개로 원래 키 조회·현재 대상 확인                    |
| 429 RATE_LIMITED                                                                                                   | 서버 retry_at 안내; 차단 요청으로 창 연장 없음                         |
| 503 AUTH_BUSY / DB_BUSY / SERVICE_UNAVAILABLE                                                                      | 통제된 장애, 포화 Retry-After:1, 자동 쓰기 replay 없음                 |
| 응답 유실·본문 파손·중간 proxy 실패                                                                                | ServiceError.outcome=unknown; HTTP 상태만으로 과거 작업 실패 확정 금지 |

관리자 통계는 현재 정본의 `/admin/users` 응답 `stats`를 사용하며 `admin_summary` capability를 별도 `/admin/summary` endpoint로 오해하지 않는다.

구현 시 수정해야 할 문서화 차이: `/auth/recovery-cookie/rotate` summary의 full 한정 문구는 R23의 유효한 현재 S 권한과 대조하고 change_only/anonymous를 임의 배제하지 않는다. `/auth/logout`의 필수 헤더 선언은 no-S 204 예외를 표현해야 한다. 인증 endpoint의 400/403/409/413/422 등 누락 응답 선언, 실제 성공 메타데이터, change_only Self의 연락처 필드 금지를 R7/R23에 맞춘다. #23과 충돌하는 현재 OpenAPI 문구를 새 정책으로 계승하지 않는다. 이 문서 작업에서는 contracts를 수정하지 않았다.

## 세션·쿠키·CSRF와 실패 흐름

1. 공개 방문은 인증 준비를 기다리지 않는다. auth_login 비활성/필수 기능 실패면 보호 기능을 막되 공개 탐색은 유지한다. API 시작은 앱 소유 데모 키 `eduvibe-archive-coty2026`, `eduvibe-archive-mock-v1`만 정리하고 `eduvibe-auth-flow-v1`은 보존한다.
2. 지원 환경에서 `eduvibe-auth-v1:api` Web Lock 획득→공유 기록 재독→서버 상태 확인. 처음에는 ID 발급→공유 저장→R 발급→복구 CSRF로 ready 수령 확인을 완료한다. localStorage에는 비밀 없는 ID/순번/진행 표시만, 토큰은 메모리만 사용한다.
3. 전환 ID를 먼저 저장하고 사전 접수해 60초 허가를 받는다. 익명 S 발급 후 가입/로그인에 세션 CSRF를 쓴다. GET csrf/me/flow-state는 조회만 하며 인증이나 활동 수명을 연장하지 않는다. 초기 흐름 생성·R 최초 발급·abandon은 합산 IP 200/rolling 15분, 익명 S 신규 발급도 R7의 별도 200/15분 한도를 지킨다.
4. 인증 변경과 결과 기록은 한 DB commit. S/R 쿠키는 commit 뒤 전송한다. 운영 이름은 `__Host-eduvibe_session_<flow_id>_<issued_seq>` 및 `__Host-eduvibe_recovery_<flow_id>_<issued_seq>`; Secure·HttpOnly·SameSite=Lax·Path=/·Domain 없음·Expires/Max-Age 없는 비영속 쿠키다. 명시적 HTTP localhost/loopback만 `eduvibe_session_dev_...` / `eduvibe_recovery_dev_...`와 Secure 예외를 쓴다.
5. 응답을 받았어도 flow-state로 종결·현재 S 실제 인입을 확인하고 me/CSRF를 조회한 뒤 보호 화면을 연다. 미종결은 settle, 성공+미수령은 해당 결과 세션 discard→폐기 확인→다시 로그인한다. 성공한 비밀번호 변경을 되돌리지 않는다. `keepalive:true`·blind retry로 해결하지 않는다.
6. R 유실+S 유효는 CSRF 조회→R rotate→ready. ID만 남으면 eligibility가 허용할 때까지 공개만; 30분은 마지막 서버 인정 활동 기준이라 유실부터 최대 30분 보장이 아니다. ID 유실+증명 있음은 대상 목록을 저장한 뒤 명시적 reset, 일부 완료/응답 유실은 원래 목록 전부의 eligibility를 확인한다. 모두 유실은 새 방문 예외이며 옛 요청 취소를 주장하지 않는다.
7. 결과 보관 종료는 unavailable로 알린다. 서버의 execution_blocked 확인·미종결 없음·현재 상태 확인을 모두 만족할 때만 보류를 푼다. 현재 S도 없으면 유효 R에 의한 명시적 reset을 제공한다. 기록 부재만으로 실패나 완료를 판정하지 않는다.
8. 탭 숨김/blur·인증 알림 때 보호 본문·개인 헤더·제어를 가린다. 복귀/pageshow/history마다 알림 유무와 무관하게 확인한다. 이전 요청 취소+관찰 세대 비교로 늦은 응답을 버린다. A→로그아웃→A도 이력 변화면 초안 폐기; 동일 회원·동일 흐름·동일 identity-change 순번·현재 권한이 증명될 때만 같은 탭 메모리 초안을 복원한다.
9. 정상 재시작은 미종결 실행을 cancelled로 차단한 후 인증 readiness, 성공·유효 S와 원래 시계는 유지한다. 백업 복원은 모든 과거 인증 권한/허가 폐기와 재삭제 확인 후 재개한다. 정리 작업 실패·차단 목록 무결성 실패를 준비 완료로 덮지 않는다.

## capability 활성화와 프런트 연결

구현 여부·검증 상태·운영 제한을 기존 `{enabled,reasons}`에 반영한다. `not_implemented`, `verification_pending`, `operational_restriction`, `collection_disabled`를 기존 의미대로 사용하고 새 임의 phase flag를 만들지 않는다. 메타는 기능 준비의 안내이지 권한 증명이 아니며 직접 API도 매 요청 검사한다.

- `apps_read`는 유지. 준비 안 된 인증 때문에 공개 화면이 실패하지 않는다. 저장된 알려진 흐름의 복원이 필요한 경우에만 서버 재확인을 연결하며 공개 데이터 요청은 이에 종속시키지 않는다.
- `auth_login`, `auth_logout`, `auth_password_change`는 T01~T03의 정상/복구·만료·실제 쿠키 검증과 CLI 첫 변경 연결을 갖춘 묶음으로 시험 환경에서 활성화한다. 중간 작업 브랜치에서는 시험 전용 준비된 경계를 검증하고 일반 실행의 flag는 false로 유지한다.
- `auth_register`, `admin_users_read`, `admin_approval`, `admin_summary`는 T04~T05의 가입→승인 순환과 정리/감사까지 갖춘 뒤 함께 활성화한다. 신규 가입자만 받고 승인할 경로가 없는 상태를 만들지 않는다.
- 운영 공개는 T07의 필수 브라우저/호스트/시각/운영 증거까지 충족해야 한다. 로컬 테스트 성공을 공개 검증 통과로 올리지 않는다. 인증 활성 설정에서 차단 목록 누락·무결성 실패는 R15대로 기동 거부; 시작 후 인증 조정 검증 실패는 인증 기능/준비 상태 실패로 처리한다. `/healthz`·`/readyz`의 기존 status-only 응답은 유지한다.
- `admin_reauth`, `admin_password_reset`, `admin_user_delete`, `apps_create`, `apps_update_own`, `apps_delete_own`, `admin_apps_read`, `admin_apps_manage`, `health_read`, `health_check`, `health_batch`는 false. 이메일/전화 수집도 false다. 성공 stub을 만들지 않는다.

프런트는 [auth-service](../../frontend/src/services/auth-service.ts)의 Promise 인터페이스 및 공통 mapper를 유지한다. [app](../../frontend/src/app/app.jsx)의 mock 전용 restoreAuth/beginAuthTransition/초기 상태/상세 query·가림 조건을 mode와 capability에 맞게 바꾸고, API 실패→mock fallback은 금지한다. 현재 build alias·Vite `/api` 프록시를 재사용한다. 정상 서비스 오류와 계약 파손을 구별하고 회원별 캐시 키는 mode·내부 ID·역할·세션 종류·관찰 세대를 포함한다. 보호 자료는 브라우저 영속 캐시에 넣지 않는다.

## basic_design 화면 일치 기준

원본 [view-auth.jsx](../../basic_design/view-auth.jsx)의 최대 420px 단일 인증 카드·EV 배지·제목·로그인/가입 세그먼트·입력/오류/주 CTA와 [app.jsx](../../basic_design/app.jsx)의 57px 헤더·푸터·갤러리 이동 구조를 유지한다. “아이디=닉네임”, 4자 데모 암호, 데모 계정 표시를 실제 인증 요구로 가져오지 않는다.

[ui-deviations](../ui-deviations.md)의 **차이 / 제품 동작 / 이유와 근거** 관례로 구현 때 다음을 기록한다. 이번에는 이 파일이나 기준 이미지를 변경하지 않는다.

| 차이 분류                | 유지할 제품 동작·검증                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| UI-D01 가입 필드         | 아이디→비밀번호→확인→별명→선택 이메일→선택 연락처 순서, 필수/선택 label·필드 오류, 확인값 미전송          |
| UI-D02 별명              | 헤더/작성자는 별명, 아이디/내부 ID와 분리, 중복 별명 허용                                                 |
| UI-D03·07 확인/가림/오류 | 기존 EmptyState·버튼으로 확인 중/실패/다시 확인·접근 제한. 가린 자료는 DOM 접근성/키보드에서도 제외       |
| UI-D04 데모 표시         | API 번들/화면에서 공개 데모 자격증명 제외, mock 전용 표시 유지                                            |
| UI-D08 선택 수집         | 수집 비활성 안내, 미설정 운영 주소를 발명하지 않음                                                        |
| UI-D09 관리자 목록       | 기존 인라인 승인·페이지 추가/오류/명시적 결과 확인 유지, 새 대시보드 없음                                 |
| 기존 변경 전용·복구 상태 | 원본 대응 화면이 없으면 product-only 회귀로 명시. 새 비밀번호·확인 및 종결/초기화 안내를 기존 카드에 연결 |

1440×1000, 1024×900, 768×1024, 390×844, 360×844에서 로그인 정상/필드·자격증명 오류/진행·중복 클릭/통신 실패/가입·대기/수집 비활성/변경 전용/가림·복원/미확정·미수령/관리자 승인 상태를 비교한다. 고정 renderer·DPR·ko-KR·Asia/Seoul·폰트·시계·animation 조건과 독립 원본 캡처를 유지한다. source 비교와 product-only 회귀를 구분하고 차이를 baseline 변경이나 허용 오차 확대로 숨기지 않는다. 키보드 순서·focus·label·접근 이름·오류 연결도 확인한다. 코디네이터의 설계 자동 승인은 DomineYH의 실제 시각 검수·공개 수락을 대신하지 않는다.

## 구현 슬라이스

각 슬라이스는 계약→서비스/mapper→실제 HTTP/파일 DB→기존 제품 화면 또는 CLI의 관찰 결과로 닫힌다. 아래 신규 테스트 파일명은 **계획 대상이며 현재 존재/통과를 주장하지 않는다**. 기존 mock E2E를 실제 쿠키 검증으로 계산하지 않는다. backend 명령은 backend 디렉터리, npm 명령은 저장소 루트에서 실행한다. 한 API E2E runner가 포트·임시 DB·migration·합성 fixture·서버 종료를 소유하며 같은 포트 실행은 직렬화한다.

### T01 — 실제 인증 준비·익명 CSRF·준비 실패 안내

- What to build: 회원 인증 스키마와 R/S/흐름/전환 영속 경계, 준비·익명 발급·조회·복구 경로를 authService와 기존 인증 카드의 준비/실패 안내까지 연결. 단순 scaffold 인계 금지.
- Blocked by: 없음. R7/R23/R15 및 현재 Phase 2 기반 계승.
- Acceptance criteria: ID 공유 저장 전 R 발급 요청 없음, R 수령 확인 전 전환 불가, GET csrf로 발급/연장 없음, Origin/CSRF 예외 3개만 적용, 이름·예산·60초/순번·미종결 한 건 제약, 미지원 환경에서 공개 읽기 유지. 기존 데이터 migration 충돌은 중단하며 DB/공개 DTO 보존. API auth 계약 불일치 정합화.
- 검증: `APP_ENV=test uv run --frozen pytest tests/contracts/test_auth_flow.py tests/test_auth_migrations.py tests/contracts/test_public_meta_health.py`; `npm --prefix frontend run test:e2e:api -- auth-prepare.spec.js`.

### T02 — 승인 회원 로그인·me·새로고침·로그아웃

- What to build: 합성 승인 회원의 실제 Argon2 검증→full 세션→쿠키 재관측→별명 헤더→복원/로그아웃. 미승인·오류·만료도 기존 화면에 연결.
- Blocked by: T01.
- Acceptance criteria: 절대/비활동 만료 경계, 더미 해시·rolling 제한·본문 상한·해싱 포화, 인증 성공 전후 account_version 경합 검사, 계정 전환은 로그아웃부터. 정상 재시작 뒤 성공/유효 S 유지, 다중 기기 로그아웃 격리. 브라우저 종료를 로그아웃으로 안내하지 않음.
- 검증: `APP_ENV=test uv run --frozen pytest tests/contracts/test_auth_login.py tests/test_auth_limits.py tests/test_auth_restart.py`; `npm --prefix frontend run test:e2e:api -- auth-login.spec.js`.

### T03 — 관리자 CLI→변경 전용 로그인→본인 변경

- What to build: R15 대화형 bootstrap-admin/recover-admin, 임시 비밀번호 인증과 기존 password-change 카드, 본인 변경 후 full.
- Blocked by: T02.
- Acceptance criteria: 관리자 0명 조건/아이디 충돌·일반회원 승격 금지, 숨김 입력·비밀 비출력, 감사 실패 전체 rollback. recovery는 기존 관리자만·기존 세션 폐기. 24시간 임시 암호/짧은 change_only, 최종 commit 시 만료/폐기 거절, 새 암호는 임시 암호와 달라야 함, 완료 브라우저만 새 full·다른 제한 세션 폐기. 관리자 본인 변경 완료부터 full 절대 8시간/비활동 30분과 recent-auth 15분을 시작한다. 변경 응답 유실은 결과 확인하며 암호를 되돌리지 않음.
- 검증: `APP_ENV=test uv run --frozen pytest tests/test_admin_bootstrap.py tests/contracts/test_auth_password.py`; `npm --prefix frontend run test:e2e:api -- auth-password.spec.js`.

### T04 — 가입·최초 승인 대기·만료 안내와 정리

- What to build: 가입 폼→정규화/차단 목록/중복 제약→미승인 DB→대기 화면, 선택 수집 거부와 최초 대기 만료 처리까지 연결.
- Blocked by: T01, T02(실제 로그인 거절로 승인 대기 관찰).
- Acceptance criteria: Unicode/NFC·공백·code point·별명 중복, 동시 동일 login_id_key 한 건, 오류 시 부분 계정 없음. 비밀번호 확인 미전송·권한 필드 거부, 회원 인증 세션 발급 없음·기존 익명 S 유지, 정확한 비밀번호만 대기 안내. 90일 계산/가입일 보존, 최초 승인과 삭제 경합, 과거 승인 해제 회원 보존·재삭제 기록 확인. support null 안내 유지. 일반 실행 auth_register는 T05 완료까지 비활성.
- 검증: `APP_ENV=test uv run --frozen pytest tests/contracts/test_auth_register.py tests/test_pending_retention.py`; `npm --prefix frontend run test:e2e:api -- auth-register.spec.js`.

### T05 — 관리자 승인·해제와 가입자의 로그인 완주

- What to build: 기존 사용자 탭·실제 통계→대상 재조회→작업키 승인/해제→가입자 로그인/기존 세션 차단까지 연결.
- Blocked by: T03, T04.
- Acceptance criteria: 일반/change_only/R 단독 관리자 접근 거부, 관리자 계정 보호, 연락처 기본 목록 비노출. 동일 키 중복 한 번 반영·이미 확정된 키 재실행은 409 OPERATION_ALREADY_RESOLVED 후 결과 조회, 다른 키 동일 버전은 한 건만 성공, 같은 승인값도 새 수락이면 버전 증가. 승인 이력·업무·전체 세션 폐기·감사·결과 원자성, 응답 유실 결과 조회/명시적 취소, 취소 대 성공 양방향 경합·업무키 24시간 경계와 만료 후 1시간 내 정리. 해제 후 옛 세션 모두 거부·재승인으로 복구 없음·공개 앱 유지. 가입→승인→로그인→새로고침→로그아웃 E2E 완주.
- 검증: `APP_ENV=test uv run --frozen pytest tests/contracts/test_admin_approval.py tests/test_approval_races.py`; `npm --prefix frontend run test:e2e:api -- admin-approval.spec.js auth-lifecycle.spec.js`.

### T06 — 비공개 상세·계정 전환·보호 화면 격리

- What to build: 상세 HTTP 소유권과 app의 인증 관찰/가림/캐시를 실제 세션에 연결. 공개 목록의 기존 의미는 유지.
- Blocked by: T02, T05.
- Acceptance criteria: 익명/회원 A/B/관리자 및 change_only 직접 API 비교, 없는/무권한 비공개 동일 404. 옛 탭 요청에 새 회원 쿠키가 실려도 흐름/세대/순번 거부. focus/history/pageshow 재확인 실패 시 가림, A→로그아웃→A의 옛 초안 복원 금지. capability false/메타 실패·공개 방문의 인증 비종속 회귀, return_to 엄격 검증과 복귀 전 현재 가용성/권한 확인.
- 검증: `APP_ENV=test uv run --frozen pytest tests/contracts/test_auth_access.py tests/contracts/test_public_apps.py`; `npm --prefix frontend run test:e2e:api -- auth-access.spec.js apps.spec.js detail.spec.js meta.spec.js`.

### T07 — 실제 쿠키 경합·복구·재시작과 공개 gate

- What to build: T01부터 갖춘 복구를 실제 브라우저/지연 HTTP와 DB 중단 경계에서 결합 검수하고 제한/재확인 화면까지 확인. 마지막에 보안 기능을 새로 붙이는 티켓이 아니다.
- Blocked by: T01~T06. 로컬 검수는 U01/U02와 독립 진행, 실제 공개는 해당 조건 해소 필요.
- Acceptance criteria: R23 §8 전체 적용 사례의 서버 상태·DB commit·쿠키 인입·화면을 연결. 실행권 전/해싱 중/commit 전후/헤더 전후/본문 중 탭 종료·응답 유실, 중복/늦은 옛 S·R, S 미수령·축출, ID/R 유실 각 분기, 부분 reset, unavailable, 쿠키 한도, 경계 시각, 재시작 cancelled·성공 보존, 백업 복원 무효화. 실험용 route.fulfill/mock 결과는 실제 Set-Cookie 경합 증거로 대체하지 않음.
- 검증: `APP_ENV=test uv run --frozen pytest tests/test_auth_races.py tests/test_auth_restart.py tests/test_auth_retention.py`; `npm --prefix frontend run test:e2e:api -- auth-recovery.spec.js auth-races.spec.js`; 아래 공통 회귀/시각 검사.
- 공개 조건: Windows Chrome/Edge/Firefox, macOS Safari 실기기, Android Chrome 실기기, iOS Safari 실기기 모두 당시 안정 버전 기록·동일 출처 HTTPS/proxy·적용되는 HTTP/2 시험. 필수 기능은 SecureContext·Web Locks·localStorage 읽기/쓰기/변경 이벤트·Fetch·AbortController·쿠키 수령 실제 동작으로 확인한다. 호스트 해싱/잠금·신뢰 proxy/client-IP·정리/복원·운영 준비·사람 시각 수락 중 미실행/실패가 있으면 인증 공개 보류.

### 공통 회귀와 증거

공유 API/schema/회원 모델/인증 관찰 변경이므로 관련 공개 읽기·seed·기존 mock 인증·관리자 테스트의 영향도 함께 평가한다. 개발 중 각 슬라이스 대상을 실행하고, 통합 완료 때 backend 전체 `APP_ENV=test uv run --frozen pytest`를 한 번 실행한다. frontend는 아래 대상/관련 통합 검증 및 현재 범위 CI를 실행하며 반복 전수 실행을 기본으로 삼지 않는다.

```bash
# backend에서 실행
uv run --frozen ruff check .
uv run --frozen ruff format --check .

# 저장소 루트에서 실행: 현재 존재하는 검사
npm --prefix frontend run test -- tests/api-auth.test.ts tests/auth-service.test.ts tests/auth-route.test.ts tests/auth-view.test.jsx tests/admin-service.test.ts tests/admin-api.test.ts tests/admin-mappers.test.ts tests/mappers.test.ts tests/openapi-contract.test.js
npm --prefix frontend run test:e2e -- e2e/auth.spec.js e2e/auth-recovery.spec.js e2e/admin.spec.js
npm --prefix frontend run test:visual -- visual/auth.spec.js visual/admin.spec.js
npm --prefix frontend run check
npm --prefix frontend run build
npm --prefix frontend run check:dist
npm --prefix frontend run check:reference
```

API E2E runner의 현재 인증 unavailable fixture와 테스트를 true/false 두 조건으로 확장한다. 테스트 소유 임시 파일 SQLite만 사용하고 시작/종료·재시작 시 fixture 재주입 여부를 명시한다. 외부 사이트 송신은 차단한다. 실측 로그에는 비밀·원문 DB를 첨부하지 않으며 안전한 ID/상태/명령/환경/최초 실패→수정→재검증을 남긴다. 검수 원장에 요구·사례·기대 결과·HTTP/DB/화면 증거·합격/실패/미실행/차단·적용 제외 이유를 기록한다. 정상 검사에서 lockfile·생성 타입·시각 baseline을 자동 갱신하지 않는다.

## 미결과 인계 한계

- **U01:** 실제 지원 주소·운영 준비·필수 실기기 검수의 구체값/담당 일정은 저장소에서 정할 근거가 없다. 서비스 운영자의 설정·준비 증거와 사람의 실제 수락이 필요하다. 로컬 합성 자료의 구현/검수는 가능하지만 실제 가입/인증 공개를 승인한 것은 아니다.
- **U02:** 고정 차단 목록의 출처·버전·무결성은 R15에서 확정됐으므로 재선정하지 않는다. 재배포 권리 검증은 남아 있다. 개별 준비는 승인된 경로로 시험하되 배포 이미지/패키지 포함을 자동 승인하지 않는다.

이는 미정인 인증 정책이 있다는 뜻이 아니다. 선택 연락처 수집 비활성, Phase 5 기능 유예, 실제 브라우저 검수 조건은 확정된 경계다. 상위 결정과 충돌하는 새 정책은 채택하지 않았으며 현재 계약 선언의 차이는 해당 resolution에 맞추는 구현 작업으로 기록했다. 문서 작성 중 제품 테스트는 실행하지 않았고 이 계획의 검증 명령을 PASS로 표시하지 않았다.

[R7]: https://github.com/DomineYH/vibe_coding_archive/issues/7#issuecomment-5775997962
[R23]: https://github.com/DomineYH/vibe_coding_archive/issues/23#issuecomment-5806449465
[R9]: https://github.com/DomineYH/vibe_coding_archive/issues/9#issuecomment-5778334008
[R15]: https://github.com/DomineYH/vibe_coding_archive/issues/15#issuecomment-5808935379
[R24]: https://github.com/DomineYH/vibe_coding_archive/issues/24#issuecomment-5806786959
