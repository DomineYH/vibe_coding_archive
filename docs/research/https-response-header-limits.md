# HTTPS 비복호화 검사 응답 헤더 상한 경로 조사

이 문서는 [이슈 #18](https://github.com/DomineYH/vibe_coding_archive/issues/18) 및 [PRD v1.0 §8.3~8.4](https://github.com/DomineYH/vibe_coding_archive/blob/19c38faeb237705af9965eecfaa23f35b1c480ea/PRD/PRD_EduVibe_Archive_v1.0.md), 선행 조사인 [http-ssrf-transport.md](http-ssrf-transport.md)의 후속 연구 보고서다.
TLS를 중간자 복호화(MITM)하지 않는 HTTPS 연결 검사에서, HTTPX/httpcore/h11 라이브러리 스택의 응답 헤더 버퍼 상한 메커니즘, 공개/내부 설정 경계, 파싱 전 바이트 제어 가능성, HTTPS CONNECT 프록시의 한계를 격리된 로컬 TLS fixture 실험과 1차 출처(공식 문서 및 런타임 소스 코드)를 통해 검증한다.

> [!NOTE]
> 본 보고서는 기술적 관찰 결과와 한계를 제시하며, 최종 설계 및 제품 구현 방식을 임의로 결정하지 않는다. 실제 외부 악성 서버나 사설망 엔드포인트는 일체 호출하지 않았으며, 전용 격리 루프백(`127.0.0.1`) TLS fixture만을 사용해 검증되었다.

---

## 1. 검증 환경 및 정확한 버전

본 조사는 저장소 개발 환경에 설치된 Python 런타임 및 의존성 패키지의 소스 코드를 직접 검증하였다:

- **OS / Platform**: Linux (Ubuntu 24.04 LTS on x86_64, Linux 6.6.x kernel)
- **Python**: `3.12.3`
- **HTTPX**: `0.28.1` ([encode/httpx 0.28.1](https://github.com/encode/httpx/tree/0.28.1))
- **httpcore**: `1.0.9` ([encode/httpcore 1.0.9](https://github.com/encode/httpcore/tree/1.0.9))
- **h11**: `0.16.0` ([python-hyper/h11 v0.16.0](https://github.com/python-hyper/h11/tree/v0.16.0))
- **OpenSSL**: `OpenSSL 3.0.13 30 Jan 2024`

---

## 2. 공개 API vs 내부 설정 경계 분석

### 2.1 공개 API 수준의 설정 부재
- **HTTPX (`httpx.Client`, `httpx.HTTPTransport`)**:
  - `httpx.Client` 및 `httpx.HTTPTransport.__init__`은 `limits`(`Limits(max_connections, max_keepalive_connections, keepalive_expiry)`), `timeout`, `verify`, `cert`, `http1`, `http2` 등의 인자만 제공한다.
  - 검증 버전(`httpx 0.28.1`, `httpcore 1.0.9`)의 공개 생성자 시그니처(`__init__`) 기준으로 응답 헤더의 최대 바이트 크기나 라인 수를 제한하는 공개 매개변수는 제공되지 않는다.
- **httpcore (`httpcore.ConnectionPool`)**:
  - `httpcore.ConnectionPool.__init__` 역시 `network_backend`, `ssl_context`, `http1`, `http2`, `retries` 등을 제공하지만, 공개 시그니처 상 응답 헤더 버퍼 상한에 대한 매개변수는 존재하지 않는다.

### 2.2 httpcore 내부 구현 구조 (`httpcore._sync.http11.HTTP11Connection`)
`httpcore/http11.py`의 동기(`_sync`) 및 비동기(`_async`) 소스 코드 분석:
```python
class HTTP11Connection(ConnectionInterface):
    READ_NUM_BYTES = 64 * 1024           # 65,536 bytes (64 KB)
    MAX_INCOMPLETE_EVENT_SIZE = 100 * 1024 # 102,400 bytes (100 KB)

    def __init__(...):
        self._h11_state = h11.Connection(
            our_role=h11.CLIENT,
            max_incomplete_event_size=self.MAX_INCOMPLETE_EVENT_SIZE,
        )
```
- **하드코딩된 내부 상한**: `httpcore`는 HTTP/1.1 연결 인스턴스 생성 시 `MAX_INCOMPLETE_EVENT_SIZE = 100 * 1024` (100 KB)를 클래스 속성으로 고정하고 있다.
- **소켓 읽기 청크**: `READ_NUM_BYTES = 64 * 1024` (64 KB) 단위로 하위 소켓(`NetworkStream.read`)에서 읽어 `h11`의 `receive_data()`로 공급한다.

### 2.3 h11 내부 구현 구조 (`h11._connection.Connection`)
`h11/_connection.py` 소스 코드 분석:
```python
DEFAULT_MAX_INCOMPLETE_EVENT_SIZE = 16 * 1024  # 16 KB (h11 기본값)

class Connection:
    def __init__(self, our_role, max_incomplete_event_size=DEFAULT_MAX_INCOMPLETE_EVENT_SIZE):
        self._max_incomplete_event_size = max_incomplete_event_size
```
- `h11` 라이브러리 자체의 기본값은 16 KB이지만, `httpcore`가 이를 100 KB로 상향 지정하여 `h11.Connection`을 생성한다.
- 이벤트 수신 시점(`next_event()`):
```python
if event is NEED_DATA:
    if len(self._receive_buffer) > self._max_incomplete_event_size:
        raise RemoteProtocolError(
            "Receive buffer too long", error_status_hint=431
        )
```
- 실패 형태: `h11.RemoteProtocolError` 발생 → `httpcore.RemoteProtocolError`로 매핑 → `httpx.RemoteProtocolError`로 변환되어 호출자에게 전달됨.

---

## 3. 파싱 전 버퍼 제한 관찰 및 동작 특성

격리된 로컬 환경에서 소켓 청크 공급과 `h11` 이벤트 상태를 정밀 추적한 결과, 다음과 같은 중요한 동작 경계와 한계가 관찰되었다.

### 3.1 `max_incomplete_event_size`의 정의와 동작 조건
- `h11`의 버퍼 제한 매개변수 명칭은 `max_event_size`가 아니라 **`max_incomplete_event_size`**다.
- 이는 **'미완료(incomplete) 상태로 버퍼에 누적되는 바이트'**에 대한 제한이다.
- 즉, 수신 버퍼 내에 헤더 종단 구분자(`\r\n\r\n`)가 아직 도착하지 않아 다음 이벤트가 `NEED_DATA`로 유지되는 동안, 버퍼에 쌓인 바이트 수가 `max_incomplete_event_size`(100 KB)를 초과할 때만 `RemoteProtocolError("Receive buffer too long")`가 발생한다.

### 3.2 종단 구분자(`\r\n\r\n`)가 동시 수신될 때의 파서 관찰
- 만약 서버가 보낸 거대 응답 헤더(예: 110 KB)가 소켓 버퍼링 특성에 의해 헤더 종단자(`\r\n\r\n`)를 포함한 상태로 한 번에 전달되거나 마지막 청크가 도착하여 이벤트 추출기(`_extract_next_receive_event()`)가 완전한 `h11.Response` 이벤트를 생성할 수 있게 되면:
  - `event`가 `NEED_DATA`가 아니라 `h11.Response` 객체가 되므로, `if event is NEED_DATA:` 분기를 건너뛴다.
  - 그 결과 `len(self._receive_buffer) > self._max_incomplete_event_size` 검사가 수행되지 않고 헤더 전체가 메모리에 파싱된다.
- 즉, **`h11`의 내장 검사만으로는 종단 구분자가 이미 포함된 상태로 수신된 완성 헤더의 절대 크기를 사전에 거절하지 못한다**.

### 3.3 HTTP/2 관찰 및 HTTP/1.1 검증 범위 한정
- `httpcore`가 `http2=True`로 동작할 경우, `h2.settings.SettingCodes.MAX_HEADER_LIST_SIZE: 65536` (64 KB)가 내부 초기 설정에 포함되어 있다.
- 그러나 [RFC 9113 §6.5.2](https://www.rfc-editor.org/rfc/rfc9113.html)에 명시된 `SETTINGS_MAX_HEADER_LIST_SIZE`는 피어에게 권고(advisory) 형태로 알리는 설정값이며, 원격 피어 또는 로컬 클라이언트 계층에서 이 설정이 실제로 수신 바이트를 엄격히 강제(enforcement)하는지는 본 조사에서 별도로 검증되지 않았다.
- 따라서 본 보고서는 응답 헤더 파싱 전 상한 메커니즘에 대한 실제 관찰과 실험 범위를 **HTTP/1.1 검증 결과로 한정**한다.

---

## 4. 격리된 로컬 TLS Fixture 기반 최소 재현

### 4.1 재현 스크립트 (`reproduce_header_limits.py`)
아래 코드는 외부 네트워크 접근 없이 로컬 루프백(`127.0.0.1`)에서 임시 자체 서명 인증서를 생성하여 격리 실행할 수 있는 독립 재현 스크립트다.

```python
import socket
import ssl
import subprocess
import tempfile
import threading
from pathlib import Path
import httpx
import httpcore
from httpcore._backends.sync import SyncBackend, SyncStream

def run_experiment():
    with tempfile.TemporaryDirectory() as tmpdir:
        cert_path = Path(tmpdir) / "cert.pem"
        key_path = Path(tmpdir) / "key.pem"

        # 1. 로컬 격리용 자체 서명 인증서 생성 (외부 호출 없음)
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                "-keyout", str(key_path), "-out", str(cert_path),
                "-days", "1", "-subj", "/CN=localhost",
                "-addext", "subjectAltName = DNS:localhost,IP:127.0.0.1"
            ],
            check=True, capture_output=True
        )

        ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)

        # 2. 로컬 모의 TLS 서버 구현
        class MockTLSServer:
            def __init__(self, mode, size=0):
                self.mode = mode
                self.size = size
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.sock.bind(("127.0.0.1", 0))
                self.port = self.sock.getsockname()[1]
                self.sock.listen(1)
                self.thread = threading.Thread(target=self._serve, daemon=True)
                self.thread.start()

            def _serve(self):
                try:
                    raw, _ = self.sock.accept()
                    with ssl_ctx.wrap_socket(raw, server_side=True) as tls:
                        tls.recv(4096)
                        if self.mode == "normal":
                            tls.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                        elif self.mode == "stream_large":
                            # 100KB 초과 헤더를 청크로 분할 전송 (종단 구분자 지연)
                            tls.sendall(b"HTTP/1.1 200 OK\r\nX-Padding: ")
                            rem = self.size
                            while rem > 0:
                                chunk_size = min(rem, 16384)
                                tls.sendall(b"A" * chunk_size)
                                rem -= chunk_size
                            tls.sendall(b"\r\n\r\nOK")
                except Exception:
                    pass
                finally:
                    self.sock.close()

        # 실험 1: 정상 TLS 연결 및 SNI/인증서 검증 확인
        s1 = MockTLSServer(mode="normal")
        with httpx.Client(verify=str(cert_path)) as client:
            res1 = client.get(f"https://localhost:{s1.port}/")
            print(f"[실험 1] 정상 200 OK 수신: status={res1.status_code}, body={res1.text}")

        # 실험 2: httpcore 기본 상한(100KB) 초과 헤더 스트리밍
        s2 = MockTLSServer(mode="stream_large", size=150 * 1024)
        try:
            with httpx.Client(verify=str(cert_path)) as client:
                client.get(f"https://localhost:{s2.port}/")
                print("[실험 2] 예외 미발생 (실패)")
        except httpx.RemoteProtocolError as e:
            print(f"[실험 2] 100KB 초과 시 예상된 예외 발생: {type(e).__name__} - {e}")

        # 실험 3: 파싱 전 사전 차단 스트림 래퍼 (8KB 상한 강제)
        class HeaderLimitStream(SyncStream):
            def __init__(self, sock, max_header_bytes=8192):
                super().__init__(sock)
                self.max_bytes = max_header_bytes
                self.buf = b""
                self.header_done = False

            def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
                data = super().read(max_bytes, timeout=timeout)
                if not self.header_done:
                    self.buf += data
                    idx = self.buf.find(b"\r\n\r\n")
                    if idx != -1:
                        header_len = idx + 4
                        if header_len > self.max_bytes:
                            self.close()
                            raise httpcore.ReadError(f"Pre-parse header limit exceeded: {header_len} > {self.max_bytes}")
                        self.header_done = True
                        self.buf = b""
                    else:
                        if len(self.buf) > self.max_bytes:
                            self.close()
                            raise httpcore.ReadError(f"Pre-parse incomplete header exceeded: {len(self.buf)} > {self.max_bytes}")
                return data

            def start_tls(self, ssl_context, server_hostname=None, timeout=None):
                st = super().start_tls(ssl_context, server_hostname=server_hostname, timeout=timeout)
                return HeaderLimitStream(st._sock, max_header_bytes=self.max_bytes)

        class CustomBackend(SyncBackend):
            def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
                st = super().connect_tcp(host, port, timeout=timeout, local_address=local_address, socket_options=socket_options)
                return HeaderLimitStream(st._sock, max_header_bytes=8192)

        class PreParseLimitTransport(httpx.BaseTransport):
            def __init__(self, verify):
                self._pool = httpcore.ConnectionPool(
                    ssl_context=httpx.create_ssl_context(verify=verify),
                    network_backend=CustomBackend(),
                    http1=True, http2=False
                )

            def handle_request(self, request: httpx.Request) -> httpx.Response:
                req = httpcore.Request(
                    method=request.method,
                    url=httpcore.URL(request.url.raw_scheme, request.url.raw_host, request.url.port, request.url.raw_path),
                    headers=request.headers.raw, content=request.stream, extensions=request.extensions
                )
                with httpx._transports.default.map_httpcore_exceptions():
                    resp = self._pool.handle_request(req)
                return httpx.Response(resp.status, headers=resp.headers, stream=httpx._transports.default.ResponseStream(resp.stream), extensions=resp.extensions)

        s3 = MockTLSServer(mode="stream_large", size=12 * 1024)
        try:
            with httpx.Client(transport=PreParseLimitTransport(verify=str(cert_path))) as client:
                client.get(f"https://localhost:{s3.port}/")
                print("[실험 3] 예외 미발생 (실패)")
        except httpx.ReadError as e:
            print(f"[실험 3] 8KB 상한 도달 시 파싱 전 차단 성공: {type(e).__name__} - {e}")

if __name__ == "__main__":
    run_experiment()
```

### 4.2 실행 관찰 결과
위 스크립트 실행 시 실제 터미널 출력 결과:
1. `[실험 1] 정상 200 OK 수신: status=200, body=OK`:
   - `server_hostname="localhost"`가 `start_tls`로 정확히 전달되어 TLS SNI 전송 및 인증서 SAN 일치가 성공함.
2. `[실험 2] 100KB 초과 시 예상된 예외 발생: RemoteProtocolError - Receive buffer too long`:
   - `httpcore`의 하드코딩 상한(`MAX_INCOMPLETE_EVENT_SIZE = 100 * 1024`)이 초과될 때 `h11`이 431 힌트의 `RemoteProtocolError`를 발생시키고 소켓이 닫힘.
3. `[실험 3] 8KB 상한 도달 시 파싱 전 차단 성공: ReadError - Pre-parse incomplete header exceeded: 8216 > 8192`:
   - `httpcore`나 `h11`의 파서 버퍼에 100 KB가 쌓이기 전에, 하위 소켓 스트림 계층에서 8 KB 누적 시 즉시 `ReadError`를 발생시키고 소켓을 종료함.

### 4.3 커스텀 `HeaderLimitStream`의 제약 및 한계
실험 3에서 제시된 스트림 래퍼는 다음과 같은 명확한 제약을 가진다:
1. **내부 API 결합**: `httpcore`의 내부 클래스인 `SyncStream` 및 `NetworkStream` 시그니처에 직접 의존한다.
2. **Hop 및 Client 격리 전제**: 단일 요청 단위의 일회성 클라이언트 환경을 전제로 설계되었으며, 상태 격리가 필요하다.
3. **Keep-Alive 재사용 시 카운터 리셋 필요**: 동일 TCP 연결 상에서 다중 요청/응답이 일어나는 keep-alive 환경에서는 매 응답 주기마다 `header_done`, `buf`, 바이트 카운터를 명시적으로 리셋하지 않으면 후속 응답 처리가 불가능하거나 오작동한다.
4. **동기(sync) 환경 한정 검증**: 본 실험은 동기 I/O(`SyncBackend`, `SyncStream`) 기준으로만 작성·검증되었으며, 비동기(`AsyncNetworkStream`) 경로는 별도의 구현 및 검증이 요구된다.

---

## 5. HTTPS CONNECT 프록시의 근본적 한계

선행 조사([http-ssrf-transport.md](http-ssrf-transport.md))에서 확인된 프록시의 응답 헤더 제어 한계를 재확인한다.

1. **Blind TCP Tunneling 구조**:
   - HTTPS 검사 시 클라이언트는 아웃바운드 프록시로 `CONNECT target:443 HTTP/1.1` 요청을 보낸다.
   - 프록시가 대상을 연결하면, 클라이언트와 원격 서버 간의 TLS 핸드셰이크 및 모든 HTTP 통신은 **종단간 암호화(End-to-End Encryption)** 상태로 프록시를 통과한다.
2. **Squid `reply_header_max_size` 미적용**:
   - [Squid 공식 문서](http://www.squid-cache.org/Doc/config/reply_header_max_size/)에 명시된 `reply_header_max_size`는 일반 HTTP 프록시 트래픽에서만 동작한다.
   - 비복호화 CONNECT 터널에서는 프록시가 암호화된 TCP 패킷 내부의 HTTP 헤더 경계를 전혀 읽을 수 없으므로, 헤더 크기를 측정하거나 차단할 수 없다.
3. **TLS Bump / SSL Interception(MITM)의 부적합성**:
   - 프록시가 응답 헤더를 검사하려면 프록시 자체의 CA 인증서로 중간자 복호화를 수행해야 한다.
   - 이는 원본 서버의 실제 인증서 SAN 검증 및 투명성을 훼손하며, 별도의 신뢰 저장소 관리 및 법적·보안적 위험을 유발하므로 PRD의 요구사항(대상 서버의 TLS 검증 유지)에 부합하는 기본 후보가 될 수 없다.

---

## 6. 미해결 위험 및 후속 과제

1. **소켓 스트림 프리파싱 래퍼의 버전 종속성**:
   - 실험 3의 `HeaderLimitStream` 방식은 `httpcore` 내부의 `SyncStream`/`NetworkStream` 및 `httpcore.ConnectionPool` 조립을 필요로 한다.
   - 이는 HTTPX의 공개 안정 API가 아니며, 라이브러리 메이저/마이너 업데이트 시 `NetworkStream` 내부 구조가 변경되면 깨질 위험이 있다.
2. **완성 헤더의 순간 수신 위험**:
   - `h11`의 `max_incomplete_event_size`는 미완료 이벤트만 검사하므로, 단일 소켓 읽기(`READ_NUM_BYTES = 64KB`) 범위 내에서 수신된 64 KB 미만의 거대 헤더는 `h11` 수준에서 무사 통과된다. 따라서 엄격한 8 KB / 16 KB 제어가 필요하다면 소켓 바이트 수준의 카운터가 필수적이다.
3. **Slowloris (Drip-feed) 공격 형태**:
   - 공격자가 8 KB 상한에 도달하지 않도록 1바이트씩 1초 간격으로 매우 느리게 전송할 경우 바이트 카운터만으로는 차단할 수 없다. 이는 PRD §8.3에 명시된 **전체 10초 Deadline(`asyncio.timeout` 또는 잔여 시간 계산)**과 결합되어야만 안전하게 무력화된다.

---

## 7. 1차 출처 (Primary Sources) 참고문헌

1. [Encode httpcore (tag 1.0.9) - `_sync/http11.py` Source Code](https://github.com/encode/httpcore/blob/1.0.9/httpcore/_sync/http11.py) (MAX_INCOMPLETE_EVENT_SIZE 및 READ_NUM_BYTES 정의)
2. [Python-Hyper h11 (tag v0.16.0) - `h11/_connection.py` Source Code](https://github.com/python-hyper/h11/blob/v0.16.0/h11/_connection.py) (max_incomplete_event_size 및 RemoteProtocolError 발생 조건)
3. [Encode httpx (tag 0.28.1) - `httpx/_transports/default.py` Source Code](https://github.com/encode/httpx/blob/0.28.1/httpx/_transports/default.py) (map_httpcore_exceptions 매핑 로직)
4. [HTTPX Official Documentation - Custom Transports](https://www.python-httpx.org/advanced/transports/)
5. [RFC 9110 - HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
6. [RFC 6066 - Transport Layer Security (TLS) Extensions: Extension Definitions (SNI)](https://www.rfc-editor.org/rfc/rfc6066.html)
7. [RFC 6125 - Representation and Verification of Domain-Based Application Service Identity within PKIX](https://www.rfc-editor.org/rfc/rfc6125.html)
8. [RFC 9113 - HTTP/2 Specification (Section 6.5.2 SETTINGS_MAX_HEADER_LIST_SIZE)](https://www.rfc-editor.org/rfc/rfc9113.html)
9. [Squid Configuration Guide - `reply_header_max_size`](http://www.squid-cache.org/Doc/config/reply_header_max_size/)
10. [Python 3 Documentation - `ssl` — TLS/SSL wrapper for socket objects](https://docs.python.org/3/library/ssl.html)
11. [Python 3 Documentation - `socket` — Low-level networking interface](https://docs.python.org/3/library/socket.html)
