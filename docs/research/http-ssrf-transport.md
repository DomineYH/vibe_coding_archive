# HTTP 검사에 필요한 DNS 고정·TLS·송신망 차단 방식 조사

이 문서는 [이슈 #5](https://github.com/DomineYH/vibe_coding_archive/issues/5) 및 [PRD v1.0 §8.3~8.4](https://github.com/DomineYH/vibe_coding_archive/blob/19c38faeb237705af9965eecfaa23f35b1c480ea/PRD/PRD_EduVibe_Archive_v1.0.md)에서 요구하는 SSRF 방어 요구사항을 충족하기 위한 기술 조사 보고서다.
공식 기술 명세(RFC), IANA 레지스트리, 공식 라이브러리 문서, 런타임 소스 코드 등 **1차 출처(Primary Sources)**만을 기반으로 작성되었으며, 특정 구현을 일방적으로 확정하지 않고 기술적 근거, 미확인 한계, 운영 환경 후보 및 후속 결정 과제를 명확히 밝힌다.

---

## 1. 배경 및 해결 과제

PRD §8.3 및 §8.4에 따른 외부 URL 검사 요구사항:
1. **사전 DNS 검증 및 IP 연결 고정 (DNS Rebinding / TOCTOU 차단)**: 사전 검증한 IP와 HTTP 연결 시 실제 접속하는 IP의 불일치를 막고, 원래 호스트의 Host 헤더, TLS SNI, 인증서 검증을 온전히 유지해야 함.
2. **모든 DNS 후보(A/AAAA) 및 비정상 IP·IDNA 검증**: loopback, private, link-local, multicast, unspecified, reserved, 클라우드 메타데이터(`169.254.169.254` 등), IPv4-mapped IPv6(`::ffff:127.0.0.1`), 8진수/16진수/정수 표기, IDNA 전각 문자 우회 차단.
3. **엄격한 리다이렉트 통제**: `follow_redirects=True` 금지. 각 `Location`을 동일한 검증 파서로 재해석하여 대상·포트·DNS/IP를 재검증하고 최대 5회로 제한.
4. **환경 격리 및 상태 비보존**: ambient 환경 변수(`HTTP_PROXY`, `HTTPS_PROXY`, `netrc`) 무의식적 상속 금지, 세션 쿠키 격리 및 비저장.
5. **총 10초 Deadline 및 스트림 조기 종료**: DNS 조회·연결(3초)·리다이렉트·HEAD/GET 대체를 합산한 전체 10초 deadline, 405/501 시 제한된 GET 스트리밍 후 헤더만 확인하고 즉시 종료(`stream.close()`).
6. **네트워크 레벨 심층 방어 (Defense-in-Depth)**: 애플리케이션 계층 검사 외에 OS/네트워크 레벨에서 내부망/호스트 내부 서비스/메타데이터 접근을 분리 차단.
7. **모의 검증 및 Fail-Closed 계약**: 실제 사설망이나 메타데이터를 호출하지 않는 모의 transport/fixture 검증 체계 및 기본 비활성화(`HEALTH_CHECK_ENABLED=false`)와 실패 시 안전 차단(Fail-Closed) 보장.

---

## 2. IP 고정(IP Pinning)과 TLS/SNI 검증 매커니즘 분석

### 2.1 단순 URL 재작성(URL Rewriting) 방식의 한계와 실패 원인
URL의 호스트명을 검증된 IP로 치환(`https://198.51.100.1/path`)하고 `Host: example.com` 헤더를 수동 주입하는 방식은 다음과 같은 이유로 성립하지 않는다.
- **TLS SNI(Server Name Indication) 누락/불일치**: [RFC 6066 §3](https://www.rfc-editor.org/rfc/rfc6066.html)에 따라 TLS ClientHello 확장의 `server_name`에는 대상 호스트명이 포함되어야 한다. URL을 IP로 바꾸면 HTTP 클라이언트는 SNI로 IP 문자열을 보내거나 확장을 생략한다.
- **인증서 SAN 검증 실패**: [RFC 6125](https://www.rfc-editor.org/rfc/rfc6125.html) 및 [RFC 5280](https://www.rfc-editor.org/rfc/rfc5280.html)에 따르면 서버 인증서의 SAN(Subject Alternative Name) DNS-ID는 원본 호스트명(`example.com`)과 매칭된다. 대상이 IP 주소로 지정되면 클라이언트는 IP-ID 규칙으로 검증을 시도하여 `CertificateError`가 발생한다.
- **TLS 검증 무효화 유혹**: 이를 우회하기 위해 `verify=False`를 켜는 것은 PRD §8.3("TLS 검증을 끄지 않는다")을 정면으로 위반하며 중간자 공격(MITM)에 노출된다.
- **결론**: IP 고정은 HTTP 계층의 URL 문자열 변경이 아니라, **소켓 연결(TCP connect) 계층** 또는 **아웃바운드 프록시 터널링(HTTP CONNECT) 계층**에서 제어되어야 한다.

### 2.2 인프로세스 커스텀 트랜스포트 (`httpcore.NetworkBackend`) 경로와 내부 연계 한계
HTTPX는 네트워크 I/O 및 커넥션 풀링을 `httpcore` 라이브러리에 위임한다([HTTPX Transports 공식 문서](https://www.python-httpx.org/advanced/transports/), [httpcore 공식 저장소](https://github.com/encode/httpcore)).
- **공개 API 제약**:
  `httpx.HTTPTransport.__init__` 공개 API는 `network_backend` 매개변수를 직접 받지 않는다(`verify`, `cert`, `trust_env`, `http1`, `http2`, `limits`, `proxy`, `uds`, `local_address`, `retries`, `socket_options`만 제공).
  따라서 커스텀 `httpcore.NetworkBackend`를 사용하려면 `httpx.BaseTransport`를 직접 상속하여 내부적으로 `httpcore.ConnectionPool(network_backend=...)`을 조립하거나 `HTTPTransport`의 내부 속성을 재정의해야 한다.
  이는 **HTTPX의 공개 안정 API가 보장하는 경로가 아니며, HTTPX와 httpcore 간 내부 연계 구조에 의존**하므로 엄격한 패키지 버전 고정(`uv.lock`)과 회귀 테스트가 필수적이다.
- **httpcore 소켓 연결 및 TLS 계층 분석**:
  `httpcore._backends.sync.SyncBackend` 소스 코드 기준:
  ```python
  def connect_tcp(
      self, host: str, port: int, timeout: float | None = None,
      local_address: str | None = None, socket_options: typing.Iterable | None = None
  ) -> NetworkStream:
      address = (host, port)
      sock = socket.create_connection(address, timeout, source_address=source_address)
      return SyncStream(sock)
  ```
  그리고 `SyncStream.start_tls`는 다음과 같이 호출된다:
  ```python
  def start_tls(self, ssl_context: ssl.SSLContext, server_hostname: str | None = None, timeout: float | None = None) -> NetworkStream:
      sock = ssl_context.wrap_socket(self._sock, server_hostname=server_hostname)
      return SyncStream(sock)
  ```
- **고정 절차 및 필수 테스트 검증 과제**:
  1. `connect_tcp(host, port, ...)` 호출 시 전달되는 `host`는 원본 도메인 문자열(예: `"example.com"`)이다.
  2. 커스텀 백엔드가 `socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)`을 수행하여 모든 후보 IP를 검증하고, 검증된 특정 IP로만 소켓을 생성(`socket.create_connection((str(validated_ip), port), ...)`)하여 IP를 고정한다.
  3. 이후 `httpcore`가 `stream.start_tls(ssl_context, server_hostname=origin.host.decode('ascii'))`를 호출하면, 소켓은 이미 고정된 IP에 연결되어 있으면서도 `server_hostname`에는 원본 도메인이 전달된다.
  4. **주의 및 검증 필수 항목**:
     - '완벽 유지'를 단정해서는 안 되며, 실제 TLS 핸드셰이크 시 SNI 전송, 인증서 SAN 일치 여부, HTTP `Host` 헤더 값이 올바르게 전달되는지 명시적인 테스트 스위트로 입증해야 한다.
     - 특히 **HTTP/2 커넥션 풀 재사용(Connection Reuse)** 위험: HTTP/2가 활성화되면 동일 IP 또는 인증서 범위 내 다른 호스트로 연결이 암묵적으로 다중화(Multiplexing) 재사용될 수 있다. 따라서 SSRF 방어 트랜스포트에서는 `http2=False`를 강제하거나 검사 대상 간 커넥션 풀을 완전히 격리해야 한다.

### 2.3 아웃바운드 포워드 프록시 (Outbound Forward Proxy) 방식
애플리케이션 외부에서 전담 아웃바운드 프록시(예: Stripe Smokescreen, Squid 등)를 경유하는 방식이다([Stripe Smokescreen 공식 저장소](https://github.com/stripe/smokescreen), [Squid ACL 매뉴얼](http://www.squid-cache.org/Doc/config/acl/)).
- **동작 원리**:
  - HTTP 요청: 클라이언트가 프록시로 `GET http://example.com/ HTTP/1.1` 전송.
  - HTTPS 요청: 클라이언트가 프록시로 `CONNECT example.com:443 HTTP/1.1` 터널 요청 전송.
  - 프록시가 대상 도메인의 DNS를 조회하고 사설/내부/메타데이터 IP 대역 여부를 확인한 뒤, 차단 대상이면 407/403/502 등으로 거부.
  - 허용 대상이면 프록시가 외부 호스트로 연결을 수립하고 바이트 터널을 제공. 클라이언트는 터널 위에서 원본 도메인과 종단간 TLS 핸드셰이크를 직접 수행.
- **장점**: 애플리케이션 프로세스와 보안 정책 집행 계층이 물리적으로 분리되며, OS 방화벽을 통해 애플리케이션의 직접 인터넷 송신을 원천 차단하고 오직 프록시 포트로의 송신만 허용할 수 있음.

---

## 3. IP 주소 검증 경계 및 비정상 표기·우회 벡터

### 3.1 IANA Special-Purpose Address Registry 및 특수 IP 대역
단순히 코드 내에 고정된 하드코딩 CIDR 목록만 신뢰해서는 안 되며, [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml) 및 [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml), [RFC 6890](https://www.rfc-editor.org/rfc/rfc6890.html)의 최신 표준을 준수해야 한다.

| 대역 (CIDR) | 명칭 / 용도 | 표준 근거 |
|---|---|---|
| `0.0.0.0/8` | "This host on this network" | RFC 1122 §3.2.1.3, RFC 6890 |
| `10.0.0.0/8` | Private-Use Network | RFC 1918, RFC 6890 |
| `100.64.0.0/10` | Shared Address Space (CGNAT) / Alibaba Cloud Metadata(`100.100.100.200`) | RFC 6598, RFC 6890 |
| `127.0.0.0/8` | Loopback (`127.0.0.1` ~ `127.255.255.254`) | RFC 1122 §3.2.1.3, RFC 6890 |
| `169.254.0.0/16` | Link-Local / Cloud Instance Metadata Service (IMDS `169.254.169.254`) | RFC 3927, RFC 6890 |
| `172.16.0.0/12` | Private-Use Network | RFC 1918, RFC 6890 |
| `192.0.0.0/24` | IETF Protocol Assignments | RFC 6890 |
| `192.0.2.0/24` | Documentation (TEST-NET-1) | RFC 5737, RFC 6890 |
| `192.88.99.0/24` | 6to4 Anycast Relay | RFC 3068, RFC 7526 |
| `192.168.0.0/16` | Private-Use Network | RFC 1918, RFC 6890 |
| `198.18.0.0/15` | Benchmarking Methodology | RFC 2544, RFC 6890 |
| `198.51.100.0/24` | Documentation (TEST-NET-2) | RFC 5737, RFC 6890 |
| `203.0.113.0/24` | Documentation (TEST-NET-3) | RFC 5737, RFC 6890 |
| `224.0.0.0/4` | Multicast | RFC 5771, RFC 6890 |
| `240.0.0.0/4` | Reserved for Future Use | RFC 1112 §4, RFC 6890 |
| `255.255.255.255/32` | Limited Broadcast | RFC 919, RFC 6890 |
| `::/128` | IPv6 Unspecified Address | RFC 4291 §2.5.2, RFC 6890 |
| `::1/128` | IPv6 Loopback Address | RFC 4291 §2.5.3, RFC 6890 |
| `::ffff:0:0/96` | IPv4-mapped IPv6 Address | RFC 4291 §2.5.5.2 |
| `64:ff9b::/96` | IPv4/IPv6 Translation | RFC 6052, RFC 6890 |
| `100::/64` | Discard-Only Address Block | RFC 6666, RFC 6890 |
| `2001:db8::/32` | IPv6 Documentation | RFC 3849, RFC 6890 |
| `fc00::/7` | Unique Local Address (ULA) | RFC 4193, RFC 6890 |
| `fe80::/10` | Link-Local Unicast | RFC 4291 §2.5.6, RFC 6890 |
| `ff00::/8` | IPv6 Multicast | RFC 4291 §2.7, RFC 6890 |
| `fd00:ec2::254/128` | AWS Nitro IMDSv6 Metadata Address | AWS EC2 공식 문서 |

- **`is_global` 판정과 Fail-Closed 정책의 버전별 테스트 필요성**:
  Python [`ipaddress`](https://docs.python.org/3/library/ipaddress.html) 모듈은 `IPv4Address.is_global` 및 `IPv6Address.is_global` 속성을 제공한다. 그러나 Python 마이너 버전에 따라 IANA 레지스트리 반영 시점이나 특수 대역 처리 로직에 차이가 존재할 수 있다.
  따라서 단순히 `addr.is_global` 하나에만 의존하지 말고, 명시적 차단 CIDR 목록 대조와 `is_global` 확인을 병행하고, **공인 유니캐스트임이 명백히 확인되지 않은 모든 주소는 거절하는 Fail-Closed 정책**을 수립한 뒤 실행 환경의 Python 런타임에서 테스트 스위트로 검증해야 한다.

### 3.2 Python `ipaddress` 모듈의 IPv4-mapped IPv6 검증 누락 함정
Python 표준 라이브러리 `ipaddress` 모듈은 IPv4-mapped IPv6 주소(`::ffff:0:0/96`)에 대해 직관과 다른 결과를 낸다.
실제 런타임 검증 결과:
```python
v6 = ipaddress.ip_address('::ffff:127.0.0.1')
v6.is_loopback    # False (IPv6 loopback은 ::1만 해당)
v6.is_link_local  # False

v6_meta = ipaddress.ip_address('::ffff:169.254.169.254')
v6_meta.is_link_local # False
```
- **원인**: `IPv6Address`의 불리언 속성은 IPv6 주소 공간 자체만을 기준으로 판정하므로, 내장된 IPv4 주소의 루프백/링크로컬 특성을 반영하지 않는다.
- **방어 규칙**:
  `addr.version == 6`인 경우 반드시 `addr.ipv4_mapped`를 확인해야 한다. `addr.ipv4_mapped`가 `None`이 아니면 매핑 해제된 `IPv4Address` 객체를 추출하여 IPv4 기준의 루프백, 사설, 링크로컬, 메타데이터 차단 규칙을 재검사해야 한다.

### 3.3 비정상 IP 표기(Octal/Hex/Dword)와 C 리졸버(libc)의 불일치
- Python `ipaddress.ip_address()`는 `'0177.0.0.1'`, `'0x7f000001'`, `'2130706433'`, `'127.1'`에 대해 `ValueError`를 발생시킨다.
- 그러나 운영체제 [`socket.getaddrinfo()`](https://docs.python.org/3/library/socket.html)를 호출하면 시스템 C 라이브러리(`inet_aton`/`getaddrinfo`)가 이를 숫자로 해석하여 `['127.0.0.1']`로 변환하여 반환한다.
- **방어 규칙**:
  URL 문자열 파싱만으로 "정상적인 일반 도메인"으로 오판해서는 안 되며, `socket.getaddrinfo()`가 반환한 **해석 결과 IP 주소**를 `ipaddress.ip_address()`로 변환하여 특수 대역 검사를 전수 수행해야 한다.

### 3.4 IDNA(Internationalized Domain Names) 및 유니코드 정규화 우회
- [RFC 5890](https://www.rfc-editor.org/rfc/rfc5890.html), [RFC 5891](https://www.rfc-editor.org/rfc/rfc5891.html) 및 [Unicode UTS #46](https://www.unicode.org/reports/tr46/)에 따른 변환:
  - 전각 숫자 `１２７.０.０.１` (`\uFF11\uFF12\uFF17.\uFF10.\uFF10.\uFF11`): IDNA 변환 시 ASCII `b'127.0.0.1'`로 매핑됨.
  - 전각 점 `127．0．0．1` (`\uFF0E`) 또는 한자 구두점 `127。0。0。1` (`\u3002`): IDNA 정규화 과정에서 일반 dot(`.`)으로 매핑되어 `127.0.0.1`로 해석됨.
- **방어 규칙**:
  원본 호스트명 검증과 함께 IDNA Punycode 변환(`host.encode('idna')`) 및 DNS 리졸버 반환 IP 전수 검사가 필수적이다.

### 3.5 혼합 응답(Mixed Public/Private DNS) 및 DNS Rebinding
- 공격자 제어 DNS 서버가 다음과 같은 응답을 반환할 수 있다:
  - 첫 조회 시 공인 IP, 이후 조회 시 사설 IP(DNS Rebinding).
  - 단일 쿼리에 공인 A 레코드와 사설 A 레코드(`127.0.0.1`), 또는 AAAA 레코드에 `::1`이 혼합되어 반환됨.
- [RFC 8305 (Happy Eyeballs v2)](https://www.rfc-editor.org/rfc/rfc8305.html) 등으로 인해 클라이언트 라이브러리가 여러 IP 중 하나를 임의로 시도할 경우 사설망 접속이 발생할 수 있다.
- **방어 규칙**:
  `socket.getaddrinfo()`가 반환한 **모든 A/AAAA 후보 IP를 전수 검사**해야 한다. 단 하나라도 차단 대역에 속하거나 응답 목록이 비어 있으면 전체 요청을 거부(Fail-Closed)해야 한다. 연결은 반드시 검증을 통과한 단일 IP로 고정해야 한다.

---

## 4. 리다이렉트, 타임아웃(Deadline), 스트림 제어

### 4.1 리다이렉트 정책
- [RFC 9110 §15.4](https://www.rfc-editor.org/rfc/rfc9110.html) 3xx 리다이렉트 처리:
  HTTPX의 자동 리다이렉트 옵션인 `follow_redirects=True`를 사용하면 HTTPX 내부에서 다음 위치로 자동 요청하므로 애플리케이션의 단계별 검증을 우회하게 된다.
- [OWASP SSRF Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) 및 PRD §8.4 준수:
  - `follow_redirects=False` 설정 필수.
  - 301, 302, 303, 307, 308 응답 시 수동 루프에서 `Location` 헤더를 파싱.
  - [RFC 3986 §5](https://www.rfc-editor.org/rfc/rfc3986.html)에 따라 `urllib.parse.urljoin(current_url, location)`으로 대상 결합.
  - 새로운 URL에 대해 스키마(`http/https`), 포트(`80/443`), userinfo 금지를 재검사.
  - 리다이렉트 횟수는 최대 5회로 제한(초과 시 실패 처리).
  - 다음 요청 역시 동일한 검증 transport(DNS 재조회 및 IP 재고정)를 경유.

### 4.2 환경 프록시 및 쿠키 격리
- [HTTPX Client 환경 변수 공식 문서](https://www.python-httpx.org/advanced/clients/):
  HTTPX의 `Client`는 기본값으로 `trust_env=True`를 가진다. 이는 시스템 환경변수(`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `.netrc`)를 자동으로 읽어 적용하므로, 반드시 `trust_env=False`를 지정하여 환경 오염을 차단해야 한다.
- **쿠키 격리 및 비저장**:
  `httpx.Client(cookies=None)`을 전달하더라도 HTTPX 내부에서는 기본 `Cookies()` 객체를 생성하므로, 서버의 `Set-Cookie` 헤더를 파싱하여 내부 jar에 저장하고 후속 요청에 이를 자동 전송한다. 따라서 `cookies=None`이 쿠키 저장을 끈다는 주장은 근거가 없으므로 철회한다.
  - **검증 가능한 대안**:
    1. **매 hop / 요청마다 독립된 일회성 Client 생성**: 리다이렉트 각 단계 및 서로 다른 앱 검사마다 새로운 `httpx.Client` 인스턴스를 생성하고 요청 후 즉시 폐기하여 상태 지속을 원천 차단.
    2. **명시적 Cookie Jar 초기화**: 동일 클라이언트를 재사용해야 할 경우 매 요청 전후로 `client.cookies.clear()`를 호출하거나 쿠키 저장을 거부하는 커스텀 쿠키 정책 적용.
  - **테스트 방법**: `Set-Cookie` 응답 헤더를 반환하는 모의 서버를 구성하고, 리다이렉트 후속 요청이나 다음 대상 검사 요청에 `Cookie` 헤더가 포함되지 않음을 단언(assert)하는 단위 테스트 작성.

### 4.3 총 10초 Deadline 및 타임아웃 계층
- [HTTPX Timeouts 공식 문서](https://www.python-httpx.org/advanced/timeouts/):
  HTTPX의 `httpx.Timeout(connect=3.0, read=5.0, ...)`은 소켓 단계별 타임아웃일 뿐, DNS 조회 + 연결 + TLS + 리다이렉트 최대 5회 + HEAD/GET 대체를 모두 합산한 전체 Deadline을 보장하지 않는다.
- PRD §8.3 제안값: 연결 타임아웃 3초, 전체 deadline 10초.
- **구현 계층**:
  - 비동기 환경: Python 표준 라이브러리 [`asyncio.timeout(10.0)`](https://docs.python.org/3/library/asyncio-task.html) 컨텍스트 매니저를 사용하여 전체 검사 흐름 상위에서 10초 총합 deadline을 강제.
  - 동기 환경: 루프 진입 시 `deadline = time.monotonic() + 10.0`을 기록하고, 각 단계마다 `remaining = deadline - time.monotonic()`을 계산하여 `httpx.Timeout(connect=min(3.0, remaining), read=remaining, ...)` 형태로 잔여 시간을 갱신 적용. 잔여 시간 소진 시 즉시 중단.

### 4.4 HEAD 우선 및 제한된 GET 스트리밍과 헤더 폭탄(Header Bomb)의 한계
- [RFC 9110 §9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html) HEAD 메서드: 본문 없이 헤더만 요청.
- 대상 웹 서버가 405 Method Not Allowed 또는 501 Not Implemented를 반환할 때만 GET으로 대체:
  - `client.stream("GET", url, ...)` 사용.
  - 헤더 확인 후 **본문을 읽지 않고 즉시 `response.close()`를 호출**하여 소켓 종료.
- **헤더 폭탄(Header Bomb) 방어의 한계와 비복호화 터널에서의 미해결 상태**:
  - HTTPX에서 응답을 수신한 뒤 헤더 크기를 검사하는 방식은 이미 하위 HTTP 파서(`h11` 등)가 헤더 바이트 전체를 메모리에 버퍼링하고 파싱한 이후에 실행된다. 따라서 파싱 단계 이전에 발생하는 메모리 고갈이나 헤더 폭탄을 애플리케이션 응답 객체 검사만으로 방어할 수 없다.
  - 현재 **HTTPX 및 httpcore 공개 API 설정으로 파싱 전 원시 응답 헤더 크기를 제한할 수 있는지 여부는 미확인(지원되지 않음)** 상태다.
  - 한편 아웃바운드 프록시의 경우, Squid의 `reply_header_max_size`([Squid reply_header_max_size 문서](http://www.squid-cache.org/Doc/config/reply_header_max_size/)) 같은 서버 응답 헤더 제한 지시어가 존재한다.
  - 그러나 **HTTPS `CONNECT` 터널에서는 프록시가 암호화된 TCP 바이트 스트림만 중계할 뿐 복호화하지 않으므로, 프록시가 응답 헤더를 볼 수 없어 `reply_header_max_size`를 적용할 수 없다**. 이를 프록시에서 강제하려면 프록시가 인증서를 가로채 재서명하는 TLS Bump / MITM 복호화가 필요한데, 이는 원본 서버와의 종단간 TLS 보존 및 인증서 검증 체계를 변경하는 별도의 중대한 보안 결정이므로 기본 후보로 권고하지 않는다.
  - 따라서 **HTTPS 비복호화 경로에서 파싱 전 응답 헤더 상한 강제는 In-Process 트랜스포트와 Outbound Proxy 양쪽 후보 모두에서 미해결일 수 있으며**, `httpcore`/`h11` 계층의 내부 버퍼링 한도 또는 원시 스트림을 제한하는 검증된 egress 컴포넌트가 실제로 이를 제한할 수 있는지 후속 prototype/research가 필요하다.

---

## 5. 아키텍처 비교: In-Process 커스텀 Transport vs. Outbound Proxy

| 비교 항목 | In-Process 커스텀 Transport (`httpcore.NetworkBackend` 연계) | Outbound Forward Proxy (Stripe Smokescreen / Squid) |
|---|---|---|
| **1차 출처** | [httpcore 공식 저장소](https://github.com/encode/httpcore), [HTTPX Transports](https://www.python-httpx.org/advanced/transports/) | [Stripe Smokescreen](https://github.com/stripe/smokescreen), [Squid ACL Docs](http://www.squid-cache.org/Doc/config/acl/) |
| **API 지원 형태** | `httpx.HTTPTransport`는 미지원. `BaseTransport` 상속 및 `httpcore.ConnectionPool` 직접 조합 (내부 연계 경로) | 표준 HTTP/HTTPS 프록시 프로토콜 (`httpx.Client(proxy=...)` 공개 지원) |
| **구성 요소** | 단일 Python 프로세스 (worker 내장) | 별도 프록시 데몬 프로세스 또는 사이드카 컨테이너 |
| **호스트 요구사항** | 추가 프로세스 없음 (단일 호스트 구조에 유리) | 프록시 데몬 실행, 설정, 리소스 모니터링 필요 |
| **IP 고정 및 SNI** | `connect_tcp`에서 IP 연결, `start_tls`에 원래 도메인 전달 (테스트 검증 필수: SNI/Host, HTTP/2 연결 풀 격리) | HTTP `CONNECT` 터널링으로 프록시가 IP 고정, 클라이언트는 터널 위에서 원본 도메인 TLS 수행 |
| **리다이렉트 제어** | 애플리케이션 수동 루프(`follow_redirects=False`)에서 단계별 재검증 | 애플리케이션 수동 루프 필수 (프록시만으로는 리다이렉트 중간 검증 불가) |
| **10초 Deadline 제어** | 애플리케이션 상위 컨텍스트(`asyncio.timeout` 또는 잔여 시간 계산)에서 제어 | 애플리케이션 상위 컨텍스트에서 제어 |
| **원시 헤더 폭탄 방어** | **미확인**: HTTPX/httpcore 공개 설정으로 파싱 전 원시 헤더 제한 불가 (`httpcore`/`h11` 내부 동작 검증 필요) | **HTTPS 비복호화(CONNECT) 경로에서 제한 불가**: 프록시가 암호화된 응답 헤더를 볼 수 없음 (`reply_header_max_size` 미적용). 양쪽 모두 미해결 가능성 존재 |
| **유지보수 위험** | `httpcore` 내부 백엔드 인터페이스 변경 시 추적 유지보수 필요, 버전 잠금 필수 | 외부 프록시 소프트웨어 설정, 패치 및 프로세스 수명주기 관리 필요 |
| **테스트 및 검증성** | Python 단위 테스트(`pytest`), `unittest.mock`으로 인프로세스 완전 검증 가능 | 로컬에 프록시 데몬을 구동하거나 별도 컨테이너 테스트 인프라 필요 |

---

## 6. 배포 환경의 필수 조건 (Network-level Defense-in-Depth)

**핵심 원칙**: 애플리케이션 계층 코드의 검사만으로는 PRD §8.4("앱 코드의 검사와 별도로 네트워크 수준에서 내부망·호스트 내부 서비스·메타데이터 접근을 차단한다")의 별도 네트워크 차단 요구를 충족할 수 없다. 운영 배포 환경은 네트워크 수준의 강제 통제를 반드시 갖추어야 한다.

아래는 환경(로컬 DNS resolver stub, IPv6 지원 여부, 배포 권한 및 격리 체계)에 따라 달라지는 **운영 후보(Operational Candidates)**다.

### 6.1 방화벽 (iptables / nftables) 및 로컬 환경 고려사항
[Linux iptables 매뉴얼](https://man7.org/linux/man-pages/man8/iptables.8.html):
- **운영 후보 1: 인프로세스 worker 직접 송신 차단**:
  - 검사 worker를 전용 비특권 계정(예: `archive-worker`, UID 10001)으로 실행하고 `owner` 매칭 모듈 사용.
  - **로컬 DNS stub 고려 필수**: 만약 호스트가 `systemd-resolved`(`127.0.0.53:53`) 또는 로컬 dnsmasq(`127.0.0.1:53`)를 사용할 경우, `127.0.0.0/8`을 무조건 차단하면 DNS 해석 자체가 불가능해진다. 따라서 로컬 DNS stub IP:53 또는 외부 지정 DNS로의 UDP/TCP 트래픽을 명시적으로 선행 허용해야 한다.
  - **IPv6 규칙(ip6tables / nftables) 필수**: IPv6 루프백(`::1`), ULA(`fc00::/7`), 링크로컬(`fe80::/10`)에 대한 DROP 규칙을 IPv4와 동일하게 강제해야 한다.
  - 사설망(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`) 목적지 패킷 `DROP`.
  - 허용 목적지: 공인 포트(TCP 80, 443) 및 확인된 DNS 포트만 허용.
- **운영 후보 2: Outbound Proxy 도입 시 Egress 제한**:
  - worker 프로세스의 외부 직접 송신(포트 80, 443 포함)을 **전면 차단(DROP)**.
  - worker 프로세스는 오직 로컬 아웃바운드 프록시의 주소/포트(예: `127.0.0.1:4750` 또는 전용 UNIX Domain Socket)로만 패킷을 전송할 수 있도록 강제.
  - 이를 통해 worker 애플리케이션 코드가 우회 경로로 인터넷이나 내부망을 직접 호출하는 행위를 원천 방지.

### 6.2 격리 환경 후보 (네트워크 네임스페이스 및 컨테이너)
[Linux ip-netns 매뉴얼](https://man7.org/linux/man-pages/man8/ip-netns.8.html):
- 검사 worker를 별도의 네트워크 네임스페이스(`ip netns`) 또는 Docker의 격리 네트워크(`internal: true` 컨테이너 + 프록시 연결 전용 네트워크)로 분리.
- 호스트의 loopback(`127.0.0.1`의 FastAPI, SQLite 데몬, 관리자 SSH 등)과의 네트워크 스택을 물리적으로 분리.
- 단, 네임스페이스 생성 및 iptables 설정은 `CAP_NET_ADMIN` / 루트 권한이 필요하므로 배포 플랫폼(Kubernetes, Docker, 일반 VM 등)의 권한 체계에 따라 운영자가 구현 방식을 확정해야 함.

### 6.3 클라우드 메타데이터(IMDS) 보호
[AWS EC2 IMDS 문서](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html), [GCP Metadata 문서](https://cloud.google.com/compute/docs/metadata/overview):
- AWS 환경: IMDSv2 강제(`HttpTokens=required`), 컨테이너 브리지 환경에서 hop limit을 1로 설정(`HttpPutResponseHopLimit=1`)하여 컨테이너 탈취 시 메타데이터 접근 차단.
- 클라우드 공통: 호스트 방화벽에서 worker의 `169.254.169.254:80` 및 `fd00:ec2::254` 접근을 명시적으로 DROP.

---

## 7. 모의 검증 체계 및 Fail-Closed 계약

### 7.1 실제 사설망/메타데이터를 호출하지 않는 모의 검증 전략
실제 사설망 IP나 클라우드 메타데이터 엔드포인트를 호출하는 테스트는 테스트 환경 자체의 보안 위험을 초래하므로 격리된 픽스처로만 검증해야 한다:
1. **IP 분류기 단위 테스트**:
   - `0177.0.0.1`, `0x7f000001`, `2130706433`, `127.1`, `::ffff:127.0.0.1`, `::ffff:169.254.169.254`, `fd00:ec2::254` 등의 벡터를 전달하여 사설/특수 주소가 차단 대상으로 판정되는지 순수 메모리 연산으로 검증.
   - `is_global` 속성과 IANA 특수 대역 대조 로직이 Python 버전 간 일관되게 동작하는지 테스트.
2. **모의 DNS 리졸버 (`unittest.mock` / fixture)**:
   - `socket.getaddrinfo`를 모킹하여:
     - 단일 사설 IP 반환 시 차단 여부.
     - 공인 IP와 사설 IP가 섞인 혼합 DNS 응답 반환 시 전체 차단 여부.
     - 전각/유니코드 IDNA 도메인의 해석 결과 차단 여부.
3. **HTTP 응답 모의 트랜스포트 (`httpx.MockTransport`)**:
   - [HTTPX MockTransport 문서](https://www.python-httpx.org/advanced/transports/#mocktransport)를 활용하여:
     - 405/501 응답 수신 시 GET 스트림으로 전환하는 동작.
     - `Location` 헤더를 포함한 302 응답 시 수동 리다이렉트 카운트(최대 5회) 및 재검증 동작.
     - 응답 헤더 수신 후 본문 없이 즉시 스트림이 닫히는지(`stream.close()`) 검증.
     - `Set-Cookie` 응답을 받았을 때 다음 요청에 `Cookie` 헤더가 누출되지 않는지 검증.

### 7.2 기능 비활성화 Fail-Closed 조건
PRD §8.4에 명시된 대로, 방어 체계가 정상 작동하지 않거나 검증되지 않은 환경에서는 외부 검사 기능이 절대 실행되어서는 안 된다:
1. **Kill-Switch / Feature Flag**:
   - PRD 명시 플래그인 **`HEALTH_CHECK_ENABLED=false`**를 환경 변수의 기본값으로 유지.
   - 방화벽 규칙 검증이나 transport 초기화 검증에 실패할 경우 시스템 시작 시 오류를 내며 외부 검사 큐를 비활성화.
2. **검사 실행 중 Fail-Closed 규칙**:
   - DNS 해석 실패 또는 빈 결과 반환 시: `FAILED` (fail-closed).
   - 반환된 후보 IP 중 단 하나라도 정책 위반 시: `SSRF_BLOCKED` (fail-closed).
   - 허용되지 않은 스키마(`file://`, `ftp://`, `gopher://` 등) 또는 포트(80, 443 외): `POLICY_BLOCKED` (fail-closed).
   - userinfo(`http://user:pass@host/`) 포함 시: `POLICY_BLOCKED` (fail-closed).
   - 리다이렉트 5회 초과 시: `TOO_MANY_REDIRECTS` (fail-closed).
   - 전체 누적 시간 10초 초과 시: `DEADLINE_EXCEEDED` (fail-closed).
   - TLS 인증서 불일치 / 핸드셰이크 실패 시: `TLS_VERIFICATION_FAILED` (fail-closed).

---

## 8. 미확인 위험 및 후속 결정 과제 (HITL Decision)

본 조사는 특정 경로를 임의로 확정하지 않으며, 운영 환경과 인프라 요건에 따라 **운영자/설계자가 프록시 또는 호스트 레벨 통제를 최종 확정하는 후속 HITL(Human-In-The-Loop) 결정**으로 남긴다.

### 8.1 주요 미확인 위험 및 제약 사항
1. **HTTPS 비복호화 환경에서의 원시 응답 헤더 폭탄 제한 미해결**:
   - HTTPX/httpcore 공개 API 수준에서는 파싱 전 원시 응답 헤더 크기 제한을 적용할 수 없으며, 아웃바운드 프록시 역시 HTTPS `CONNECT` 터널 환경에서는 암호화된 헤더를 검사할 수 없음(`reply_header_max_size` 적용 불가).
   - 따라서 파싱 전 원시 헤더 상한 제어는 양쪽 후보 모두에서 미해결 과제일 수 있으며, `httpcore`/`h11` 내부 한도 검증 또는 원시 바이트 스트림 수준의 제한이 가능한지 후속 prototype/research가 요구됨.
2. **httpcore 내부 API 결합 위험**:
   - `httpcore.ConnectionPool(network_backend=...)`을 통한 인프로세스 IP 고정은 HTTPX의 공개 안정 API가 아니며, 라이브러리 업데이트 시 동작이 변경될 위험이 존재함.
3. **DNS 캐싱 및 지연**:
   - 매 검사마다 동기 `socket.getaddrinfo`를 호출할 때 발생하는 네트워크 지연과, 반대로 DNS 캐시 도입 시 발생할 수 있는 캐시 포이즈닝/만료 시점 불일치 위험.

### 8.2 후속 HITL 결정 가이드 (Decision Matrix)
- **선택지 A: 인프로세스 커스텀 트랜스포트 + 호스트 iptables 방화벽**
  - *적합한 경우*: 추가 프로세스(프록시 데몬) 운영 부담을 피하고 단일 호스트 SQLite/FastAPI 구조를 최대한 단순하게 유지하고자 할 때.
  - *필수 선행 조건*: `httpcore` 내부 연계에 대한 버전 고정 및 엄격한 회귀 테스트 스위트 구비, 호스트 루트 권한으로 비특권 계정 전용 iptables/ip6tables 송신 차단 규칙 적용 가능 여부 확인.
- **선택지 B: 전담 아웃바운드 프록시 (Smokescreen / Squid) + Worker Egress 전면 격리**
  - *적합한 경우*: 네트워크 수준의 명확한 책임 경계 분리, 향후 컨테이너/분산 환경으로의 확장을 고려할 때 (단, HTTPS 응답 헤더 검사는 비복호화 터널에서 불가함을 감안).
  - *필수 선행 조건*: 프록시 데몬의 배포/모니터링 체계 수립, worker 프로세스의 직접 외부 송신을 방화벽으로 차단하고 프록시 포트로만 제한하는 인프라 구성.

---

## 9. 1차 출처 (Primary Sources) 참고문헌

모든 기술적 주장과 판정 기준은 아래 공식 1차 출처에 근거한다:

1. [RFC 6890 - Special-Purpose IP Address Registries](https://www.rfc-editor.org/rfc/rfc6890.html)
2. [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml)
3. [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml)
4. [RFC 4291 - IP Version 6 Addressing Architecture](https://www.rfc-editor.org/rfc/rfc4291.html)
5. [RFC 3986 - Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986.html)
6. [RFC 6066 - Transport Layer Security (TLS) Extensions: Extension Definitions (SNI)](https://www.rfc-editor.org/rfc/rfc6066.html)
7. [RFC 6125 - Representation and Verification of Domain-Based Application Service Identity within PKIX](https://www.rfc-editor.org/rfc/rfc6125.html)
8. [RFC 5280 - Internet X.509 Public Key Infrastructure Certificate and Certificate Revocation List (CRL) Profile](https://www.rfc-editor.org/rfc/rfc5280.html)
9. [RFC 9110 - HTTP Semantics (HEAD, GET, 3xx Redirection, Location)](https://www.rfc-editor.org/rfc/rfc9110.html)
10. [RFC 5890 - Internationalized Domain Names for Applications (IDNA): Definitions and Core Framework](https://www.rfc-editor.org/rfc/rfc5890.html)
11. [RFC 5891 - Internationalized Domain Names in Applications (IDNA): Protocol](https://www.rfc-editor.org/rfc/rfc5891.html)
12. [RFC 8305 - Happy Eyeballs Version 2: Better Connectivity Using Concurrency](https://www.rfc-editor.org/rfc/rfc8305.html)
13. [RFC 1918 - Address Allocation for Private Internets](https://www.rfc-editor.org/rfc/rfc1918.html)
14. [RFC 3927 - Dynamic Configuration of IPv4 Link-Local Addresses](https://www.rfc-editor.org/rfc/rfc3927.html)
15. [RFC 4193 - Unique Local IPv6 Unicast Addresses](https://www.rfc-editor.org/rfc/rfc4193.html)
16. [Unicode Technical Standard #46 - Unicode IDNA Compatibility Processing (UTS #46)](https://www.unicode.org/reports/tr46/)
17. [Python 3 Documentation - `ipaddress` — IPv4/IPv6 manipulation library](https://docs.python.org/3/library/ipaddress.html)
18. [Python 3 Documentation - `socket` — Low-level networking interface](https://docs.python.org/3/library/socket.html)
19. [Python 3 Documentation - `ssl` — TLS/SSL wrapper for socket objects](https://docs.python.org/3/library/ssl.html)
20. [Python 3 Documentation - `asyncio` — Asynchronous I/O (Timeouts)](https://docs.python.org/3/library/asyncio-task.html)
21. [HTTPX Documentation - Timeouts](https://www.python-httpx.org/advanced/timeouts/)
22. [HTTPX Documentation - Custom Transports](https://www.python-httpx.org/advanced/transports/)
23. [HTTPX Documentation - Advanced Client Usage](https://www.python-httpx.org/advanced/clients/)
24. [Encode httpcore - GitHub Source Repository](https://github.com/encode/httpcore)
25. [Encode httpx - GitHub Source Repository](https://github.com/encode/httpx)
26. [Stripe Smokescreen - An HTTP CONNECT proxy service for securing outbound traffic](https://github.com/stripe/smokescreen)
27. [Squid Configuration Guide - Access Control Lists (ACL)](http://www.squid-cache.org/Doc/config/acl/)
28. [Squid Configuration Guide - http_access](http://www.squid-cache.org/Doc/config/http_access/)
29. [Squid Configuration Guide - reply_header_max_size](http://www.squid-cache.org/Doc/config/reply_header_max_size/)
30. [OWASP Cheat Sheet Series - Server-Side Request Forgery Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
31. [AWS EC2 User Guide - Retrieve instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html)
32. [Google Cloud Compute Engine - Overview of instance metadata](https://cloud.google.com/compute/docs/metadata/overview)
33. [Linux man-pages - `iptables(8)`](https://man7.org/linux/man-pages/man8/iptables.8.html)
34. [Linux man-pages - `ip-netns(8)`](https://man7.org/linux/man-pages/man8/ip-netns.8.html)
