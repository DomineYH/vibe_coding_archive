# 탭 종료·늦은 쿠키 응답을 견디는 인증 전환 프로토콜 조사 (개정 5판)

이 문서는 [이슈 #26(탭 종료·늦은 쿠키 응답을 견디는 인증 전환 방식 조사)](https://github.com/DomineYH/vibe_coding_archive/issues/26)에 대한 기술 사실 조사 보고서의 개정 5판(r5)이다. 선행 의존 결정인 [이슈 #23(동일 브라우저 인증 전환의 탭 종료·응답 유실 계약 확정)](https://github.com/DomineYH/vibe_coding_archive/issues/23), [이슈 #7(Q24~28·Q39)](https://github.com/DomineYH/vibe_coding_archive/issues/7#issuecomment-5775997962), [이슈 #12(화면·비동기 서비스·API 사이의 누락 계약 확정)](https://github.com/DomineYH/vibe_coding_archive/issues/12#issuecomment-5790590858)의 계약을 상위 입력으로 수용한다.

초판(r1)~4판(r4)에 대한 코디네이터와 독립 검토자(codex gpt-6-sol)의 5차 재검토 피드백을 반영하여, **(1) BroadcastChannel postMessage의 WHATWG HTML § 9.5 규격 정합화(적격성·동일 스토리지 키·채널명 기준 선별 및 큐잉 태스크 실행 시점 closed 검사), (2) RFC 6265bis § 6.1 규격 원문 정합화(도메인당 50개·전체 3000개 개수 한도 및 임의 축출 명시, '호스트당 개수 및 총 용량' 표현 정정), (3) 후보 3의 '권장' 라벨 철회 및 기본 골격 후보(안전성 미입증, 인간 결정 대기) 명시, (4) 선택지 B의 직접 덮어쓰기 방지와 전체 인증 격리 미검증 한계 규명, (5) 하네스 프로세스 그룹 격리 및 검증**을 완료하였다.

> [!NOTE]
> 본 보고서는 **[문서 근거]**(W3C/WHATWG 표준 명세, IETF RFC, Chromium 공식 문서 및 소스코드), **[실제 재현 결과]**(Google Chrome 144 헤드리스 환경에서 실제 HTTP 통신으로 측정·단언한 실측 결과), **[추론]**(표준과 실측에 기반한 논리적 도출), **[미검증]**(실측 제약상 확인되지 않아 후속 검증 또는 사람의 결정이 필요한 항목)을 엄격히 구분하여 서술한다. 모의 객체(mock) 결과는 브라우저 쿠키 경합의 증거로 취급하지 않는다.

---

## 1. 검증 환경 및 1차 출처 목록

### 1.1 검증 환경
- **OS / Platform**: Linux (Ubuntu 24.04 LTS on x86_64, Linux 6.6.x kernel)
- **Web Browser (실측)**: Google Chrome `144.0.7559.132` (Official Build, headless, CDP 연동, 독립 프로세스 그룹 격리 및 잔여 프로세스 완전 소멸 검증)
- **Runtime**: Node.js `v22.23.2` (네이티브 WebSocket 및 HTTP 하네스), Python `3.12.3`
- **실측 검수 스위트**: `docs/research/auth-transition-late-cookie/test_browser_behavior.mjs`

### 1.2 1차 출처 목록 (확인 시점: 2026-09-23)
1. **W3C Web Locks API**:
   - 명세: *Web Locks API (W3C Working Draft / Candidate Recommendation)*
   - URL: `https://w3c.github.io/web-locks/` / `https://www.w3.org/TR/web-locks/`
   - 핵심 인용: § 2.6 (Termination of Locks — 문서 언로드 정리 시 lock task queue에 release steps 큐잉 규격), § 2.5 (Lock Requests), § 3 (Security and Privacy Considerations — `[SecureContext]` 필수)
2. **WHATWG Fetch Standard**:
   - 명세: *Fetch Living Standard*
   - URL: `https://fetch.spec.whatwg.org/`
   - 핵심 인용: § 2.4 (Fetch groups & `keepalive: false` 컨트롤러 종료 규격), § 3.1.2 (`Set-Cookie` header 파싱 및 저장 알고리즘), § 4.7 (HTTP-network fetch의 응답 헤더 전송 완료 시점 § 3.1.2 호출 규격. 단, 서버 헤더 송출이 브라우저 저장소 완료와 즉각 동치임을 뜻하지 않음), § 2.2.2 (금지된 응답 헤더)
3. **WHATWG HTML Standard**:
   - 명세: *HTML Living Standard*
   - URL: `https://html.spec.whatwg.org/multipage/`
   - 핵심 인용: § 7.1 (Document lifecycle & unloading document cleanup steps), § 9.5 (Broadcasting to other browsing contexts — 메시징 적격·동일 스토리지 키·채널명 대상 선별 및 큐잉 태스크 실행 시점 closed 검사 규격)
4. **IETF RFC 6265bis**:
   - 명세: *Cookies: HTTP State Management Mechanism (draft-ietf-httpbis-rfc6265bis-15 / latest)*
   - URL: `https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis`
   - 핵심 인용: § 5.7 (Storage Model — `(name, domain, path)` 및 host-only-flag 일치 시 기존 쿠키 교체 규격), § 5.4 (Cookie Name Prefixes `__Host-`), § 5.6.6 (The `HttpOnly` Attribute), § 6.1 (Limits — 도메인당 최소 50개·전체 최소 3000개 개수 한도 및 임의 축출 규격)
5. **WHATWG Cookie Store API**:
   - 명세: *Cookie Store API Living Standard*
   - URL: `https://cookiestore.spec.whatwg.org/`
   - 핵심 인용: § 2.1 (Cookie — `http-only-flag`가 참인 쿠키는 script-visible에서 제외), § 3 (The CookieStore interface — `get`, `getAll`, `set`, `delete`), § 5.1 (`CookieChangeEvent`), § 7.1 (`Query cookies` assertion: cookie's http-only-flag is false)
6. **Chromium Network Stack 소스코드**:
   - 소스 1: `net/url_request/url_request_http_job.cc`
     - URL: `https://chromium.googlesource.com/chromium/src/+/main/net/url_request/url_request_http_job.cc`
     - 핵심 인용: `URLRequestHttpJob::SaveCookiesAndNotifyHeadersComplete()`에서 `CookieStore::SetCanonicalCookieAsync` 비동기 저장 호출 흐름
   - 소스 2: `services/network/url_loader.cc`
     - URL: `https://chromium.googlesource.com/chromium/src/+/main/services/network/url_loader.cc`
     - 핵심 인용: `URLLoader::OnMojoDisconnect()`에서 `NotifyCompleted(net::ERR_FAILED)` 호출 및 `DeleteSelf()` 파기 흐름
7. **IETF RFC 9113 (HTTP/2)**:
   - 명세: *HTTP/2 (RFC 9113)*
   - URL: `https://www.rfc-editor.org/rfc/rfc9113.html`
   - 핵심 인용: § 5.1 (Stream States & `RST_STREAM` 프레임 규격)

---

## 2. 확정 입력 및 제약 조건 (불변 제약)

본 조사는 선행 합의된 다음 사항을 수정 불가능한 상위 제약으로 준수한다:

1. **고정 쿠키명 및 속성 ([문서 근거: 이슈 #7 Q11])**:
   - 운영 쿠키명: `__Host-eduvibe_session`
   - 개발 쿠키명: `eduvibe_session_dev` (명시적 HTTP 로컬 개발)
   - 속성: `Secure; HttpOnly; SameSite=Lax; Path=/`, `Domain` 미지정.
   - 쿠키는 `HttpOnly`이므로 브라우저 스크립트(`document.cookie`, `cookieStore`)가 직접 읽거나 쓰거나 삭제할 수 없다.
2. **인증 전환 대상 및 세션/CSRF 회전 ([문서 근거: 이슈 #7 Q11, Q24~28, Q39])**:
   - 전환 대상: 최초 익명 CSRF 발급, 로그인, 로그아웃, 본인 비밀번호 변경, 관리자 재인증.
   - 모든 인증 전환 시 서버 세션과 CSRF 토큰을 반드시 회전(rotation)하고 기존 세션을 무효화한다.
   - 인증 토큰을 `localStorage` / `sessionStorage`에 저장하는 행위는 엄격히 금지된다.
   - 유효 세션의 단순 CSRF 토큰 재조회는 전환 대상에서 제외된다.
3. **동일 브라우저 1회 1전환 직렬화 ([문서 근거: 이슈 #7 Q39])**:
   - 동일 브라우저 내에서 cookie-mutating auth transitions는 한 번에 하나만 수행한다.
   - 타 탭 전환 후 상태를 서버에서 다시 확인하며, 대기 중인 작업이나 이전 사용자의 private/admin 상태를 새 사용자에게 넘기거나 자동 재실행하지 않는다.
4. **사람의 확정 답변 Q1 ([문서 근거: 이슈 #23 진행 기록 comment-5795502106])**:
   - "로그인·로그아웃 등의 결과가 불명확하면, 서버에서 해당 전환의 종료와 현재 인증 상태를 확인할 때까지 새 인증 전환과 회원·관리자 작업을 보류하고 공개 열람만 허용한다. 기다린 시간이 길거나 새로고침했다는 이유만으로 완료를 추측하지 않으며, 상태 확인 실패 시 재확인 안내를 제공한다."
   - 단, 이것이 브라우저의 늦은 쿠키 반영 문제를 자체 해결한다는 사실 판정은 아니다.
5. **사람의 확정 답변 Q2 ([문서 근거: 이슈 #23 진행 기록 comment-5795568004])**:
   - "선택할 인증 전환 방식의 필수 브라우저 기능이 없거나 차단된 환경에서는 로그인·회원·관리자 기능을 막고 공개 열람과 지원 환경 안내만 제공한다. 이미 로그인된 경우에도 보호 자료는 숨긴다. 별도의 호환 방식은 이번 범위에 추가하지 않는다."

---

## 3. [조사 범위 1] 브라우저 기본 프리미티브의 실제 보장 범위와 한계

### 3.1 Web Locks API (`navigator.locks`)의 잠금 수명과 탭 종료
- **잠금 수명 및 자동 해제 알고리즘 ([문서 근거: W3C Web Locks API § 2.6])**:
  명세 § 2.6에 따르면, 문서를 언로드하는 정리 단계(unloading document cleanup steps)가 실행되면 사용자 에이전트는 해당 에이전트의 모든 미해결 잠금에 대해 `lock task queue`에 해제 단계(Release the lock)를 큐잉한다.
- **해제 지연 실측 ([실제 재현 결과: Chrome 144])**:
  - `test_browser_behavior.mjs` TEST 1 실측 결과, 탭 1이 배타적 잠금(`auth_lock`)을 잡은 상태에서 `Target.closeTarget`으로 강제 종료되었을 때, 대기 중이던 탭 2가 잠금을 획득하기까지 걸린 지연 시간은 **6ms ~ 36ms**였다.
- **한계 ([추론])**:
  Web Lock 해제는 이벤트 루프의 태스크 큐를 거치므로 수십 ms의 지연이 존재하며, 무엇보다 **문서의 생명주기**에 종속된다. 따라서 네트워크 트랜잭션의 완결 여부와 무관하게 탭이 닫히면 잠금이 풀린다.

### 3.2 WHATWG Fetch 취소, 문서 종료와 `keepalive` 플래그의 실측 차이
- **`keepalive: false` (기본값)의 동작 ([문서 근거: WHATWG Fetch § 2.4] & [실제 재현 결과])**:
  - 문서가 언로드되면 fetch group이 종료되며, `keepalive: false`인 모든 fetch record의 controller는 `terminate`된다.
  - **헤더 전송 전 탭 종료 (TEST 2A)**: 서버가 응답 헤더를 보내기 전에 탭이 닫히면, TCP 소켓이 닫히며(`writableEnded: false`), 서버가 뒤늦게 헤더를 써도 브라우저 쿠키 저장소에는 **쿠키가 저장되지 않았다(0개)** (`[실측]`).
- **`keepalive: true`의 위험 동작 ([문서 근거: WHATWG Fetch § 2.4] & [실제 재현 결과])**:
  - `keepalive: true`는 문서 언로드 후에도 요청을 백그라운드에서 유지한다.
  - **늦은 좀비 쿠키 덮어쓰기 (TEST 3)**: 탭 1이 `keepalive: true`로 600ms 지연의 `userA_zombie` 요청을 보내고 50ms에 닫힌 뒤, 탭 2가 150ms 시점에 `userB_fresh` 로그인을 마쳤음에도, T=600ms에 탭 1의 응답이 도착하자 **`userB_fresh`가 `userA_zombie`로 덮어써졌다** (`[실측]`).
  - **결론 ([추론])**: 인증 전환 요청에 `keepalive: true`를 사용하는 것은 늦은 좀비 쿠키 덮어쓰기 사고를 유발하므로 **엄격히 금지**되어야 한다.

### 3.3 [실측 검증] 렌더러 헤더 수신 후 탭 종료 / 취소 경합 (Headers-Received Race)
서버의 응답 헤더 송출과 브라우저의 수신을 명확히 구분하여, **렌더러가 헤더를 실제 수신한 이후** 탭이 닫히거나 취소될 때의 동작을 검증하였다:

- **헤더 수신 확인 후 바디 대기 중 탭 종료 (TEST 2B 실측 결과)**:
  - 서버가 HTTP 상태 및 `Set-Cookie` 헤더를 즉시 송출하고 본문(body)을 500ms 지연시켰다.
  - 렌더러의 `fetch()` Promise가 `Response` 객체로 resolve되어 **`window.__headersReceived === true`를 확인한 직후** 탭을 닫았다.
  - **결과**: 탭 종료 전 시점에 이미 쿠키가 저장되어 있었으며, 탭이 닫힌 후에도 **`user_headers_flushed` 쿠키가 쿠키 저장소에 그대로 잔류·유지되었다** (`[실측]`).
- **헤더 수신 확인 후 바디 수신 중 `AbortController.abort()` 호출 (TEST 2C 실측 결과)**:
  - 렌더러가 헤더 수신을 확인(`__headersReceived === true`)한 직후 본문 수신 중 `abort()`를 호출하여 `AbortError`가 발생했다.
  - **결과**: 렌더러의 바디 스트림은 중단되었으나, 브라우저 CookieStore에는 **`user_aborted_after_headers` 쿠키가 이미 저장 완료되어 유지되었다** (`[실측]`).
- **규격 일치성 ([문서 근거: WHATWG Fetch § 4.7, § 3.1.2])**:
  WHATWG Fetch § 4.7은 HTTP 응답 헤더가 전송 완료되는 시점에 본문 스트림과 무관하게 § 3.1.2를 호출하여 쿠키를 파싱·저장하도록 규정한다.
- **결론 ([문서 근거] + [실제 재현 결과])**:
  브라우저 네트워크 프로세스가 응답 헤더를 수신한 이후 시점에는, **렌더러 탭이 닫히거나 스크립트가 fetch를 abort하더라도 이미 저장된 쿠키는 롤백되거나 취소되지 않는다.**

### 3.4 RFC 6265bis 쿠키 저장소 모델과 `HttpOnly` 제약
- **LWW 교체 모델 ([문서 근거: RFC 6265bis § 5.7])**:
  RFC 6265bis § 5.7 "Storage Model"에 따르면, `(name, domain, path)` 및 host-only-flag가 일치하는 새 쿠키가 도착하면 기존 쿠키는 무조건 제거되고 새 쿠키로 교체된다. 브라우저 쿠키 저장소는 순수한 수동적 저장소로서, 세대(epoch)나 버전 검사 기능이 없다.
- **스크립트 격리 ([문서 근거: RFC 6265bis § 5.6.6, WHATWG Cookie Store API § 2.1, § 3])**:
  `HttpOnly` 쿠키는 `document.cookie` 및 `cookieStore` API의 읽기/쓰기/이벤트 감지 대상에서 완전히 제외된다. 클라이언트는 쿠키 저장소의 현재 세션 토큰을 직접 확인할 수 없다.

### 3.5 BroadcastChannel 및 StorageEvent의 신호 유실 범위
- **BroadcastChannel ([문서 근거: WHATWG HTML § 9.5 "Broadcasting to other browsing contexts"])**:
  - WHATWG HTML 규격의 `postMessage(message)` 알고리즘에 따르면, 브라우저는 메시징 적격(`eligible for messaging`), 동일한 스토리지 키(`sourceStorageKey`와 대상 환경 설정 객체의 storage key 일치), 그리고 동일한 채널명(`channel name`) 조건을 만족하는 대상 `BroadcastChannel` 객체들을 선별(`destinations`)한 뒤, 송신 객체를 제외하고 각 대상의 DOM 조작 태스크 소스(DOM manipulation task source)에 글로벌 태스크를 큐잉(queue a global task)한다.
  - 대상의 닫힘 플래그 검사(`closed flag is true`)는 메시지 전송 시점에 대상을 선별할 때가 아니라, **큐잉된 태스크가 각 대상의 글로벌 실행 컨텍스트에서 실제로 실행될 때(when the queued task runs)** 비로소 수행되며, 플래그가 참일 경우 해당 태스크를 즉시 중단(`abort these steps`)한다.
  - 따라서 메시징 비적격 컨텍스트나 태스크 큐잉 이후 새로 열린 탭은 대상에 포함되지 않으며, 태스크 실행 전 탭이 닫혀 `closed flag`가 참이 된 경우 이벤트 전달이 중단되고 영속적인 버퍼링이나 재전송 보장이 없으므로 인증 전환의 상호 배제나 상태 확정의 보증 수단으로 기능할 수 없다.
- **StorageEvent (`localStorage`)**:
  - 비정상 탭 종료 시 이벤트 순서 왜곡 및 유실 위험이 있으며, 불변 제약상 인증 토큰 저장이 금지된다.

---

## 4. [조사 범위 2] 서버 요청 식별·완료 기록·직렬화와 클라이언트 잠금 결합 분석

### 4.1 "서버 commit 완료"와 "브라우저 쿠키 반영 완료"의 비동치성
- 서버 DB 트랜잭션이 commit되었더라도, 응답 헤더가 네트워크를 통과하여 브라우저 네트워크 프로세스에 도달하기 전 소켓이 끊기면 쿠키는 브라우저에 저장되지 않는다.
- 반대로, 서버가 commit 후 응답 헤더를 송출하여 브라우저가 수신했다면 탭이 즉시 닫혀도 쿠키는 브라우저에 남는다.
- 따라서 서버의 commit 기록과 브라우저 쿠키 저장소의 반영 상태는 서로 다른 시점에 비동기적으로 완료되는 독립된 사건이다.

### 4.2 정해진 대기 시간(TTL) 및 현재 `/auth/me` 일치만으로 종결을 증명할 수 없는 이유
- **정해진 대기 시간의 무효성 ([추론])**:
  임의의 타이머(예: 3초)는 네트워크 패킷 지연이나 프록시 버퍼링 지연을 결코 물리적으로 보증하지 못한다.
- **현재 `/auth/me` 단순 일치의 한계 ([추론])**:
  - 관리자 재인증, 본인 비밀번호 변경, 또는 동일 계정 재로그인 시 전환 전후의 사용자 정보(`user_id`, `role`)는 동일하다.
  - 이슈 #7 Q22에 따라 `/auth/me` 응답에는 세션 토큰 리터럴이 노출되지 않는다.
  - 따라서 `/auth/me`가 이전과 동일한 사용자 정보를 반환했다 하더라도, 그것이 "방금 회전된 새 세션이 쿠키에 반영된 결과"인지 "회전 전의 구 세션이 응답한 것"인지 구분할 수 없다.

### 4.3 서버 세션 상태 머신 설계 제안 (Proposal)
동일 세션에 대한 동시 전환 시도를 차단하기 위한 서버 데이터베이스 상태 머신 설계 제안:
- **세션 상태 정의 (제안)**: `active`, `transitioning`, `invalidated`.
- **원자적 전이 (SQLite CAS 쿼리 제안)**:
  ```sql
  UPDATE sessions 
  SET status = 'transitioning', transition_id = :tx_id, transitioning_at = :now
  WHERE session_id = :current_session_id AND status = 'active';
  ```
  - 변경 행 수가 0이면 이미 전환 진행 중이거나 폐기된 세션이므로 동시 요청을 차단한다. (오류 코드는 기존 계약이 아닌 본 조사 제안 사항임).

### 4.4 서버 관찰 쿠키 반영(Server-Observed Cookie Reflection) 확인
브라우저 쿠키 저장소의 실제 반영 여부를 검증하는 유일한 물리적 수단은 **브라우저 네트워크 스택이 `Cookie: __Host-eduvibe_session`을 실어 보낸 HTTP 요청을 서버가 직접 수신·검증하는 것**이다:
1. 서버는 새 세션 발급 시 내부적으로 세션 ID 또는 시퀀스를 기록한다.
2. 새 탭이나 복구 흐름에서 브라우저가 `GET /auth/me`를 호출할 때, 서버는 인입된 세션 ID를 확인한다:
   - **새 세션 ID 수신**: 브라우저 쿠키 반영 완료가 물리적으로 확인됨.
   - **구 세션 ID 수신**: 브라우저에 구 세션이 잔류함. 서버는 이미 폐기된 구 세션에 대해 `401 AUTH_REQUIRED`와 쿠키 삭제(`Max-Age=0`)를 응답하여 잔류 쿠키를 소거함.

---

## 5. [조사 범위 3] 후보군 비교 분석 및 늦은 유효 세션 덮어쓰기 문제

### 5.1 [심층 분석] 늦은 유효 세션 덮어쓰기 (Late Valid Session Overwrite)와 계보 규칙

#### 5.1.1 문제의 본질
초판에서 제시한 "401 + Max-Age=0을 통한 방어"는 **늦게 도착한 쿠키가 이미 서버에서 폐기된 구 세션일 때만 동작**한다. 늦은 `Set-Cookie`가 **신규 생성된 유효한 세션($S_A$)**일 경우 다음 경합이 발생한다:

1. 탭 1이 사용자 A로 로그인 시도 $\to$ 서버가 새 세션 $S_A$를 생성(active/valid)하고 응답 헤더 송출.
2. 탭 1이 닫히며 Web Lock이 해제되고, 지연 등으로 $S_A$가 네트워크/프록시에 머묾.
3. 탭 2가 열려 사용자 B로 로그인 성공 $\to$ 브라우저 쿠키에 $S_B$ 저장.
4. 뒤늦게 탭 1의 $S_A$ 응답 헤더가 브라우저에 도달 $\to$ RFC 6265bis § 5.7 LWW 모델에 따라 $S_B$가 $S_A$로 덮어써짐.
5. 이후 브라우저가 `/auth/me`를 호출하면 브라우저는 $S_A$를 전송하고, 서버는 $S_A$가 유효하므로 **200 OK (User A)**를 반환함.
6. 결과적으로 사용자 B 화면이 사용자 A로 **조용히 둔갑(Silent Identity Switch)**함.

#### 5.1.2 공유 선행 세션($S_1$) 기반 서버 계보(Lineage) 추적과 Fail-Closed 규칙 ([추론])
초판의 "익명 다중 탭을 같은 계보로 묶을 수 없다"는 서술은 오류다. **두 탭이 전환 직전 동일한 쿠키 $S_1$을 공유하고 있었다면, $S_1$ 자체가 두 탭을 묶는 단일 계보의 연결고리(Linkage)가 된다**:

- **전환 기록**: 탭 1이 $S_1$을 제시하며 로그인할 때, 서버는 $S_1 \to S_A$ 관계를 기록하고 $S_A$의 상태를 `unconfirmed`(미확인)로 둔다.
- **선행 세션 재인입(Re-presentation) 감지**: 탭 1의 응답이 유실/지연되어 브라우저에 $S_1$이 남아있는 상태에서 탭 2가 $S_1$으로 새 요청을 보내면, 서버는 **"미확인 후속 세션($S_A$)이 존재하는 상태에서 이미 폐기된 선행 세션($S_1$)이 재인입됨"**을 원자적으로 감지할 수 있다.
- **원자적 사전 무효화 (Fail-Closed Revocation)**:
  서버는 즉시 미확인 후속 세션 $S_A$를 `revoked`(폐기) 상태로 전환한다.
- **늦은 도착 시 결과**:
  이후 늦은 $S_A$가 브라우저에 도착하여 $S_B$를 덮어쓰더라도, 브라우저가 $S_A$를 서버로 전송하는 순간 서버는 $S_A$가 이미 `revoked` 상태임을 확인하고 **`401 AUTH_REQUIRED` 및 `Set-Cookie: Max-Age=0`**을 응답한다.

#### 5.1.3 엄격한 한계 분리: (a) $S_B$ 쿠키 보존 불가 vs (b) 조용한 신원 전환 방지
1. **(a) "$S_B$ 쿠키 보존 불가" (고정 쿠키명 하에서는 불변의 사실)**:
   계보 무효화 규칙을 적용하더라도, RFC 6265bis § 5.7의 LWW 규칙에 의해 브라우저 쿠키 저장소에서 $S_B$는 이미 $S_A$에 의해 물리적으로 지워졌다. 서버가 $S_A$를 거부(401)하더라도 $S_B$가 쿠키 저장소로 마법처럼 복구되지는 않는다. 사용자는 결국 미인증(401) 상태가 되어 재로그인해야 한다.
2. **(b) "조용한 신원 전환 방지" (조건부 달성 가능, [추론]/[미검증])**:
   사용자 B 화면이 사용자 A로 잘못 작동하는 보안 사고는 401 fail-closed로 차단할 수 있다.

#### 5.1.4 조용한 신원 전환 방지(b)마저 실패하는 잔여 사각지대 (Residual Cases) ([추론])
다음 상황에서는 공통 선행 세션 $S_1$이 없거나 재인입되지 않아 계보 규칙으로도 조용한 둔갑을 막을 수 없다:
1. **사전 쿠키 부재 / 최초 동시 익명 발급 (No prior cookie)**:
   브라우저에 기존 쿠키가 전혀 없는 상태에서 탭 1과 탭 2가 동시에 첫 세션 발급/로그인을 시도한 경우 (공통 $S_1$ 부재).
2. **독립 익명 세션 (Independent anonymous sessions)**:
   탭 1은 $S_{anon1}$, 탭 2는 $S_{anon2}$로 서로 다른 익명 세션을 들고 시작한 경우 (계보 분리).
3. **후속 세션 기확인 (Successor already confirmed)**:
   탭 1이 $S_A$를 수신하여 최소 1회 API 호출을 마쳐 서버에서 `confirmed`로 전환된 이후, 탭 2가 이전 캐시된 $S_1$으로 뒤늦게 요청한 경우.
4. **선행 세션 미인입 (Predecessor never re-presented)**:
   탭 2가 $S_1$을 서버로 보내지 않고 독자적으로 다른 경로를 통해 $S_B$로 전이한 경우.

#### 5.1.5 기존 계약과의 양립성 및 판정
- 계보 추적 규칙은 고정 쿠키명과 세션 회전 계약을 형식적으로 깨뜨리지 않고 서버 세션 테이블 확장만으로 구성 가능하나(`[추론]`), $S_B$ 쿠키 유실을 막지 못하고 잔여 사각지대가 존재한다.
- 따라서 **고정 쿠키명 하에서 늦은 유효 세션 덮어쓰기를 100% 완전 방어하는 것은 입증되지 않았음(NOT PROVEN)**을 명시한다.

---

### 5.2 7대 핵심 사건 순서별 전이 매트릭스 비교표

| 사건 순서 | 후보 1: Web Locks 단독 | 후보 2: Web Storage 마커 | 후보 3: Web Locks + Strict Transport + Server CAS (기본 골격 후보) | 후보 4: 동적 세대 쿠키명 |
|---|---|---|---|---|
| **1. 최초 익명 발급** | 두 탭 동시 발급 시 마지막 도착한 익명 쿠키 반영 | 로컬 마커로 직렬화 시도하나 동시 쓰기 경합 | Web Lock으로 활성 탭 직렬화. 후속 탭은 기존 익명 세션 재사용(Q11) | 세대별 쿠키 발급으로 독립 저장 |
| **2. 응답 유실 (서버 commit 후 헤더 전 미도달)** | 브라우저는 구 세션 유지, 서버는 새 세션 생성 | 스토리지 락 고착(Deadlock) 위험 | `keepalive: false`로 소켓 파괴 (`[실측]`). 구 세션은 서버에서 폐기됨. 새 탭 `/auth/me` 호출 시 401 반환 및 쿠키 소거(`Max-Age=0`). 새 세션은 고아화 후 만료. 안전한 미인증 전이 | 새 세대 쿠키 미수신으로 미인증 전이 |
| **3. 늦은 이전 응답 (Late Response)** | **위험**: 지연 응답이 최신 쿠키를 덮어씀 (`[실측]`) | 스토리지 검사로 스크립트 반영은 막으나 HTTP 쿠키 덮어쓰기는 불가 | **조건부 방어**: <br>1) 늦은 응답이 **폐기 세션**인 경우: 다음 요청 시 401 + `Max-Age=0` 소거 (`[문서 근거]`).<br>2) 늦은 응답이 **유효 세션(S_A)**인 경우: **덮어쓰기 방어 불가 (미해결 한계)** (`[추론]`). 계보 규칙 적용 시 fail-closed(401) 가능하나 $S_B$ 유실 불변. | 쿠키명이 달라 직접 덮어쓰기 방지 가능 [추론], 전체 인증 격리 [미검증] |
| **4. 조정 주체 종료 (탭 닫힘/새로고침)** | Web Lock 자동 해제 (6~36ms). 잔여 요청 잔류 시 경합 | 스토리지에 락 플래그 영구 고착. 타 탭 인증 작업 불능 | Web Lock 자동 해제. 헤더 전 미도달 시 소켓 파괴. 단, **헤더 수신 후 닫힘 시 쿠키 반영됨** (`[실측]`). 타 탭은 `/auth/me`로 반영된 상태 확인 | Web Lock 해제, 동적 쿠키 격리 유지 |
| **5. 서버 재시작 (재기동)** | 클라이언트 락 무의미, 서버 세션 유실 시 401 | 스토리지 마커와 서버 상태 불일치 | 영속 SQLite 세션 테이블 조회. 미완료 트랜잭션은 롤백 또는 만료 처리 | 동일 (영속 세션 기준) |
| **6. 새 탭 / 새로고침** | 새로고침 전 완료 추측 불가 | 마커 확인 후 지연 대기 (불필요한 대기) | **인간 Q1 준수**: 새 탭은 추측하지 않고 `GET /auth/me` 호출. 서버 관찰 쿠키 상태에 따라 200 또는 401 미인증 화면 전환 | 새 탭에서 세대 쿠키 상태 조회 |
| **7. 통신 복구 (단절 후 재연결)** | 지연 패킷 도달 시 경합 발생 가능 | 복구 시점 타임아웃 락 해제 충돌 | `[미검증]`: 실제 물리 패킷 단절/복구는 루프백 실측 미수행. 진행 요청은 AbortError 종료되나 지연 패킷 도착 경합은 통신 계층에 종속 | 진행 요청 취소 후 재시도 |

---

### 5.3 폐기 세션 기반 새 세션 부활/복원 모델 (후보 5)의 보안 위험
- 탭 1의 로그인 응답이 유실되었을 때, 새 탭이 이전 익명 세션 `S1`을 제시하여 새 로그인 세션 `S2`를 재발급받는 방식.
- **기각 사유**: 공격자가 피해자의 이전 익명 세션 ID나 폐기된 세션 ID를 알고 있다면, 피해자가 로그인한 직후 해당 폐기 세션 ID로 자격증명 없이 피해자의 계정에 침투할 수 있음 (Session Hijacking / Session Fixation 취약점). 절대 채택 불가.

---

## 6. [조사 범위 4] 지원 환경, 보안 컨텍스트, 제약 및 실제 HTTP 재현 검수

### 6.1 지원 브라우저 및 보안 컨텍스트
- **필수 보안 컨텍스트 ([문서 근거: W3C Web Locks § 3, RFC 6265bis § 5.4])**:
  `navigator.locks` 및 `__Host-` 쿠키 접두사는 **`[SecureContext]`** 전용이다. HTTPS 환경 또는 로컬 개발 환경(`127.0.0.1`, `localhost`)에서만 지원된다.
- **필수 브라우저 기능 검출 목록 (정합화)**:
  후보 3 프로토콜에 실질적으로 요구되는 클라이언트 필수 기능:
  ```javascript
  const isAuthTransitionSupported = Boolean(
    window.isSecureContext &&
    navigator.locks &&
    typeof navigator.locks.request === 'function' &&
    typeof window.AbortController === 'function'
  );
  ```

### 6.2 전송 환경의 제약과 미검증 영역 명시
- **HTTP/1.1 직접 연결 실측 한정**:
  본 조사의 실측은 로컬 단일 프로세스 루프백 HTTP/1.1 환경에서 수행되었다.
- **HTTP/2 다중화 연결 ([미검증])**:
  HTTP/2 환경에서는 탭이 닫힐 때 전체 TCP 연결이 닫히지 않고 해당 스트림에 대해 `RST_STREAM` 프레임이 송출된다. 서버가 `RST_STREAM` 수신 전에 헤더를 보냈을 때 프록시나 네트워크 계층의 프레임 전달 순서는 네트워크 구현에 종속되므로 **[미검증]**으로 분류한다.
- **리버스 프록시(Reverse Proxy) 버퍼링 경로 ([미검증])**:
  Nginx, Cloudflare 등의 리버스 프록시가 중간에 위치하는 경우, 업스트림 서버의 응답 헤더를 프록시가 버퍼링하여 클라이언트에 뒤늦게 전달할 수 있으므로 **[미검증]**으로 분류한다.

---

### 6.3 Google Chrome 144 실측 재현 검수 결과 원문 보고
저장소 검수 스위트(`docs/research/auth-transition-late-cookie/test_browser_behavior.mjs`)를 실행한 실제 원문 출력:

```
[Harness] HTTP server listening on port 8899
[Harness] Connected to Chrome: Chrome/144.0.7559.132

--- TEST 1: Web Locks cross-tab mutual exclusion & tab close release ---
Tab 1 acquired "auth_lock": true
Tab 2 tryLock while Tab 1 alive: false (Mutual exclusion verified)
Tab 2 acquired lock after Tab 1 closed: true (Latency: 27ms)

--- TEST 2A: Tab close BEFORE headers sent (keepalive: false) ---
Server received /slow_auth_pre_headers. Closing tab at 50ms (before headers)...
Socket closed: true (writableEnded: false), Cookie: NONE (0 stored)

--- TEST 2B: Tab close AFTER browser confirms headers received, body pending ---
Renderer confirmed receipt of HTTP response headers: true (Status: 200)
Cookie in CookieStore BEFORE closing tab: "user_headers_flushed"
Closing tab while body is still pending on server...
Cookie in CookieStore AFTER tab closed: "user_headers_flushed"
>>> [OBSERVED FACT] Cookie was stored upon header receipt and persists after tab closure.

--- TEST 2C: AbortController.abort() AFTER browser confirms headers received ---
Renderer confirmed receipt of HTTP response headers: true
Cookie in CookieStore BEFORE calling abort(): "user_aborted_after_headers"
Calling abort() on fetch while body stream is pending...
Renderer fetch error: AbortError
Cookie in CookieStore AFTER AbortController abort: "user_aborted_after_headers"
>>> [OBSERVED FACT] AbortController aborted body stream, but Set-Cookie header was already committed.

--- TEST 3: In-flight fetch WITH keepalive: true -> Late Zombie Overwrite ---
Tab 1 sent keepalive fetch (delay: 600ms). Closing Tab 1 at 50ms...
Cookie at T=150ms (after Tab 2 login): userB_fresh
Waiting for Tab 1 delayed keepalive response at T=600ms...
Cookie at T=800ms: userA_zombie
>>> [OBSERVED FACT] userA_zombie OVERWROTE userB_fresh in CookieStore!

--- TEST 4: AbortController.abort() BEFORE headers sent ---
Request received on server. Calling abort() immediately...
Cookie after abort BEFORE headers: NONE (0 stored)

===============================================================
ALL ASSERTIONS PASSED (6/6 TESTS SUCCESSFUL). EXIT CODE: 0
===============================================================
[Cleanup] Verified: No orphan chrome processes remain for profile dir.
```

---

## 7. [조사 범위 5] 고정 쿠키명 계약 양립성 판정 및 사람의 결정 필요 사항

### 7.1 고정 쿠키명(`__Host-eduvibe_session`) 유지 가능성 판정: **입증 불가 (NOT PROVEN)**
- **기술적 근거**:
  1. RFC 6265bis § 5.7의 단일 고정 쿠키명 수동적 LWW 저장소 모델에서, 서로 다른 두 유효 로그인 응답(`S_A`, `S_B`)이 지연 도착하여 순서가 역전될 경우 $S_B$가 소멸되고 $S_A$로 덮어써지는 현상을 방어할 수 없다.
  2. TEST 2B/2C에서 입증되었듯, 렌더러가 응답 헤더를 수신한 이후 시점에는 탭 종료나 fetch 취소로도 쿠키 저장을 취소할 수 없다.
  3. 따라서 기존의 고정 쿠키명 계약과 세션 회전 계약만으로는 모든 탭 종료/지연 경합 상황에서 100% 안전한 전환을 입증하지 못한다.

### 7.2 사람이 결정해야 할 아키텍처 및 제품 정책 사항 (Human Decisions Needed)

스코프 5 규정에 따라, 시스템이 임의로 정책을 정하지 않고 다음 결정 사항을 사람에게 보고한다:

1. **[아키텍처 계약 결정] 늦은 유효 세션 덮어쓰기 대응 또는 계약 변경 선택**:
   - **선택지 A (기존 고정 쿠키명 유지 + 신원 불일치 감지 및 보호 작업 보류 [미검증])**:
     - 고정 쿠키명(`__Host-eduvibe_session`) 계약을 유지한다.
     - 활성 탭 간에는 Web Lock으로 직렬화하고, `keepalive: false`를 적용한다.
     - 단, 늦은 유효 세션 $S_A$가 유입되면 `/auth/me`는 200 User A를 반환하므로 `/auth/me` 단독으로는 이상을 감지할 수 없다. 따라서 클라이언트가 기대한 사용자 ID와 `/auth/me` 응답 ID의 불일치를 감지하는 로직을 두고, 불일치 시 보호 작업을 전면 보류(hold)하며 사용자 확인을 요구하는 정책을 사람이 명시 승인해야 한다.
   - **선택지 A-1 (선택지 A의 계보 무효화 fail-closed 변형 [추론] / [미검증])**:
     - 선행 세션 $S_1$이 공유된 경우, $S_1$ 재인입 시 미확인 후속 세션 $S_A$를 서버에서 즉시 폐기하여 늦은 $S_A$ 인입 시 401로 차단한다.
     - 단, $S_B$ 쿠키 유실은 막지 못하며, 사전 쿠키가 없거나 독립 세션인 잔여 사각지대가 존재함을 수용해야 한다.
   - **선택지 B (동적 세대 쿠키명 계약으로 변경)**:
     - 이슈 #7 Q11 계약을 수정하여, 전환마다 `__Host-eduvibe_session_<epoch>`와 같이 동적 쿠키명을 사용한다.
     - 구 세대의 늦은 응답이 도착해도 새 세대 쿠키를 덮어쓰지 못하므로 **직접 덮어쓰기 방지 가능 [추론], 전체 인증 격리 [미검증]**.
     - **미설계 및 미검증 한계 (`[미검증]`)**:
       1. **동시 전송 시 세션 선택 규칙**: 브라우저 요청에 여러 세대(epoch) 쿠키가 함께 전송될 때 서버가 어느 세션을 현재 세션으로 선택할지에 대한 규칙이 미정의 상태이다.
       2. **구 세대 쿠키 정리**: 과거 세대 쿠키를 언제 어떻게 소거(cleanup)할지에 대한 메커니즘이 확립되지 않았다.
       3. **쿠키 개수 한도 및 임의 축출 (RFC 6265bis § 6.1)**: RFC 6265bis § 6.1 "Limits"(draft-ietf-httpbis-rfc6265bis-22 기준)는 범용 브라우저가 "At least 50 cookies per domain", "At least 3000 cookies total"의 최소 저장 능력을 제공해야 한다(SHOULD)고 하고, "User agents MAY limit the maximum number of cookies they store, and may evict any cookie at any time (whether at the request of the user or due to implementation limitations)"라고 규정한다. 개별 쿠키의 이름·값 길이 상한은 § 5.6의 별도 규정이다. 따라서 다중 세대 쿠키가 누적될 때 브라우저 축출로 최신 유효 세션 쿠키가 사라질 위험에 대한 방어 설계는 검증되지 않았다 (`[미검증]`).
       4. 따라서 쿠키 정리 로직과 API 규격을 대대적으로 재설계해야 한다.
   - **선택지 C (2단계 티켓 클레임 프로토콜 도입 [미검증])**:
     - `POST /auth/login`은 세션 쿠키를 굽지 않고 일회성 확인 티켓(JSON)만 반환하며, 클라이언트가 준비되었을 때 `POST /auth/session/claim`을 호출하여 쿠키를 수령한다.
     - **한계 명시**: 클레임 응답 역시 고정 쿠키명으로 `Set-Cookie`를 송출하므로, 헤더 수신과 탭 종료 사이의 경합을 동일하게 겪는다. 추가적인 직렬화/확인/폐기 규칙 없이는 선택지 A보다 안전함이 입증되지 않았다.
2. **[UI/UX 정책 결정] 결과 불명확 시 사용자 안내 상태**:
   - 새 탭에서 `/auth/me`가 401(미인증)로 판정되었을 때의 사용자 안내 문구 및 폼 초기화 정책 확정.
3. **[서버 운영 정책 결정] 고아 세션 정리 주기**:
   - 커밋 후 응답이 유실되어 방치된 고아 세션의 조기 폐기(예: 5분 배치) 정책 확정.

---

## 8. 최종 요약

1. **기본 골격 후보**: **후보 3 (Web Locks + Strict Transport [`keepalive:false`] + Server Session CAS)**.
   - 본 후보의 **안전성은 완전하게 입증되지 않았으며(NOT PROVEN)**, 늦은 유효 세션 덮어쓰기 등 미해결 경합 한계가 존재한다.
   - 이러한 미해결 경합 한계에 대응하기 위해 선택지 A / A-1 / B / C 중 어떤 설계를 채택할 것인가는 시스템이 임의로 단정할 수 없으며 **사람이 결정해야 하는 판단 사항(Human Decision)**이다.
2. **실측 사실**:
   - Web Locks는 탭 종료 시 6~36ms 내에 자동 해제된다 (`[실측]`).
   - 헤더 전송 전 탭 종료/취소는 소켓 파괴로 쿠키가 차단된다 (`[실측]`).
   - 그러나 **헤더가 브라우저에 도달하여 수신된 후의 탭 종료/취소는 이미 저장된 쿠키를 롤백하지 않는다** (`[실측]`).
   - `keepalive: true`는 탭 종료 후 지연 패킷이 최신 세션을 덮어씀을 실측 확인하였다 (`[실측]`).
3. **인간 결정 대기**:
   - 단일 고정 쿠키명 하에서의 미해결 경합 한계를 신원 불일치 감지/보류로 다룰 것인지(선택지 A / A-1), 동적 세대명 계약으로 변경할 것인지(선택지 B), 또는 2단계 티켓 클레임 방식을 도입할 것인지(선택지 C) 사람이 결정해야 한다.
