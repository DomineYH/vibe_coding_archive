# Health Worker Deadline, Concurrency, and Cancellation Experiment Suite

이 디렉터리는 GitHub 이슈 #25 및 관련 연구 보고서(`docs/research/health-worker-deadline-cancellation.md`)의 실측 실험 코드를 담고 있다.

모든 실험은 외부 네트워크 접근 없이 로컬 루프백(`127.0.0.1`)과 격리된 모의 TLS 서버를 통해 수행되며, 자체 서명 인증서와 임시 SQLite 데이터베이스는 `tempfile.TemporaryDirectory()` 내부에서 동적으로 생성되고 실행 종료 시 자동 삭제된다.

## 1. 실행 환경 요구사항

- **OS**: Linux (x86_64, Ubuntu 24.04 LTS 권장, `/proc/self/fd` 접근 필요)
- **Python**: `3.12+`
- **의존 라이브러리**:
  - `httpx >= 0.28.0`
  - `httpcore >= 1.0.9`
  - `h11 >= 0.16.0`
  - `anyio >= 4.0.0`
  - `dnspython >= 2.8.0` (후보 iv 비동기 DNS 검증용)
  - `openssl` CLI (자체 서명 테스트 인증서 생성용)

## 2. 재현 실행 명령

저장소 루트 디렉터리에서 다음 명령을 실행한다:

```bash
python3 docs/research/health-worker-deadline-cancellation/suite.py
```

## 3. 검증 대상 및 구성

`suite.py`는 보고서에 기술된 핵심 검증 사례와 4개 후보 실행 모델 비교를 직접 수행한다:

- **Case 1 (정상 요청 및 SAN 불일치 음성 시험)**:
  - 동기(`Sync`) 및 비동기(`Async`) 경로 각각에서 정상 200 OK 수신 및 SNI/인증서 SAN 일치 확인.
  - SAN에 포함되지 않은 `wrong.domain.local` 요청 시 `SSLCertVerificationError` 및 `Hostname mismatch` 오류로 즉시 거부되는 음성 시험(Sync & Async) 단언 확인.
- **Case 2 (DNS 정체 모의 및 취소 관찰)**:
  - glibc getaddrinfo는 프로세스 단위 nameserver 지정이 불가하므로 `time.sleep` 기반 모의 함수를 사용.
  - 동기 스레드: 호출자 타임아웃 반환 후 백그라운드 스레드 잔류 실측.
  - 비동기 executor: `asyncio.timeout`에 의한 코루틴 취소 시점 실측 (0.504s). 단, `asyncio.run()` 공식 문서에 따라 루프 종료 시 `loop.shutdown_default_executor()`가 스레드 완료를 대기하므로 호출자 최종 복귀 지연 명시.
  - 프로세스 격리: 모의 sleep 자식 대상 `SIGKILL` 전송 후 커널 수준 프로세스 회수 실측 (0.14ms). (소켓 통신 중인 자식 회수는 구현 단계 검증 필요).
  - 후보 (iv) `dnspython.asyncresolver`: 응답 없는 로컬 UDP 소켓 대상 취소 시 스레드 잔류 0개 및 소켓 FD 회수 실측.
- **Case 3 (TLS 정체)**: 서버의 핸드셰이크 중단에 대해 누적 deadline 기준 타임아웃 강제 (Sync & Async).
- **Case 4 (Drip-feed Slowloris)**: 0.1초당 1바이트 전송 시 HTTPX 기본 per-read 10초 타임아웃 무력화 및 단조 시계 기반 누적 deadline(0.8s) 강제 차단 (Sync & Async).
- **Case 5 (32 KiB 경계 및 초과)**: 32,768 바이트 통과 및 32,769 바이트 파싱 전 사전 차단 (Sync & Async). 초과 시 `last_stream.is_closed == True`를 통한 하위 소켓 스트림 종료 단언 확인.
- **Case 6 (완성 대형 청크 및 중간 1xx 누적)**:
  - 단일 청크 40 KiB 완성 헤더 파싱 전 차단.
  - 103 Early Hints (20 KiB) + 최종 200 OK (15 KiB) = 35 KiB 누적 차단 (Sync & Async).
- **Case 7 (HEAD→GET→리다이렉트 합산 deadline)**: 요청 단계별 클라이언트 재생성 시에도 전체 누적 deadline 유지 (Sync & Async). (DNS 및 TCP 결합 전체 10초는 구현 단계 검증 필요).
- **Case 8 (실측 자원 추적 및 4대 후보 모델 비교)**:
  - 3개 포화 상태에서 1개 취소 시 살아 있는 resolver 스레드 수, 열린 소켓 FD 수(/proc/self/fd 프로세스 전체 기준), 실질 동시성 시계열 측정.
  - 후보 (i) 순수 async: 스레드 잔류 수용 및 실질 동시성 4 관찰.
  - 후보 (ii) 크기 3 전용 executor async: 스레드 종료까지 슬롯 점유하여 동시성 3 유지하되 OS resolver timeout 동안 슬롯 고착 관찰.
  - 후보 (iii) 자식 프로세스 격리: `SIGKILL` 회수 후 즉시 슬롯 교체 및 동시성 3 유지 (모의 자식 대상).
  - 후보 (iv) `dnspython.asyncresolver` async: 스레드 생성 없는 비동기 DNS로 스레드 잔류 0개, 슬롯 고착 0초, 실질 동시성 3 유지.
  - **후보 (iv) Q6 엄격 규칙 실측 (6종 단언)**: `(not ip.is_global) or ip.is_multicast` 판정 및 NoAnswer 처리 규칙 적용. 224.0.0.1 차단, 100.64.0.1 차단, IPv4+NoAnswer 선택(8.8.8.8), IPv6 전용 선택(2001:4860:4860::8888), AAAA 타임아웃 차단, 혼합 금지 IP 차단 실측 단언.
- **Case 9 (SQLite 원자적 CAS Fencing)**: `attempts` fencing token 및 `status='running'`, `lease_until REAL` Unix epoch 수치 비교를 통한 늦은 완료(Stale Write) 방어.
- **glibc RES_OPTIONS 조사**: `resolv.conf(5)`의 `RES_OPTIONS` 옵션 확인. `timeout:1 attempts:1`이더라도 단일 API 호출 전체 상한은 미보장됨을 명시하며, 프로세스 단위 nameserver 오버라이드 환경변수 부재로 인한 루프백 UDP redirection의 미검증 분류 확인.
