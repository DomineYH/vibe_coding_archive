# 제한된 인증 후보

이 절차는 #197의 로컬 구현 인계다. 실제 production 후보 실행은 [T10 #193](https://github.com/DomineYH/vibe_coding_archive/issues/193)의 운영자 허가와 격리 통제를 기다린다. 외부 ingress는 닫힌 상태를 유지한다. 공개 승인 원장은 [#144](https://github.com/DomineYH/vibe_coding_archive/issues/144)이며 여기에는 그 체크리스트를 복제하지 않는다. 로컬 합성 fixture는 운영 승인이 아니다.

## 설정과 파일 경계

| 입력                       | 요구 / 실패 결과                                                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                  | 프로세스에 production/test/development 명시. dotenv는 development에만 사용하며 dotenv만으로 production/test를 선택하면 거절한다. production 누락 값은 파일에서 보충하지 않는다.                                                                                       |
| `PUBLIC_ORIGIN`            | production은 비로컬 HTTPS의 정확한 origin. credentials, path/끝 슬래시, query/fragment, 공백/제어문자, 잘못된 host/port는 시작 거절.                                                                                                                                  |
| `DATABASE_PATH`            | 기존 migration head의 canonical 절대 DB 경로. 저장소와 설정된 임시 루트, `/tmp`, `/var/tmp`, `/dev/shm` 밖. 경로 표기만으로 실제 영속 mount를 증명하지 않으며 운영자가 확인한다.                                                                                      |
| DB / WAL / SHM             | 기존 regular file 0600, effective service UID 소유, read/write 가능. leaf data directory 0700, 같은 UID 소유; ancestors는 root/service UID 소유이며 untrusted write 불가. symlink/누락 DB/잘못된 revision·권한은 시작 거절. API는 생성·migration·chmod를 하지 않는다. |
| `PASSWORD_BLOCKLIST_PATH`  | 후보를 켤 때 절대 regular/readable 파일, group/world write 금지, 기존 R15 hash/size/line 검증 필수. 자동 다운로드 없음. 승인된 후보의 공급 실패는 시작 거절; 승인 없는 public read-only API는 이 파일을 읽지 않는다.                                                  |
| `AUTH_ACTIVATION_PATH`     | production에서 저장소/임시 루트 밖 canonical 절대 경로. file 0600, service UID 소유, private parent 0700 및 trusted ancestors. 없거나 읽기 실패/잘못된 권한·JSON·binding이면 auth off, 공개 API는 유지.                                                               |
| `APP_RELEASE_ID`           | auth path 지정 시 필수. 1–256자 비어 있지 않은 immutable full release ID, 제어문자 없음. backend digest는 frontend를 포함하지 않으므로 운영자가 전체 배포와 결합한다.                                                                                                 |
| `PASSWORD_RESET_HMAC_PATH` | 기존 별도 0600 무결성 공급 정책. 누락/불일치/읽기 실패는 초기화 issue/execute만 `SERVICE_UNAVAILABLE`; auth 승인 유효 시 기존 result/cancel·로그인·앱·다른 관리자 작업은 유지. HMAC bytes는 승인 기록에 넣지 않는다.                                                  |
| test-only factory flags    | `auth_testing`/`health_testing`은 실제 `APP_ENV=test`에서만 허용하며 그 밖에서는 DB 열기 전에 거절. 시험 DB는 전용 임시 subtree.                                                                                                                                      |
| `SUPPORT_EMAIL`            | 승인된 공개 ASCII 이메일 주소 하나. 표시명·목록·mailto 헤더는 거절한다.                                                                                                                                                                                               |
| `SUPPORT_SERVICE_URL`      | 승인된 공개 HTTPS 서비스 문의 URL. credentials·공백·제어 문자·역슬래시는 거절한다.                                                                                                                                                                                    |
| `SUPPORT_ANNOUNCEMENT_URL` | 승인된 공개 HTTPS 공지 URL. 서비스 문의와 같은 구문 검증을 적용한다.                                                                                                                                                                                                  |

세 support 설정은 미설정·빈 값·공백만 있으면 `/meta`에서 null이고 링크를 만들지 않는다. 비어 있지 않은 잘못된 값은 원문을 출력하지 않고 시작을 거절한다. T11 #194의 정확한 공개 값을 운영자가 승인한 뒤 서비스 환경에 지정하고 재시작한다. 프런트엔드 `VITE_*` 값으로 넣지 않는다. 설정 구문 검증은 운영 승인이나 DNS 목적지 검증을 대신하지 않는다. 인증 후보의 바인딩은 변하지 않으며 email_collection/phone_collection은 비활성, `HEALTH_CHECKS_ENABLED=false`를 유지한다.

API와 health worker는 같은 전용 서비스 UID를 사용한다. Nginx 계정은 private data/record/HMAC에 접근하지 못한다. group permission 정책은 사용하지 않는다. 제한된 후보는 `HEALTH_CHECKS_ENABLED=false`를 유지하며 health 승인과 email/phone 수집을 함께 활성화하지 않는다. health의 별도 절차는 [health-checks.md](health-checks.md)에 있다.

## 미승인 템플릿과 운영자 완료

운영자는 먼저 명시적인 서비스 환경에 origin·DB·검증된 blocklist 경로·선택 HMAC 경로·auth record 경로·release ID를 준비한다. 파일 생성은 운영자만 수행한다. backend에서 다음 명령은 stdout에 metadata만 출력하며 파일을 쓰거나 승인을 하지 않는다. redirect는 `umask 077` 아래 운영자가 수행한다.

```sh
python -m app.auth_runtime
```

출력은 `version: 1`, `status: "pending"`, null `approved_by`, `approved_at`, `issue_144_comment`를 갖는다. 운영자는 실제 허가를 받은 후에만 `status: "approved"`, `approved_by: "DomineYH"`, timezone-aware 비미래 승인 시각, 정확한 `https://github.com/DomineYH/vibe_coding_archive/issues/144#issuecomment-<positive integer>`를 채운다. scope는 정확히 `limited candidate, external ingress closed`다. 런타임은 GitHub로 네트워크 검증을 하지 않으며 댓글의 실제 허가 내용은 운영자가 확인한다.

기록은 현재 backend build SHA-256(기존 health digest), full release ID, production app_env, canonical DB/blocklist/HMAC/auth 경로, 정확한 origin, 고정 R15 source hash, health/collection false 설정과 정확히 일치해야 한다. 비밀번호·HMAC bytes·cookie·CSRF·연락처·raw request/DB를 기록이나 검증 증거에 넣지 않는다. 잘못된 타입, v1 형식에 없는 필드, 중복 JSON key, 64KiB 초과 파일, symlink/nonregular 파일을 거절하며 descriptor에서 bounded read/권한 검사를 한다. 이것은 host firewall/TLS/ingress 증거를 대신하지 않는다.

## 실행, 철회, 복구

승인이 없는 startup에서는 auth가 열리지 않는다. 운영자는 갱신된 승인을 설치한 뒤 API를 재시작하고 `/readyz` 및 `/api/v1/meta`를 확인한다. `/healthz`는 liveness, `/readyz`는 DB/reconciliation readiness이며 후보 허가 증거가 아니다. `/meta`는 한 번의 fresh auth 판단으로 종속 capability를 계산한다. 미승인 production의 reason은 `operational_restriction`이고 선택 수집은 `collection_disabled`다.

기록 삭제·`revoked`·손상·권한 오류·build/release/config 불일치는 다음 보호 gate와 `/meta`에서 즉시 닫힌다. 관찰한 철회는 재시작까지 latch되므로 파일을 다시 approved로 교체해도 자동으로 열리지 않는다. **Operator restarts after renewed approval.** 기존 세션과 operation result/cancel도 auth 승인 없이는 접근하지 못하며 공개 읽기는 유지한다. reset-only HMAC latch와 auth 철회 latch는 독립이다.

Hashing/DB write reservation 뒤의 기존 재검증 경계에서도 승인을 다시 검사한다. 마지막 authorization을 이미 통과한 작업과 외부 파일 교체는 전역 atomic transaction이 아니다. 강제 cutover는 운영자가 API/worker를 quiesce한 뒤 수행한다. 새 cookie/session protocol은 없으며 기존 Secure/HttpOnly/Path=/SameSite=Lax/`__Host-` HTTPS 정책과 session lifetime을 그대로 유지한다.

자동 검증은 `APP_ENV=test` 전용 temp 파일/DB에서 합성 binding만 평가한다. 이 기록은 배포되지 않는다. production 실행, ingress/TLS/host 권한, 실제 기기 및 #144 최종 검수는 T10 운영자 증거가 필요하다.
