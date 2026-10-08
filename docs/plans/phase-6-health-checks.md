# Phase 6 — 실제 HTTP 연결 검사

2026-10-07 사용자가 권장안을 일괄 위임했다. 이번 범위는 개별·전체 검사, 영속 큐, 별도 worker, 복구·경합, 기존 화면 연결과 가능한 로컬 통합 검증이다. 실제 호스트 검증과 운영자의 활성화 승인은 별도이며 미실행을 PASS로 기록하지 않는다.

## 원천과 결정

- [PRD §8, Phase 6](../../PRD/PRD_EduVibe_Archive_v1.0.md), [결과·제한 #11](https://github.com/DomineYH/vibe_coding_archive/issues/11), [API #12](https://github.com/DomineYH/vibe_coding_archive/issues/12), [worker #14](https://github.com/DomineYH/vibe_coding_archive/issues/14), [로컬 검증 #29](https://github.com/DomineYH/vibe_coding_archive/issues/29), [운영 #16](https://github.com/DomineYH/vibe_coding_archive/issues/16), [단계 수락 #17](https://github.com/DomineYH/vibe_coding_archive/issues/17)의 최종 결정을 계승한다.
- Phase 5 구현 PR #179–#183 및 #185는 병합됐다. Phase 5 종합 수락 기록은 확인되지 않았으며, 이번 사용자의 구현 지시를 착수 권한으로 기록한다. 과거 수락을 소급 생성하지 않는다.
- [#158](https://github.com/DomineYH/vibe_coding_archive/issues/158)의 등록 정책은 유지한다. 검사에서는 식별 가능한 IPv6 변환 대역을 전체 차단한다. 정확한 대역과 근거는 transport 정책 및 테스트에 기록한다. 사설 주소를 가진 저장 URL도 검사 때 다시 판정한다.
- API는 현재 권한·Origin·CSRF 검증 후 검사 접수/조회만 담당하고, 네트워크는 별도 worker만 실행한다. API 실패를 mock 성공으로 대체하지 않는다.

## 구현 단위와 의존 관계

| 작업 | 선행 | 검증 가능한 결과 |
|---|---|---|
| H1 안전한 검사 실행 | 없음 | 통제 DNS/HTTP에서 결과 분류·고정 IP·redirect·전체 기한·헤더 상한·종료 검증 |
| H2 영속 검사 작업과 배치 | 없음 | 실제 SQLite에서 개별/배치 접수·공유·제한·claim·결과 반영·삭제/URL 경합·복구·보관 검증 |
| H3 기존 화면용 API 연결 | H2 인터페이스 | 현재 권한을 적용한 검사/진행 API 5개와 capabilities·기존 표시/통계 연결 |
| H4 별도 worker 실행 | H1, H2 | 최대 3개 실행·단독 잠금·생존 신호·정상 종료·중단 복구·명시 중지 |
| H5 결합 검수 | H1–H4 | 실제 API/파일 DB/worker와 브라우저의 연결, 영향 회귀, 실행 증거 및 운영 미검증 인계 |

## 검증 경계

사용자의 권장안 일괄 위임에 따라 다음 경계를 채택한다. (1) 실제 HTTP API와 임시 migration DB: 권한, 중복, 상태, 배치와 경합을 관찰한다. (2) 검사 실행 공개 함수와 주입 가능한 DNS/HTTP I/O: 외부 송신 없이 정책·결과를 확인한다. (3) 별도 프로세스와 통제 소켓: 종료와 실제 자원 수명을 확인한다. DB 제약·원자성은 저장소 기존 계약대로 직접 관찰한다. 실제 DNS/TLS·호스트 방화벽·VM suspend 검증의 미실행 항목은 별도 원장에 남긴다.

## 완료 기준

- 개별 검사와 관리자 배치의 화면→API→DB→worker→조회 동작을 검증한다.
- 200/204/403/404/500, DNS/TLS 실패, timeout, HEAD 405/501→GET, redirect/차단, 32 KiB 경계, 전체 deadline, 현재 권한, 중복·한도, 삭제/URL 변경, lease/attempts·재시작·보관을 시험한다.
- worker 종료·생존 유실과 대상 사이트 실패를 구분하고 이전 연결 결과를 보존한다.
- 설정은 기본 비활성이다. 실제 송신은 승인된 빌드·의존성·송신 설정을 검증하는 활성화 경계를 통과해야 한다.
- 표적 검사 후 공유 schema·설정·공개 DTO 변경의 전체 영향 회귀를 한 번 수행한다. 실패와 재검증을 기록한다.
- 자동 정기 검사, 알림, 새 대시보드, Redis/Celery는 범위 밖이다.
