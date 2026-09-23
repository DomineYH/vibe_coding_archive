# 검사 worker의 DNS 포함 deadline·동시성·실행 종료 보장 조사 (개정 4판)

이 문서는 [이슈 #25](https://github.com/DomineYH/vibe_coding_archive/issues/25) 및 [이슈 #14](https://github.com/DomineYH/vibe_coding_archive/issues/14)(Q1~Q22 확정사항), [PRD v1.0 §8.3~8.5, §9~10](https://github.com/DomineYH/vibe_coding_archive/blob/19c38faeb237705af9965eecfaa23f35b1c480ea/PRD/PRD_EduVibe_Archive_v1.0.md), 선행 조사인 [http-ssrf-transport.md](http-ssrf-transport.md)와 [https-response-header-limits.md](https-response-header-limits.md)의 후속 기술 연구 보고서다.

외부 URL 검사를 수행하는 전용 백그라운드 worker 환경에서, **DNS 조회를 포함한 전체 10초 deadline, 동시 검사 앱 최대 3개, 실제 실행 중단 및 소켓/스레드 자원 회수, worker 재시작 및 lease 만료 시 늦은 결과 배제와 안전한 재시도**를 보장할 수 있는 실행 모델을 분석한다.

본 개정 4판은 코디네이터 지침에 따라 다음 세부 사항을 엄격히 정합화하였다:
1. **후보 (iv) Q6 IP 검증 함수 및 실측 시험 정합화**:
   - 금지 IP 판정을 개별 속성 나열 대신 `(not ip.is_global) or ip.is_multicast`로 일원화하고 IPv4-mapped IPv6(`ip.ipv4_mapped`) 재판정 적용.
   - `dns.resolver.NoAnswer`를 빈 목록으로 처리하고, NXDOMAIN·timeout·네트워크 오류만 조회 실패로 처리. 두 목록 모두 비면 차단.
   - 검증된 IPv4가 있으면 첫 번째 IPv4, 없으면 첫 번째 IPv6 선택 (IndexError 방지).
   - 실제 공인 대역 리터럴(`8.8.8.8`, `2001:4860:4860::8888`)을 모의 응답 값으로 사용하여 6대 케이스(224.0.0.1 차단, 100.64.0.1 차단, IPv4+NoAnswer 통과, IPv6 전용 통과, AAAA timeout 차단, 혼합 금지 차단) 단언 실측.
2. **32 KiB 초과 시 래퍼 종료 호출 단언**:
   - `suite.py`의 스트림 래퍼에 `is_closed` 상태를 도입하고, 32 KiB 초과 즉시 래퍼가 설정한 `last_stream.is_closed == True`를 단언(래퍼 종료 호출 확인; 하위 FD 종료는 미검증).
3. **SAN 음성 시험 오류 원인 단언 구체화**:
   - `ssl.SSLCertVerificationError` 및 `Hostname mismatch` 원인을 명시적으로 확인하도록 단언 갱신.
4. **`resolv.conf(5)` 원문 그대로 인용**:
   - Linux man7.org `man 5 resolv.conf`의 timeout 원문 문장을 정확히 교체 수록.
5. **SQLite 시각 서술 정정**:
   - HITL-4의 시각 비교 서술을 `REAL epoch 수치 비교`로 정정.

> [!NOTE]
> 본 보고서는 **[실측]**(테스트 스위트가 실제로 단언·측정한 항목), **[모의 관찰]**(sleep/모의 소켓 기반 관찰), **[1차 출처]**(공식 문서 및 소스 코드 인용), **[추론]**(논리적 분석), **[미검증]**(실측 제약상 확인되지 않아 구현 단계 검증이 필요한 항목)을 명확히 구분하여 기술한다. 모든 로컬 루프백 실험은 관찰 시간 단축과 경계 검증을 위해 단축된 deadline(0.5s~1.2s)을 적용하여 수행되었다.

---

## 1. 검증 환경 및 정확한 소프트웨어 버전

본 조사는 저장소 개발 환경에 설치된 Linux 런타임 및 라이브러리 스택의 소스 코드와 동작을 직접 검증하였다:

- **OS / Platform**: Linux (Ubuntu 24.04 LTS on x86_64, Linux 6.6.x kernel, glibc 2.39)
- **Python**: `3.12.3` (CPython 64-bit)
- **HTTPX**: `0.28.1` ([encode/httpx 0.28.1](https://github.com/encode/httpx/tree/0.28.1))
- **httpcore**: `1.0.9` ([encode/httpcore 1.0.9](https://github.com/encode/httpcore/tree/1.0.9))
- **h11**: `0.16.0` ([python-hyper/h11 v0.16.0](https://github.com/python-hyper/h11/tree/v0.16.0))
- **anyio**: `4.12.1` ([agronholm/anyio 4.12.1](https://github.com/agronholm/anyio/tree/4.12.1))
- **dnspython**: `2.8.0` ([rthalley/dnspython v2.8.0](https://github.com/rthalley/dnspython/tree/v2.8.0))
- **OpenSSL**: `OpenSSL 3.0.13 30 Jan 2024`
- **SQLite**: `3.45.1` (Python `sqlite3` 표준 라이브러리 연동)

---

## 2. 사람이 이미 정한 입력 (불변 제약)

본 조사는 [이슈 #14 진행 기록(미해결)](https://github.com/DomineYH/vibe_coding_archive/issues/14#issuecomment-5793879135)에서 확정된 인간 결정 사항을 상위 불변 제약으로 수용한다:

1. **단일 worker & SQLite 큐**: 서버 전용 worker 1개, 로컬 영속 SQLite 작업 큐(`health_jobs`)를 유지하며 Redis, Celery, 다중 서버를 도입하지 않는다.
2. **HTTP/1.1 & 일회성 연결**: HTTP/1.1만 사용하며 요청마다 별도 클라이언트와 커넥션 풀을 생성한다. 연결 및 세션 쿠키를 재사용하지 않는다.
3. **단일 IP 고정 & SSRF 방어**: 모든 A/AAAA 후보를 사전 검증 후 금지 IP가 하나라도 있으면 차단한다. 검증된 단일 IP(IPv4 우선)로 소켓 연결을 고정하되, 원래 Host 헤더, TLS SNI, 인증서 SAN 검증을 유지한다.
4. **전체 10초 Deadline**: DNS 조회, TCP 연결(3초), TLS 핸드셰이크, HEAD→GET 전환, 리다이렉트(최대 5회)를 합산한 전체 검사 기한은 단조 시계 기준 절대 10초다.
5. **누적 32 KiB 헤더 상한**: 요청 1회당 상태줄, 중간 1xx(100/103 등), 최종 헤더, 구분자를 합쳐 최대 32 KiB로 제한한다. 상한 초과분은 파서에 전달하지 않으며, 초과 시 작업은 `completed`, 연결 결과는 `blocked`, 관리자 사유는 `RESPONSE_HEADERS_TOO_LARGE`로 기록한다.
6. **동시 검사 앱 최대 3개**: 동시에 실행되는 검사는 최대 3개로 제한하며, 취소나 만료 후에도 실질 동시성이 3개를 초과해서는 안 된다.
7. **30초 Lease & 갱신 없음**: 작업 lease는 원자적 claim 시점부터 30초이며 연장하지 않는다. worker 중단 복구 재시도는 기존 작업 ID를 유지하며 최초+재시도 최대 2회다.
8. **이전 실행 종료 확인 & Stale 쓰기 배제**: 이전 실행이 종료되었음을 확인하고 앱별 cooldown(60초)을 충족한 뒤 재실행한다. 만료되었거나 늦게 도착한 이전 실행의 결과 저장은 원자적으로 거부한다.

---

## 3. 후보 실행 모델별 보장 범위 비교

동시 검사 최대 3개와 10초 deadline, 자원 회수의 충돌을 해결하기 위해 분석된 네 가지 후보 모델의 특성을 비교한다.

### 3.1 네 후보 모델의 정의
1. **후보 (i) 순수 비동기 (Pure Async, 스레드 풀 위임)**:
   - 단일 worker 내 `asyncio` 이벤트 루프와 `asyncio.Semaphore(3)` 운용.
   - `loop.run_in_executor(None, socket.getaddrinfo)` 사용.
   - 타임아웃/취소 시 코루틴 대기는 즉시 중단되고 세마포어 슬롯을 즉시 반환. 소켓은 `aclose()` 종료 호출 경로를 탄다(`[추론]`, 개별 FD 종료는 미검증).
   - 단, 미종료 DNS syscall 스레드는 백그라운드 스레드 풀에 잔류.
2. **후보 (ii) 크기 3 전용 Resolver Executor 결합 비동기 (Dedicated 3-Worker Async)**:
   - 단일 worker 내 `asyncio` 이벤트 루프 운용하되, DNS 조회 전용 `ThreadPoolExecutor(max_workers=3)` 배치.
   - 코루틴이 취소되더라도 **해당 작업의 DNS 스레드가 완전히 종료될 때까지 세마포어 슬롯 반환을 유예**.
   - 실질 resolver 스레드 동시성은 3개로 제한되나, 취소된 슬롯이 OS resolver timeout 동안 동결됨.
3. **후보 (iii) 단기 일회성 자식 프로세스 격리 (Ephemeral Subprocess Sandbox)**:
   - 영속 데몬은 단 1개의 worker 프로세스 유지.
   - 검사 1건마다 단기 자식 프로세스를 생성하고 표준 입출력(JSON)으로 통신.
   - 10초 타임아웃 또는 취소 시 부모 worker가 자식 프로세스에 `SIGKILL` 전송 후 `waitpid`로 완전 소멸 확인.
4. **후보 (iv) 비동기 DNS 결합 순수 비동기 (Pure Async with AsyncResolver)**:
   - 단일 worker 내 `asyncio` 이벤트 루프 운용.
   - DNS 조회를 C syscall 스레드 대신 순수 비동기 UDP 소켓 기반의 `dnspython 2.8.0`(`dns.asyncresolver`)으로 수행.
   - 백그라운드 스레드를 생성하지 않으며, 10초 타임아웃 또는 취소 시 코루틴이 취소된다. UDP 소켓 FD의 개별 종료 시점은 미검증이다.

### 3.2 4대 후보 모델 종합 비교표

| 비교 항목 | 후보 (i): 순수 비동기 (스레드 풀) | 후보 (ii): 전용 Executor 비동기 | 후보 (iii): 자식 프로세스 격리 | 후보 (iv): AsyncResolver 비동기 |
|---|---|---|---|---|
| **DNS 정체 시 중단** | 코루틴 대기는 중단되나, **C syscall 스레드는 백그라운드 잔류** (`[모의 관찰]`) | 코루틴 대기는 중단되나, **C syscall 스레드 종료 시까지 슬롯 점유** (`[모의 관찰]`) | `SIGKILL` 전송 즉시 **프로세스 소멸** (`[모의 실측: 0.14ms]`. 소켓 보유 자식은 미검증) | 코루틴 취소 즉시 **스레드 잔류 0개** (`[실측: 0.55s 차단]`; 프로세스 전체 소켓 수 불변 관찰, 개별 UDP FD 종료는 미검증) |
| **소켓 FD 회수** | 취소 시 `aclose()` 종료 호출 경로를 사용 (`[추론]`; Case 8은 DNS 모의 단계 측정이라 개별 FD 종료는 미검증) | 취소 시 `aclose()` 종료 호출 경로를 사용 (`[추론]`; 개별 FD 종료는 미검증) | 프로세스 종료 시 커널이 소켓 회수 (`[추론]`, 실 소켓 자식은 미검증) | 프로세스 전체 소켓 수 불변 관찰 (`[실측: 5->5]`). 개별 UDP FD 종료는 미검증 |
| **실질 동시성 (동시 실행 수)** | **일시적으로 3 초과 관찰** (활성 코루틴 3 + 잔류 스레드 1 = 4, `[실측]`) | **3개 준수** (활성 스레드 최대 3 유지, `[실측]`) | **3개 준수** (활성 자식 PID 최대 3 유지, `[모의 실측]`) | **3개 준수** (스레드 생성 0개, 활성 코루틴 3 유지, `[실측]`) |
| **슬롯 고착 (처리량 영향)** | 슬롯 즉시 재사용 가능 (고착 없음, `[실측]`) | **DNS 정체 발생 시 슬롯이 resolver timeout 동안 동결됨** (`[실측: 1.4s 고착]`) | 슬롯 즉시 재사용 가능 (0.14ms 소멸 후 재할당, `[모의 실측]`) | 슬롯 즉시 재사용 가능 (고착 0초, `[실측]`) |
| **OS Resolver Timeout 제어** | `RES_OPTIONS="timeout:1 attempts:1"`로 쿼리 타임아웃 1초 지정 가능(`[1차 출처]`). 단, 전체 API 호출 상한 미보장 | `RES_OPTIONS`로 쿼리 타임아웃 단축 가능하나, 복수 네임서버 등으로 전체 상한 미보장 | 부모 프로세스의 단조 시계 타이머로 `SIGKILL` 강제 종료 (`[모의 실측]`) | `dns.asyncresolver`의 `lifetime`/`timeout` 속성으로 요청 단위 제어 (`[실측]`) |
| **Stale 결과 DB 오염 방지** | SQLite CAS Fencing으로 방어 (`[실측]`) | SQLite CAS Fencing으로 방어 (`[실측]`) | 프로세스 사살 + SQLite CAS Fencing (`[실측]`) | SQLite CAS Fencing으로 방어 (`[실측]`) |
| **시스템 Resolver 우회 여부** | OS resolver(`/etc/hosts`, nsswitch) 사용 | OS resolver(`/etc/hosts`, nsswitch) 사용 | OS resolver(`/etc/hosts`, nsswitch) 사용 | **시스템 resolver 우회** (지정 네임서버 직접 UDP 질의, `/etc/hosts` 무시) |
| **외부 의존성 추가** | 없음 (표준 라이브러리) | 없음 (표준 라이브러리) | 없음 (표준 라이브러리) | `dnspython` 패키지 추가 (순수 파이썬) |

---

## 4. 핵심 기술 영역별 상세 분석 (범위 1 ~ 범위 5)

### 4.1 최소 실행 방식 및 자원 수명 관리 (범위 1)

#### 4.1.1 glibc `resolv.conf(5)`와 `RES_OPTIONS` 프로세스 제어 (1차 출처 사실 및 한계)
- **1차 출처**: Linux man-pages `resolv.conf(5)` (man7.org 원문 그대로 인용):
  > "The options keyword of a system's resolv.conf file can be amended on a per-process basis by setting the environment variable RES_OPTIONS to a space-separated list of resolver options as explained above under options."
  > "timeout:n - Sets the amount of time the resolver will wait for a response from a remote name server before retrying the query via a different name server. This may not be the total time taken by any resolver API call and there is no guarantee that a single resolver API call maps to a single timeout. Measured in seconds, the default is RES_TIMEOUT (currently 5, see <resolv.h>). The value for this option is silently capped to 30."
- **프로세스 단위 수정 가능 옵션**:
  - `options timeout:n`: 네임서버 응답 대기 시간(초) 설정 (기본값: 5초, 최소값: 1초, 상한: 30초).
  - `options attempts:n`: 네임서버 질의 재시도 횟수 설정 (기본값: 2회, 최대값: 5회).
- **영향 및 '상한 미보장' 한계 분석**:
  - `RES_OPTIONS="timeout:1 attempts:1"` 환경 변수는 네임서버당 1회 쿼리 대기 시간을 1초로 제한하지만, **"단일 resolver API 호출의 전체 소요 시간이나 1회 타임아웃 매핑을 보장하지 않는다(no guarantee)"**고 1차 출처가 명시한다.
  - 복수의 네임서버가 등록되어 있거나, `search`/도메인 접미사 순회, IPv4/IPv6 이중 질의가 발생하는 경우 쿼리 시도가 누적되어 전체 지연 시간이 수 초 이상으로 증가할 수 있어 **'상한 미보장'**이다.
- **격리 실험의 제약 및 '미검증' 분류**:
  - `resolv.conf(5)`에 따르면 환경 변수로 오버라이드 가능한 항목은 `LOCALDOMAIN`과 `RES_OPTIONS`뿐이며, **`nameserver` IP를 프로세스 환경 변수로 오버라이드하는 기능은 glibc에서 공식 지원되지 않는다**.
  - 시스템 `/etc/resolv.conf` 수정 금지 및 외부 DNS 패킷 송출 금지 제약으로 인해, 실제 glibc `socket.getaddrinfo`가 로컬 루프백 미응답 UDP 서버를 바라보게 만드는 실측은 수행할 수 없었으며, 이를 **'미검증'**으로 분류한다.

#### 4.1.2 비동기 이벤트 루프와 ThreadPoolExecutor의 한계 (후보 i 실측 및 asyncio.run 종료 대기)
- `BaseEventLoop.getaddrinfo`는 C 함수 `socket.getaddrinfo`를 기본 `ThreadPoolExecutor`에 위임한다.
- `async with asyncio.timeout(0.5):`로 코루틴을 취소하더라도:
  - 코루틴은 0.504초에 `TimeoutError`를 발생시키고 취소된다 (`Case 2 Async Executor: PASS`).
  - **1차 출처 (Python 공식 문서 `asyncio.run()`)**: 이벤트 루프가 종료되거나 `asyncio.run()`이 반환될 때, 런타임은 `loop.shutdown_default_executor()`를 호출하여 기본 executor 내부의 모든 스레드가 완료될 때까지 블로킹 대기한다.
  - 따라서 Case 2 비동기 실측에서 측정된 0.504초는 **'코루틴 취소 시점'**일 뿐이며, 호출자 복귀나 백그라운드 스레드 풀의 자원 회수 시점이 아니다.

#### 4.1.3 단기 일회성 자식 프로세스 격리 (후보 iii 모의 실측 및 한계)
- 검사 1건마다 단기 자식 프로세스를 생성하고 부모 worker가 `proc.send_signal(signal.SIGKILL)`을 전송한 결과:
  - 모의 sleep 자식 프로세스는 **0.14ms** 만에 커널에 의해 회수(`waitpid`)되었다.
  - 부모 종료 시 자식 고아화 방지를 위해 `prctl(PR_SET_PDEATHSIG, SIGKILL)` 설정이 유효하다(`[1차 출처: prctl(2)]`).
  - 단, 실제 네트워크 소켓 통신 및 TLS 핸드셰이크 중인 자식 프로세스에 대한 SIGKILL 회수 검증은 구현 단계로 위임된다 (`미검증 목록 2번`).

#### 4.1.4 스레드 없는 비동기 DNS `dnspython 2.8.0` (후보 iv 실측 및 Q5/Q6 정책 분석)
- **1차 출처 및 동작 분석**:
  - `dnspython 2.8.0`의 `dns.asyncquery.udp`는 `asyncio.DatagramTransport`를 사용하여 이벤트 루프에서 순수 비동기 I/O를 수행한다.
  - 별도 스레드를 생성하지 않는다. `asyncio.timeout` 취소 전후 프로세스 전체 스레드 수와 프로세스 전체 소켓 FD 수가 변하지 않음을 관찰했다 (`Case 2.4 실측: threads 2->2, sockets 5->5`). 이 수치는 프로세스 전체 집계이므로 해당 DNS UDP 소켓 FD의 개별 종료 시점을 단언하지 않는다. 개별 FD 종료는 [추론]이며 미검증이다.
- **Q5(지정 DNS 통신만 허용) 정합성 분석**:
  - `dns.asyncresolver.Resolver(configure=False)`로 `/etc/resolv.conf`를 우회하고 `nameservers = [TRUSTED_IP]`로 고정 가능.
  - 단, 애플리케이션 레벨의 고정 외에 호스트 네트워크 계층(iptables/eBPF)에서 지정 DNS 외 패킷 송출을 차단하는 인프라 통제 결합은 구현 단계 검증이 필요하다 (`미검증 목록 8번`).
- **Q6(모든 A/AAAA 검증 후 단일 IP 선택) 엄격 규칙 실측**:
  - **스위트 구현 규칙 (`resolve_and_validate_strict`)**:
    1. A와 AAAA를 병렬 조회(`asyncio.gather(..., return_exceptions=True)`).
    2. `dns.resolver.NoAnswer`는 해당 레코드 없음(빈 목록)으로 처리하며, NXDOMAIN·timeout·네트워크 오류 등 기타 예외만 조회 실패로 즉시 전체 차단 (`DNSValidationError`).
    3. 두 목록이 모두 비어 있으면 주소 미발견으로 즉시 차단.
    4. 반환된 모든 IP에 대해 `(not ip.is_global) or ip.is_multicast` 판정(IPv4-mapped IPv6는 `ip.ipv4_mapped`로 재판정). 사설(10.x, 172.16.x, 192.168.x), 루프백(127.x, ::1), 멀티캐스트(224.0.0.1), CGNAT(100.64.0.1), 링크로컬(169.254.x, fe80::), ULA(fc00::/7) 등 금지 IP가 하나라도 포함되면 즉시 전체 차단 (`DNSForbiddenIPError`).
    5. 검증된 IPv4가 있으면 첫 번째 IPv4, 없으면 첫 번째 IPv6를 반환 (IndexError 없음).
  - **실측 결과 (`suite.py`, 모의 응답 값 8.8.8.8, 2001:4860:4860::8888 사용)**:
    - 224.0.0.1 멀티캐스트 IP 차단 단언: 차단 성공 (`PASS`).
    - 100.64.0.1 CGNAT IP 차단 단언: 차단 성공 (`PASS`).
    - 공인 IPv4 + AAAA NoAnswer 통과 및 IPv4 선택 단언: `8.8.8.8` 선택 (`PASS`).
    - IPv6 전용 공인 주소 (A NoAnswer + AAAA 공인) 통과 및 IPv6 선택 단언: `2001:4860:4860::8888` 선택 (`PASS`).
    - AAAA timeout 전체 차단 단언: 차단 성공 (`PASS`).
    - 공인 IPv4 + 금지 IPv6 혼합 전체 차단 단언: 차단 성공 (`PASS`).
- **시스템 Resolver 우회 영향**:
  - `/etc/hosts` 및 `nsswitch.conf`를 우회하므로 호스트 변조 위험은 없으나, 로컬 테스트 시 전용 모의 DNS fixture가 필요하며 `dnspython` 서드파티 의존성이 발생한다.

---

### 4.2 전체 10초 Deadline의 실제 의미와 측정 메커니즘 (범위 2)

#### 4.2.1 Per-operation Timeout vs 단조 시계 기반 누적 Deadline
- **1차 출처 사실**: HTTPX 공식 문서([HTTPX Timeouts](https://www.python-httpx.org/advanced/timeouts/))에 명시된 `timeout=10.0`은 개별 I/O 연산 1회당 적용되는 per-operation timeout이다.
- **Slowloris Drip-feed 차단 실측 (Case 4)**:
  - 서버가 0.1초마다 1바이트씩 응답 헤더를 보낼 때, per-read 10초 타임아웃은 데이터가 지속 수신되므로 발동하지 않는다.
  - 반면 단조 시계(`time.monotonic()`) 기반 누적 deadline(0.8s)을 적용한 결과, 동기 0.801초, 비동기 0.802초에 `ReadTimeout`으로 정확히 차단되었다 (`Case 4: PASS`).
- **다중 단계 합산 실측 (Case 7)**:
  - HEAD(405) → GET(302) → GET(302) → GET(정체) 단계에서 요청별 클라이언트를 재생성하더라도 누적 1.2s deadline이 유지되어 동기 1.201초, 비동기 1.201초에 `DEADLINE_EXCEEDED`로 종료되었다 (`Case 7: PASS`).

---

### 4.3 32 KiB 헤더 보호 경로의 결합 및 상태 격리 (범위 3)

#### 4.3.1 누적 카운터 스트림 래퍼 실측 (`SyncHeaderLimitStream` / `AsyncHeaderLimitStream`)
1. **32 KiB 경계 실측 (Case 5)**:
   - 32,768 바이트: 정상 파싱 완료 (`Case 5a: PASS`).
   - 32,769 바이트 (1B 초과): `h11` 파서 진입 전 스트림 계층에서 `ReadError: Pre-parse cumulative header limit exceeded: 32769 > 32768` 발생 및 차단 (`Case 5b: PASS`).
   - 스트림 래퍼는 동기 `self.close()`, 비동기 `await self.aclose()`를 즉시 호출하며, 스위트는 래퍼가 스스로 설정하는 `last_stream.is_closed == True`를 단언하여 차단 시 래퍼의 종료 호출이 실행됐음을 확인했다 (`Case 5b Sync/Async: PASS`). 하위 소켓 FD의 실제 종료는 단언하지 않았으며 미검증이다.
2. **완성 대형 청크 실측 (Case 6a)**:
   - 40 KiB 헤더가 종단 구분자(`\r\n\r\n`)를 포함하여 단일 청크로 도착해도 파서 진입 전 스트림 계층에서 사전 차단 (`Case 6a: PASS`).
3. **중간 1xx 정보 응답 누적 실측 (Case 6b)**:
   - 103 (20 KiB) + 200 (15 KiB) = 35 KiB 수신 시 복수 1xx를 누적 합산하여 35,068 바이트 시점에 사전 차단 (`Case 6b: PASS`).
4. **Host/SNI 및 인증서 SAN 검증 실측 (Case 1)**:
   - 단일 IP 고정 상태에서 `server_hostname="localhost"`: 정상 200 OK 수신 (`Case 1 Sync/Async: PASS`).
   - **SAN 불일치 음성 시험 실측**: SAN에 없는 `wrong.domain.local` 요청 시 동기·비동기 모두 `SSLCertVerificationError` 및 `Hostname mismatch` 원인 예외가 명확히 발생하여 즉시 차단됨을 단언 확인 (`Case 1 Sync/Async SAN Mismatch: PASS`).

---

### 4.4 동시성 최대 3개 및 실질 동시성 시계열 실측 (범위 4)

로컬 모의 환경에서 3개 슬롯 포화 후 1개 취소 시점의 시스템 자원을 4개 후보 모델별로 시계열 실측하였다 (`Case 8`).

#### 4.4.1 후보 (i) 순수 비동기 (Pure Async) 시계열
```text
[t=0.3s 취소 전] Active Coros: 3, Resolver Threads: 3, Socket FDs: 8 (Task 4 대기)
[t=0.4s 취소 후] Active Coros: 3, Resolver Threads: 4, Socket FDs: 8 (Task 2 취소 즉시 Task 4 진입)
-> 실질 동시성: 활성 코루틴(3) + 취소 후 잔류 스레드(1) = 4 (3개 초과 관찰)
```

#### 4.4.2 후보 (ii) 크기 3 전용 Executor 결합 비동기 시계열
```text
[t=0.2s 취소 전] Active Coros: 3, Resolver Threads: 3 (Task 4 대기)
[t=0.3s 취소 후] Active Coros: 3, Resolver Threads: 3 (Task 2 잔류 스레드 완료까지 슬롯 점유 유지, Task 4 대기 지속)
[t=1.7s 완료 후] Active Coros: 1, Resolver Threads: 1 (Task 2 잔류 스레드 종료 후 Task 4 실행 완료)
-> 스레드 동시성은 3개로 유지되나, 슬롯이 1.4초간 동결되어 대기 작업 처리 지연 관찰
```

#### 4.4.3 후보 (iii) 자식 프로세스 격리 시계열
```text
[t=0.0s 시작]    Active Child PIDs: [35890, 35891, 35892] (총 3개)
[t=SIGKILL]      Proc 35891에게 SIGKILL 전송 -> 0.14ms 만에 종료 확인 (waitpid 완료)
[t=교체 즉시]    Proc 4 생성 -> Active Child PIDs: [35890, 35892, 35893] (총 3개 준수)
-> 프로세스 수준 강제 회수 후 즉시 슬롯 교체 관찰 (모의 자식 대상)
```

#### 4.4.4 후보 (iv) `dnspython.asyncresolver` 비동기 시계열
```text
[t=0.2s 취소 전] Active Coros: 3, Threads: 8 (Task 4 대기)
[t=0.25s 취소 후] Active Coros: 3, Threads: 8 (Task 2 취소 즉시 Task 4 진입, 잔류 스레드 0개)
[t=완료 후]       Threads: 8 (증가 없음), Socket FDs: 6
-> 스레드 잔류 0개, 슬롯 고착 0초, 실질 동시성 3개 준수 확인
(참고: /proc/self/fd 계측은 단일 프로세스 전체의 소켓 FD 수이며 태스크별 격리 수치가 아님)
```

---

### 4.5 복구·결과 반영 원자성 및 경합 방지 (범위 5)

#### 4.5.1 SQLite Fencing Token 기반 원자적 UPDATE 실측 (Case 9)
`suite.py`에서 실제로 검증된 SQLite 스키마와 원자적 CAS UPDATE 쿼리는 다음과 같다:

```sql
-- 테이블 스키마 (suite.py 실제 구조)
CREATE TABLE health_jobs (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    url_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    lease_until REAL,
    finished_at TEXT,
    failure_code TEXT
);

-- Worker B: 만료 감지 후 re-claim
UPDATE health_jobs
SET attempts = 2,
    lease_until = :new_lease_until_epoch
WHERE id = :job_id
  AND status = 'running'
  AND lease_until < :current_epoch
  AND attempts < 2;

-- Worker 결과 저장 (만료되었거나 이전 세대 토큰의 늦은 쓰기 차단)
UPDATE health_jobs
SET status = 'completed',
    finished_at = datetime('now')
WHERE id = :job_id
  AND attempts = :my_attempts
  AND status = 'running'
  AND lease_until > :current_epoch;
```

- **스위트 실측 결과**:
  1. Worker A 수주 (`attempts=1`, lease 0.5s 부여).
  2. 0.8초 경과로 lease 만료 (`now > lease_until`).
  3. Worker B 만료 감지 후 re-claim 성공 (`attempts=2`, lease 30s, `rowcount=1`).
  4. Worker B 작업 완료 및 저장 성공 (`rowcount=1`).
  5. 지연된 Worker A가 과거 토큰(`attempts=1`)으로 저장 시도: **`rowcount=0`으로 차단됨** (`Case 9: PASS`).
- **시각 표현 방식 비교 `[추론]`**:
  - `suite.py`는 `lease_until REAL` 컬럼과 Unix epoch 실수(`time.time()`) 비교를 사용하여 타임존 파싱 오버헤드 없이 수치 비교로 동작함을 입증하였다.
  - ISO 8601 문자열(`datetime('now')`) 사전순 비교는 사람이 DB 조회 시 직관적인 장점이 있으나 밀리초 포맷팅 불일치 시 문자열 비교 오류 위험이 있어, Unix epoch 수치 비교가 시스템적으로 더 단순하고 안전하다고 추론된다.

---

## 5. 미검증 — 구현 단계 검증 필요 목록

본 조사의 실험적 한계와 격리 원칙(시스템 설정 불변, 외부 트래픽 금지)으로 인해 실측하지 못하였으며 구현 및 배포 단계에서 검증해야 하는 8개 항목이다:

1. **실제 glibc `getaddrinfo` 정체**:
   - Case 2의 DNS 정체는 `time.sleep` 기반의 모의 함수로 검증되었다.
   - glibc의 per-process nameserver 미지원 및 시스템 `/etc/resolv.conf` 수정 금지 제약으로 인해, 실제 glibc C syscall 수준의 네트워크 패킷 정체 및 OS 타임아웃 실측은 미검증이다.
2. **소켓 보유 자식 프로세스의 SIGKILL 회수**:
   - Case 2 및 Case 8의 프로세스 실험은 sleep 프로세스 대상이었다.
   - 실제 커널 TCP/UDP 소켓 통신 및 TLS 핸드셰이크가 진행 중인 자식 프로세스에 대해 부모가 `SIGKILL`을 보냈을 때 커널 소켓 버퍼 및 OS TCP 스택이 즉시 회수되는지 여부는 미검증이다.
3. **Worker 사망·재시작 및 고아 실행 방지**:
   - Worker 프로세스가 예기치 않게 비정상 종료(SIGKILL/OOM)되거나 재시작될 때, 기존에 통신 중이던 자식 프로세스나 소켓의 고아화 방지(`PR_SET_PDEATHSIG` 실운영 연동)는 미검증이다.
4. **Case 8 FD 수의 프로세스 전체 소켓 수 한계**:
   - `/proc/self/fd` 계측은 단일 프로세스 전체의 소켓 개수를 합산한 것으로, 개별 코루틴이나 태스크 단위의 소켓 FD 수명과 1:1로 매핑하여 단언한 것이 아니다.
5. **Case 9 범위 밖의 안전한 재시도 과제**:
   - Case 9는 단일 행의 원자적 UPDATE(CAS)만을 실측하였다.
   - 이전 실행의 물리적 종료 확인 메커니즘, 60초 cooldown 검증, `url_version` 일치 확인, 앱 결과 저장의 원자적 트랜잭션, DB 쓰기 실패 및 동시성 잠금 경합(`busy_timeout=5000ms`) 처리는 미검증이다.
6. **전체 10초 결합 파이프라인 종단간 통합**:
   - Case 7은 고정 IP 기반의 HTTP 요청 전이만을 축소된 deadline(1.2s)으로 시험하였다.
   - DNS 질의, TCP 연결(3초), TLS 핸드셰이크, 최대 7회 요청 / 5회 리다이렉트, 응답 스트림 종료 및 본문 미수집을 단일 10초 단조 시계 타이머로 결합한 종단간(End-to-End) 통합은 미검증이다.
7. **실제 읽기·버퍼 메모리 상한**:
   - 스트림 계층의 32 KiB 초과 차단은 확인되었으나, OS 커널 수신 소켓 버퍼(`SO_RCVBUF`) 및 CPython/httpx 내부 버퍼에 대한 물리적 메모리 상한 계측은 미검증이다.
8. **후보 (iv)의 Q5/Q6 및 HTTP 연결 결합 파이프라인**:
   - dnspython 질의와 HTTPX custom transport 연결을 결합한 통합 파이프라인, iptables/eBPF를 통한 지정 DNS 외 아웃바운드 패킷 송신 차단(Q5) 및 A/AAAA 전수 검증 후 단일 IP 연결(Q6)의 종단간 연동은 미검증이다.

---

## 6. 필수 검증 사례 종합 결과표 (Sync, Async, Process, AsyncResolver)

모든 검증은 로컬 루프백(`127.0.0.1`) 환경에서 자체 생성된 임시 인증서와 모의 소켓을 통해 수행되었다.

| 사례 ID | 사례명 | 입력 조건 | 기대 조건 | Sync 결과 | Async 결과 | 판정 | 기술적 한계 및 비고 |
|---|---|---|---|---|---|---|---|
| **Case 1** | 정상 요청 | HTTPS `https://localhost:<port>/test`, 200 OK | 200 OK 수신, SNI/SAN 일치, 소켓 정상 종료 | 200 OK (0.012s) | 200 OK (0.020s) | **PASS** | `[실측]` 정상 경로 확인 |
| **Case 1-SAN** | SAN 불일치 음성 시험 | `https://wrong.domain.local:<port>/test` | 인증서 검증 실패로 연결 차단 | ConnectError 거부 (`PASS`) | ConnectError 거부 (`PASS`) | **PASS** | `[실측]` SSLCertVerificationError 및 Hostname mismatch 원인 단언 확인 |
| **Case 2** | DNS 정체 | 모의 resolver 3.0s 지연 (0.5s deadline 부여) | 0.5초 경과 시 호출 대기 해제, 미종료 자원 형태 관찰 | 0.501s 반환, 스레드 잔류(`alive=True`) | 0.504s 코루틴 취소 (`executor 대기`) / **후보 iv (AsyncResolver): 0.553s 취소, 스레드 잔류 0개, 프로세스 전체 소켓 수 불변(개별 FD 종료 미검증)** / 후보 iii (Process): 0.504s SIGKILL 회수 | **PASS** | `[모의 관찰]` sleep 기반 모의. 실제 glibc C syscall 지연은 미검증. asyncio.run 종료 대기 명시 |
| **Case 3** | TLS 정체 | TCP 연결 후 서버가 TLS 핸드셰이크 4초간 무응답 | 0.8s deadline 만료 시 핸드셰이크 중단 | 0.802s `ConnectTimeout` 발생 | 0.802s `ConnectTimeout` 발생 | **PASS** | `[실측]` TLS 핸드셰이크 단계 누적 deadline 강제 입증 |
| **Case 4** | 느린 헤더 (Drip-feed) | 서버가 0.1s마다 1바이트씩 응답 헤더 전송 | per-read 10s 타임아웃 무시, 누적 0.8s deadline에 차단 | 0.801s `ReadTimeout` 발생 | 0.802s `ReadTimeout` 발생 | **PASS** | `[실측]` HTTPX 기본 per-read 타임아웃 무력화 및 누적 deadline 필수성 입증 |
| **Case 5a** | 32 KiB 경계 (Exact) | 상태줄+헤더+구분자 합계 **32,768 바이트** | 정상 200 OK 파싱 통과 및 스트림 정상 완료 | Status 200 정상 완료 | Status 200 정상 완료 | **PASS** | `[실측]` 경계값 허용 확인 |
| **Case 5b** | 32 KiB 초과 (Exceed) | 상태줄+헤더+구분자 합계 **32,769 바이트** | 파서 진입 전 스트림 계층에서 `ReadError` 발생 및 차단 | 32,769B 감지 즉시 `ReadError` 발생 및 `is_closed=True` | 32,769B 감지 즉시 `ReadError` 발생 및 `aclose()`로 `is_closed=True` | **PASS** | `[실측]` 1바이트 초과 사전 차단 및 is_closed 단언 입증 |
| **Case 6a** | 완성 대형 청크 | 40 KiB 헤더가 종단 구분자 포함 단일 청크 수신 | `h11` 검사 우회 없이 스트림 계층에서 사전 차단 | 40,030B 감지 즉시 `ReadError` 발생 | 40,030B 감지 즉시 `ReadError` 발생 | **PASS** | `[실측]` 단일 청크 완성 헤더 방어 입증 |
| **Case 6b** | 중간 1xx 누적 | 103 (20 KiB) + 200 OK (15 KiB) = 35 KiB 수신 | 1xx와 최종 헤더 합산이 32 KiB 초과 시 최종 완료 전 차단 | 35,068B 감지 즉시 `ReadError` 발생 | 35,068B 감지 즉시 `ReadError` 발생 | **PASS** | `[실측]` 복수 1xx 누적 카운터 입증 |
| **Case 7** | HEAD→GET·리다이렉트 | HEAD(405)→GET(302)→GET(302)→GET(정체), 누적 1.2s | 요청별 재생성 시에도 전체 누적 1.2s 경과 시 즉시 차단 | 1.201s `DEADLINE_EXCEEDED` 발생 | 1.201s `DEADLINE_EXCEEDED` 발생 | **PASS** | `[실측]` 다중 단계 합산 누적 deadline 유지 입증. (전체 10초 파이프라인 결합은 미검증) |
| **Case 8** | 자원 추적 및 동시성 | 3개 포화 중 1개 취소 시 실질 자원 시계열 추적 | 실질 동시성 초과 여부 및 모델별 자원 회수 관찰 | N/A | 후보 (i) 동시성 4 관찰 / 후보 (ii) 슬롯 고착 / 후보 (iii) SIGKILL 0.14ms / **후보 (iv) 스레드 잔류 0, 고착 0, 동시성 3 준수** | **PASS** | `[실측]` 자원 시계열 관찰. (/proc/self/fd는 프로세스 전체 소켓 수) |
| **Q6 규칙** | A/AAAA 병렬 검증 (6종 단언) | 224/100.64 차단, NoAnswer 처리, AAAA 타임아웃 차단, 단일 IP 선택 | 모의 응답 기준 규칙별 기대 동작 단언 | N/A | 224/100.64 차단, IPv4 선택(8.8.8.8), IPv6 선택, timeout 차단, 혼합 차단 | **PASS** | `[실측]` 후보 iv의 Q6 6대 검증 규칙(224/100.64 차단, NoAnswer 처리, IPv4/IPv6 선택, timeout 차단 등) 단언 입증 |
| **Case 9** | SQLite CAS Fencing | Worker A(attempts=1 만료)와 Worker B(attempts=2) 경합 | Stale Worker A의 결과 저장이 원자적으로 거부됨 | N/A (DB 공통) | Worker B 저장(rows=1), Worker A 늦은 저장 거부(rows=0) | **PASS** | `[실측]` REAL epoch 기반 Fencing Token stale write 방어 입증 |
| **조사** | glibc RES_OPTIONS 제어 | 환경변수로 per-process options 수정 및 루프백 UDP 리다이렉션 | glibc 옵션 수정 유효성 및 시스템 미변경 상태의 실측 가능 여부 | N/A | `RES_OPTIONS="timeout:1 attempts:1"` 옵션 지원 확인. 단, 전체 API 호출 상한 미보장 및 per-process nameserver 미지원 | **미검증** | 시스템 `/etc/resolv.conf` 변경 금지 및 외부 트래픽 방지 제약으로 인해 glibc의 실제 loopback UDP redirection은 미검증으로 기록 |

- **실행 통계 요약**: 검증 항목 25건 중 **PASS 24건, 미검증 1건 (glibc loopback redirection), FAIL 0건**.

---

## 7. 결정 후보와 선택 조건 (아키텍처 트레이드오프)

실측 결과, 네 가지 후보 모델은 명확한 기술적 트레이드오프를 가진다:

1. **후보 (iv) 비동기 DNS 결합 순수 비동기 (AsyncResolver + Async Transport)**:
   - **특징**: 스레드 잔류 0개, 슬롯 고착 0초, 실질 동시성 3개 준수(관찰 범위), 개별 소켓 FD 종료는 미검증, 프로세스 생성 오버헤드가 없다.
   - **선택 조건**: `dnspython 2.8.0` 의존성 추가 승인 및 `/etc/hosts` 우회에 따른 전용 모의 DNS fixture 운용 수용.
   - **남은 과제**: §5 미검증 목록의 8번(HTTPX transport 결합 및 Q5 네트워크 패킷 차단)을 포함한 통합 파이프라인 검증 필요.
2. **후보 (iii) 단기 일회성 자식 프로세스 격리 (Ephemeral Subprocess Sandbox)**:
   - **특징**: 표준 라이브러리만을 사용하여 모의 sleep 자식을 `SIGKILL`로 0.14ms에 종료·`waitpid` 확인했다(`[모의 실측]`). 시스템 resolver를 유지하면서 동시성 3개를 지킬 수 있는 표준 라이브러리 기반 대안이나, 소켓 보유 자식의 회수는 미검증이다(미검증 목록 2번).
   - **선택 조건**: 프로세스 fork/spawn 오버헤드(5~20ms), 표준 입출력 JSON 직렬화 오버헤드 및 고아 프로세스 생명주기 관리 수용.
   - **남은 과제**: §5 미검증 목록의 2번(소켓 통신 중인 자식 대상 SIGKILL) 실측 필요.
3. **후보 (i) 순수 비동기 (Pure Async, 스레드 풀 위임)**:
   - **특징**: 구현이 가장 가볍고 표준 라이브러리만 사용한다.
   - **선택 조건**: 악의적 DNS 정체 시 일시적 스레드 잔류 및 실질 동시성 초과(4개 이상)를 예외적 한계로 허용할 수 있는 경우에만 채택 가능.
4. **후보 (ii) 크기 3 전용 Executor 결합 비동기 (Dedicated 3-Worker Async)**:
   - **특징**: 스레드 수를 3개로 묶을 수 있다.
   - **한계**: DNS 정체 발생 시 슬롯이 OS resolver timeout 동안 동결되어 후속 정상 작업 처리가 지연된다. (`RES_OPTIONS="timeout:1 attempts:1"`을 적용하더라도 단일 API 호출 상한이 미보장되어 슬롯 고착 위험 잔존).

---

## 8. 남은 HITL 결정 과제 (Human-In-The-Loop)

본 조사의 실측 사실에 기반하여 사람이 최종 선택해야 하는 핵심 정책 목록이다:

1. **실행 아키텍처 최종 선택 (HITL-1)**:
   - **선택지 A (후보 iv — dnspython 비동기 DNS 결합)**:
     - 스레드 잔류 0개, 슬롯 고착 0초, 프로세스 오버헤드 없는 순수 비동기 모델 채택.
     - 전제 조건: `dnspython 2.8.0` 의존성 추가 및 §5 8번 미검증 과제 구현 단계 확인.
   - **선택지 B (후보 iii — 자식 프로세스 격리)**:
     - 서드파티 라이브러리 추가 없이 시스템 resolver를 유지하면서 `SIGKILL`을 통한 3개 동시성 준수 채택.
     - 전제 조건: 검사당 fork 오버헤드 및 §5 2번 미검증 과제 구현 단계 확인.
   - **선택지 C (후보 i — 순수 Async)**:
     - 표준 비동기 채택.
     - 전제 조건: 일시적 스레드 잔류 및 실질 동시성 3개 초과를 예외로 수용.
2. **헤더 32 KiB 초과 시 관리자 노출 DTO 규격 (HITL-2)**:
   - `RESPONSE_HEADERS_TOO_LARGE` 발생 시 관리자 상세 API에 기록할 구체적인 metadata 포맷 확정 필요.
3. **Worker graceful shutdown 타임아웃 정책 (HITL-3)**:
   - 운영자가 worker에 `SIGTERM`을 보냈을 때, 현재 실행 중인 3개 검사가 10초 deadline 내에서 완료되기를 기다려줄 최대 대기 시간과 이후 `SIGKILL` 강제 종료 정책 확정 필요.
4. **SQLite 단조 시계 연동 및 WAL 경합 방지 정책 (HITL-4)**:
   - REAL epoch 수치 비교(`lease_until REAL > :current_epoch`)의 OS 시계 의존성(NTP 점프/시계 역행) 한계를 보완하기 위한 worker 단조 시계 기반 lease 만료 검증 규칙 및 API 프로세스와의 DB 잠금(`busy_timeout=5000ms`) 충돌 완화 방안 확정 필요.

---

## 9. 1차 출처 (Primary Sources) 참고문헌

1. [CPython (v3.12.3) - `Modules/socketmodule.c`](https://github.com/python/cpython/blob/v3.12.3/Modules/socketmodule.c) (getaddrinfo C 시스템 콜 블로킹 구조) - 2026-09-23 조회
2. [CPython (v3.12.3) - `Lib/asyncio/base_events.py`](https://github.com/python/cpython/blob/v3.12.3/Lib/asyncio/base_events.py) (`BaseEventLoop.getaddrinfo`의 `run_in_executor` 스레드 풀 위임 및 `loop.shutdown_default_executor()` 구조) - 2026-09-23 조회
3. [CPython (v3.12.3) - `Lib/asyncio/runners.py`](https://github.com/python/cpython/blob/v3.12.3/Lib/asyncio/runners.py) (`asyncio.run()`의 루프 종료 시 executor shutdown 대기 명세) - 2026-09-23 조회
4. [CPython (v3.12.3) - `Lib/asyncio/timeouts.py`](https://github.com/python/cpython/blob/v3.12.3/Lib/asyncio/timeouts.py) (`asyncio.timeout`의 단조 시계 기반 취소 메커니즘) - 2026-09-23 조회
5. [Linux man-pages - `resolv.conf(5)`](https://man7.org/linux/man-pages/man5/resolv.conf.5.html) (glibc resolver options timeout, attempts, RES_OPTIONS 명세 및 단일 API 호출 상한 미보장 명시) - 2026-09-23 조회
6. [Linux man-pages - `prctl(2)`](https://man7.org/linux/man-pages/man2/prctl.2.html) (`PR_SET_PDEATHSIG` 부모 종료 시 시그널 수신 명세) - 2026-09-23 조회
7. [dnspython (tag v2.8.0) - `dns/asyncquery.py` & `dns/_asyncio_backend.py`](https://github.com/rthalley/dnspython/blob/v2.8.0/dns/asyncquery.py) (비동기 DatagramTransport 기반 UDP 질의 및 소켓 회수 로직) - 2026-09-23 조회
8. [Encode httpcore (tag 1.0.9) - `httpcore/_sync/http11.py`](https://github.com/encode/httpcore/blob/1.0.9/httpcore/_sync/http11.py) (`_receive_response_headers`의 1xx 루프 및 per-read timeout 전달 구조) - 2026-09-23 조회
9. [Encode httpcore (tag 1.0.9) - `httpcore/_backends/anyio.py`](https://github.com/encode/httpcore/blob/1.0.9/httpcore/_backends/anyio.py) (`AnyIOBackend.connect_tcp` 소켓 및 TLS 스트림 래핑) - 2026-09-23 조회
10. [Encode httpx (tag 0.28.1) - `httpx/_transports/default.py`](https://github.com/encode/httpx/blob/0.28.1/httpx/_transports/default.py) (`map_httpcore_exceptions` 예외 변환 구조) - 2026-09-23 조회
11. [HTTPX Official Documentation - Timeouts](https://www.python-httpx.org/advanced/timeouts/) (Per-operation timeout 명세) - 2026-09-23 조회
12. [Python-Hyper h11 (tag v0.16.0) - `h11/_connection.py`](https://github.com/python-hyper/h11/blob/v0.16.0/h11/_connection.py) (`max_incomplete_event_size` 및 미완료 이벤트 검사 규칙) - 2026-09-23 조회
13. [RFC 9110 - HTTP Semantics (Section 9.3.2 HEAD, Section 15.2 Informational 1xx)](https://www.rfc-editor.org/rfc/rfc9110.html) - 2026-09-23 조회
14. [SQLite Documentation - Isolation In SQLite / Atomic Commit](https://www.sqlite.org/isolation.html) - 2026-09-23 조회
