# 로컬 비밀번호 차단 목록의 출처·버전·재배포·무결성 검증 조사 보고서

이 문서는 [이슈 #28(로컬 비밀번호 차단 목록의 출처·버전·재배포·무결성 검증 조사)](https://github.com/DomineYH/vibe_coding_archive/issues/28)에 대한 기술 사실 조사 보고서이다. 선행 확정 결정인 [이슈 #7(가입·세션·관리자 재인증의 정책과 상태 전이 확정 — resolution §1의 Q3·Q16·Q19)](https://github.com/DomineYH/vibe_coding_archive/issues/7#issuecomment-5775997962), [이슈 #15(저장소 구조·개발 명령·의존성 잠금의 최소 기반 확정 사전 승인 Q9·Q10·Q17·Q19)](https://github.com/DomineYH/vibe_coding_archive/issues/15), 그리고 [이슈 #27(개발 기반의 정확한 의존성 버전·잠금·검증 명령 조사)](https://github.com/DomineYH/vibe_coding_archive/issues/27#issuecomment-5807730641)의 계약을 상위 입력으로 수용한다.

> [!NOTE]
> 본 보고서는 **[문서 근거]**(공식 라이선스, NIST 가이드라인, GitHub 공식 커밋/태그, Django/SecLists/NCSC 공식 명세), **[실측]**(Ubuntu 24.04 LTS x86_64 환경에서 실제 파일 다운로드·해시·인코딩 분석·메모리/시간 벤치마크 및 단위 검증 스위트를 구동해 캡처한 수치), **[추론]**(표준과 실측에 기반한 논리적 도출), **[미검증]**(실측 제약상 확인되지 않아 후속 검증 또는 사람의 결정이 필요한 항목)을 엄격히 구분하여 서술한다. 본 보고서와 모든 산출물에는 실제 유출 비밀번호 원문 및 원문 포함 합성 문자열을 절대 수록하지 않는다.

---

## 1. 검증 환경 및 1차 출처 목록

### 1.1 검증 환경
- **OS / Platform**: Linux (Ubuntu 24.04.3 LTS on x86_64, Linux 6.6.87.2-microsoft-standard-WSL2 kernel)
- **Python Runtime**: Python `3.12.3`
- **Package / Tooling Manager**: uv `0.11.28` (x86_64-unknown-linux-gnu)
- **HTTP / Transfer Tool**: curl `8.5.0` (libcurl/8.5.0 OpenSSL/3.0.13 zlib/1.3 brotli/1.1.0 zstd/1.5.5)
- **Backend Lockfile SHA-256**: `8bd59bff114d2c77eec39108a862f2a45f8f33644a8d80739ecd6766dfcc5d09` (`dependency-lock-compatibility/backend/uv.lock`)
- **Frontend Lockfile SHA-256**: `c76d9b869d2a1a76833bad7af7e6121e425434e0b84e39555bc8780e25811d80` (`dependency-lock-compatibility/frontend/package-lock.json`)
- **격리 검증 디렉터리 (실측)**: `/tmp/pw-research-reproduce-*` (최종 보존 실행 경로: `/tmp/pw-research-reproduce-xsfFKO`, 검증 완료 후 자동 정리됨)
- **재현 검증 스크립트 및 메타데이터**:
  - 러너: `password-blocklist-provenance/scripts/verify_reproduction.sh`
  - 다운로더: `password-blocklist-provenance/scripts/fetch_candidate_blocklists.sh`
  - 변환기: `password-blocklist-provenance/scripts/convert_blocklist.py`
  - 검증기: `password-blocklist-provenance/scripts/verify_blocklists.py`
  - 메타데이터: `password-blocklist-provenance/metadata/candidate_sources.json`
  - 실행 요약 로그: `password-blocklist-provenance/logs/run_summary.log`

### 1.2 1차 출처 목록 (확인 시점: 2026-09-24)
1. **NIST Special Publication 800-63B (Revision 4)**:
   - 문서: *Digital Identity Guidelines: Authentication and Lifecycle Management*
   - URL: `https://pages.nist.gov/800-63-4/sp800-63b.html`
   - 핵심 인용: § 5.1.1.2 (Memorized Secret Verifiers — 15자 이상의 최소 길이, 문자 조합/주기적 교체 강제 배제, 흔하거나 유출된 비밀번호 차단 목록 대조 필수).
2. **SecLists 공식 저장소 (Daniel Miessler)**:
   - 저장소: `https://github.com/danielmiessler/SecLists`
   - 공식 릴리스 태그: `2026.1` (Commit `190c6f7bd58c847ceadfe57d9853592737f059e8`, 커밋 시각: `2026-03-23T05:56:29Z`)
   - 라이선스 파일: `https://raw.githubusercontent.com/danielmiessler/SecLists/master/LICENSE` (저장소 래퍼 MIT License)
   - 데이터 원본 경로: `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`
   - 데이터 정제 이력: Commit `1a7bb9127eca9e6ff2fc0301c597fe6e16a0cb56` (2025-11-19, PR #1229 중복 라인 정리), Commit `20511c16196d06aa3422fc55e20cb9205a07587f` (2025-07-09, 인코딩 수정).
3. **UK National Cyber Security Centre (NCSC)**:
   - 웹사이트 및 약관: `https://www.ncsc.gov.uk/section/about-this-website/terms-and-conditions`
   - 공지: *NCSC reveals most common passwords found in breached data*
   - 라이선스 및 제약: NCSC 일반 지침은 UK Open Government Licence v3.0 (OGL v3.0) 대상이나, 웹사이트 약관상 제3자 소유물(Third Party Materials)은 명시적으로 제외됨. NCSC 발표에 따르면 해당 목록은 제3자 유출 데이터셋 및 Have I Been Pwned 기반으로 집계되었음.
4. **Django Project (`django.contrib.auth`)**:
   - 저장소: `https://github.com/django/django`
   - 대상 커밋: `727731d76d9dfd5304d536478d862778f6dd6d9b` (2025-02-09, Ticket #36179 / PR #19155)
   - 파일: `django/contrib/auth/common-passwords.txt.gz` 및 `django/contrib/auth/password_validation.py`
   - 라이선스: Django 프레임워크 코드는 BSD 3-Clause License. 단, 내장된 데이터 파일 원천(Royce Williams gist 및 Pwned Passwords 유출본)의 데이터베이스/원저작 권리는 별도 명시 없음.
5. **Have I Been Pwned (HIBP) / Troy Hunt**:
   - API 규격: `https://haveibeenpwned.com/API/v3`
   - Pwned Passwords 서비스: `https://haveibeenpwned.com/API/v3#PwnedPasswords`
   - 라이선스 및 이용 조건 구분:
     - **공식 API 문서 ([문서 근거])**: `haveibeenpwned.com`의 공개 침해사고(Breach) 및 Paste 디렉터리 API는 CC BY 4.0으로 안내되나, Pwned Passwords API는 API 키 없이 무료로 제공되며 출처 표시(Attribution)나 별도 라이선스 요건이 없다고 명시됨.
     - **데이터 덤프(해시 목록) 재배포 권리 ([미검증])**: HIBP가 배포하는 오프라인 해시 덤프(~35GB, 8억 건 이상)는 제3자 재배포 권리에 대한 명시적 라이선스 근거가 없어 `[미검증]`으로 분류됨.
6. **Dropbox zxcvbn**:
   - 저장소: `https://github.com/dropbox/zxcvbn`
   - 라이선스: MIT License.

---

## 2. 확정 입력 및 불변 제약 조건

본 조사는 선행 결정된 인증 정책 및 개발 기반 계약을 불변의 상위 제약으로 준수한다:

1. **비밀번호 길이 및 문자 규칙 ([문서 근거: 이슈 #7 Q3])**:
   - 정규화 후 **15~128 Unicode code point** 허용.
   - Unicode 및 공백 허용.
   - trim, 조용한 절단, 문자 종류 조합(대/소문자/숫자/특수문자 필수 등) 강제 규칙 적용 금지.
   - 흔한 비밀번호 차단 필수.
   - 원문 또는 파생값을 외부 서비스로 송출 금지.
2. **정규화 기준 ([문서 근거: 이슈 #7 Q16])**:
   - 공백과 대소문자를 유지하며 **Unicode NFC**만 적용.
   - 세 필드(로그인 아이디, 별명, 비밀번호) 길이는 정규화 후 Unicode code point 수로 계산.
3. **차단 목록 대조 방식 및 가용성 ([문서 근거: 이슈 #7 Q19])**:
   - 버전을 고정한 **로컬 common-password blocklist** 사용.
   - 정규화 후 **전체 문자열(whole-string) 완전 일치 비교**만 수행 (substring 차단 금지).
   - 필수 목록 로드 실패 시 **auth readiness 실패**.
4. **저장소 보존 및 보안 한계 ([문서 근거: 이슈 #28 제약 조건])**:
   - 유출 비밀번호 원문, 회원 데이터, 비밀을 git 저장소에 커밋하는 행위 엄격 금지.
   - 저장소에는 해시, 메타데이터, 다운로드/변환 스크립트만 보존.
   - 런타임에 외부 API(HIBP 등)를 호출하거나 시작 시 최신본을 자동 수신하는 방식으로 계약을 변경하지 않음.

---

## 3. [조사 범위 1] 1차 출처와 사용 조건 분석

### 3.1 후보 목록별 수집 경위 및 1차 출처

| 후보 식별자 | 1차 출처 및 배포처 | 수집 경위 및 목적 | 코드/저장소 라이선스 | 데이터 권리 및 재배포 가능성 판정 |
|---|---|---|---|---|
| **SecLists NCSC 100k** | UK NCSC & Troy Hunt (SecLists `Passwords/Common-Credentials/`) | 글로벌 침해사고 유출본 중 최다 빈도 10만 건 집계. 조직의 취약 비밀번호 사전 차단 권고 목적. | MIT License (Daniel Miessler 2018) | **[미검증 / 권리 불명확]**: NCSC 웹사이트 약관은 제3자 자료를 OGL 적용에서 제외함. 유출 데이터베이스 원천의 권리 소유권이 불명확하므로, 재배포 가능하다고 단정할 수 없음 (인간 결정 필요). |
| **Django common-passwords** | `django/contrib/auth/` (Royce Williams gist + Pwned Passwords) | Django `CommonPasswordValidator` 내장용 상위 2만 개 목록. | BSD 3-Clause | **[미검증 / 권리 불명확]**: Django 소스코드 자체는 BSD-3-Clause이나, 포함된 데이터 파일의 1차 출처(유출본 집계)에 대한 권리 근거가 명시되지 않음. |
| **SecLists 10k-most-common** | SecLists (`10k-most-common.txt`) | 다수 침해사고 데이터셋 통합 상위 1만 개. | MIT License (저장소 래퍼) | **[미검증]**: 출처 불명확, 사실 데이터 집계물. |
| **SecLists probable-1575** | `berzerk0/Probable-Wordlists` | 다수 유출본 교차 비교 빈도 상위 1,575개. | MIT License | **[미검증]**: 오픈소스 단어장이나 침해 데이터 기반. |
| **HIBP Pwned Passwords** | Have I Been Pwned (Troy Hunt) | 8억 건 이상의 침해사고 비밀번호 SHA-1/NTLM 해시 덤프 및 k-anonymity API. | N/A (서비스/데이터셋) | **[미검증 / 정책 부적합]**: 공식 API 문서상 Pwned Passwords API는 라이선스·출처표시 요건 없이 무료 제공되나 런타임 질의는 Q3(외부 송출 금지) 위반. 한편 오프라인 데이터 덤프(해시 목록)는 재배포 권리 근거가 없어 `[미검증]`이며 35GB+ 용량으로 단일 호스트 부적합. |
| **Dropbox zxcvbn** | `dropbox/zxcvbn` 내장 단어장 | 엔트로피 기반 추정기 내장 사전 (`passwords.json` ~3만 단어). | MIT License | **[정책 부적합]**: MIT 라이선스이나 substring 매칭 모델이므로 Q19(전체 문자열 비교) 위반. |

### 3.2 코드 라이선스와 데이터 라이선스의 분리 및 재배포 한계
- **SecLists의 라이선스 분리 ([문서 근거: SecLists LICENSE & README])**:
  SecLists 저장소 루트의 MIT 라이선스는 모음집 구성과 스크립트에 부여된 것이다. 데이터 파일 자체는 전 세계 해킹 침해사고에서 유출된 계정 데이터에서 통계적으로 추출된 사실 데이터이다.
- **NCSC 100k의 OGL 재배포 단정 철회 ([문서 근거: NCSC 이용약관] & [추론])**:
  NCSC의 공식 이용약관 § "Terms and conditions"에 따르면 영국 공공 정보는 OGL v3.0을 따르나, "Third party materials"는 OGL 범위에서 제외된다. NCSC 100k 비밀번호 데이터는 제3자 데이터 유출본(HIBP 등)을 가공한 것이므로 OGL v3.0에 의해 자유로운 재배포가 보장된다고 단정할 수 없으며, **[미검증]** 상태로 분류하고 git 저장소 외부 분리 취득을 유지해야 한다 (`[추론]`).
- **HIBP와 Django 데이터 라이선스 구분 ([문서 근거: HIBP API v3 & Django LICENSE])**:
  - HIBP 공식 API 문서(API v3)에 따르면, CC BY 4.0 고지는 침해 웹사이트(Breaches) 및 Paste API 대상이며, Pwned Passwords API는 라이선스나 출처 표시(Attribution) 요건 없이 무료로 제공된다. 그러나 35GB가 넘는 오프라인 해시 데이터 덤프의 제3자 재배포 권리는 명시적 근거가 없으므로 **[미검증]**으로 분류한다.
  - Django의 BSD 3-Clause는 프레임워크 소스코드에 대한 배포 허용이며, 내장된 `common-passwords.txt.gz` 데이터의 원천 라이선스를 보증하지 않는다. 따라서 데이터 자체의 권리는 **[미검증]**으로 취급한다.

---

## 4. [조사 범위 2] 불변 식별과 공급 방식

### 4.1 후보별 불변 식별자 및 원본/변환 해시 실측 결과 ([실측])

모든 수치는 `/tmp/pw-research-reproduce-*`에서 curl, gzip, sha256sum으로 실측한 값이다 (`password-blocklist-provenance/logs/fetch_candidates.log` 및 `verify_candidates.log` 증거).

| 후보 | 불변 Git Commit / Tag | 원본 파일명 및 경로 | 크기 (bytes) | SHA-256 | 비고 |
|---|---|---|---|---|---|
| **SecLists NCSC 100k** | Tag `2026.1` (`190c6f7bd58c847ceadfe57d9853592737f059e8`) | `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` | **835,538** | `c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0` | Git Blob SHA-1: `38eb37702244f55fda75cab281eb2145cd7685b6` |
| **Django 20k common** | Commit `727731d76d9dfd5304d536478d862778f6dd6d9b` | `django/contrib/auth/common-passwords.txt.gz` | **80,228** (압축)<br>**162,384** (해제) | `3c1baed62596de36860824eb3f436d5932d37ca8b06e59df78f5a44ec175afe4` (압축)<br>`29ca0fa5303165f012f3e9775e3e95a3071cdd59f219973ec1cbb308d0214a6f` (해제) | Git Blob SHA-1: `c23afebf306a8a715638fbb08e31ee92738173f6` |
| **SecLists 10k** | Tag `2026.1` (`190c6f7bd58c847ceadfe57d9853592737f059e8`) | `Passwords/Common-Credentials/10k-most-common.txt` | **73,017** | `4adb3f0afb4a10cf19ebe48d8c69a46f934bbc8d77c694c210564f9583e7f4ba` | 10,000행 |
| **SecLists probable-1575** | Tag `2026.1` (`190c6f7bd58c847ceadfe57d9853592737f059e8`) | `Passwords/Common-Credentials/probable-v2_top-1575.txt` | **12,261** | `3ce41d89e5e75075f3e73ebf1b32121dd873510f2b242dc69c177707ade06dbb` | 1,575행 |
| **SecLists xato-net 10k** | Tag `2026.1` (`190c6f7bd58c847ceadfe57d9853592737f059e8`) | `Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt` | **76,497** | `c63d5e4ccc31344d662583cc39ca4bd5bd20517ff1d24501f0c4e0c22d9b722a` | 10,000행 (공백 1행 포함) |

### 4.2 변환 산출물 해시 실측 ([실측])
`convert_blocklist.py`를 통해 NCSC 100k 원본을 표준 정규화·변환한 산출물 실측치 (`password-blocklist-provenance/logs/convert_binary_sha256.log` 및 `convert_filtered_15.log`):
1. **바이너리 SHA-256 룩업 파일 (`ncsc_100k.sha256.bin`)**:
   - 크기: **3,194,848** bytes (정렬된 32바이트 바이너리 다이제스트 99,839개)
   - SHA-256: `3454787f31778a25124a31abbfb8a65d2fda9cc1cf40bac2a379544a143a8d38`
2. **15자 이상 필터링 텍스트 파일 (`ncsc_gte15.txt`)**:
   - 크기: **6,158** bytes (15~128자 해당 항목 331개)
   - SHA-256: `279bf70358d4c849051ffa87523eed2ca4f941488c6e6dfee0b83cee3e962955`

---

## 5. [조사 범위 3] 정규화·정확한 대조 가능성 및 데이터 한계 분석

### 5.1 길이 분포 실측 및 15자 하한 제약과의 관계 ([실측])

Q3 정책에 따라 비밀번호는 정규화 후 **15~128 Unicode code point**여야 한다. 후보 데이터셋의 실제 길이 분포 실측 결과는 다음과 같다:

```
[SecLists NCSC 100k] (총 비공백 99,839건)
  - 길이 < 15자:  99,508건 (99.67%)
  - 길이 >= 15자:    331건 ( 0.33%)
  - 길이 > 128자:      0건

[Django 20k common] (총 비공백 19,640건)
  - 길이 < 15자:  19,592건 (99.76%)
  - 길이 >= 15자:     48건 ( 0.24%)
  - 길이 > 128자:      0건

[SecLists 10k-most-common] (총 10,000건)
  - 길이 < 15자:   9,999건 (99.99%)
  - 길이 >= 15자:      1건 ( 0.01%)

[SecLists probable-1575] (총 1,575건)
  - 길이 < 15자:   1,575건 (100.00%)
  - 길이 >= 15자:      0건 ( 0.00%)

[SecLists xato-net 10k] (총 9,999건)
  - 길이 < 15자:   9,997건 (99.98%)
  - 길이 >= 15자:      2건 ( 0.02%)
```

**[핵심 분석 및 추론]**:
- 일반적인 글로벌 침해사고 기반 상위 단어장(1k~100k)은 과거 짧은 비밀번호(6~10자) 위주의 서비스 환경에서 유출되었기 때문에 **99.6% 이상이 15자 미만**이다.
- 가입/생성 검증 파이프라인에서 길이 검증(`len < 15`)이 선행 실행되면, 99.6% 이상의 차단 목록 항목은 실질적으로 대조 단계에 도달하기 전에 길이 오류로 거절된다 (`[추론]`).
- 그럼에도 불구하고 NCSC 100k에는 단순 반복열, 키보드 연속 패턴, 긴 문구 등 **331개의 15자 이상 실제 유출 비밀번호**가 포함되어 있어, 장문 흔한 비밀번호 차단에 유효하게 동작한다 (`[실측]`).

### 5.2 대소문자 보존 vs 소문자 강제 (Django 목록의 한계)
- **계약 ([문서 근거: 이슈 #7 Q16])**: "비밀번호는 공백·대소문자를 유지하며 NFC만 적용한다. 전체 문자열을 비교하며 substring 차단을 하지 않는다."
- **Django 목록의 한계 ([실측] & [문서 근거: Django Commit 26bb2611a5])**:
  - Django의 `common-passwords.txt.gz`는 유지보수자에 의해 **모든 항목이 소문자로 변환(lowercased)**되어 있다 (`is_lower=18,181`, `is_upper=0`, `is_mixed=0`).
  - 사용자가 대소문자가 혼합된 흔한 비밀번호 패턴을 입력할 경우, Q16 계약(대소문자 보존)에 따라 대조하면 소문자만 존재하는 Django 목록에서는 일치하지 않아 차단에 실패한다.
  - 이를 차단하기 위해 입력값을 `casefold()`/`lower()`하면 "casefold 차단으로 정책을 바꾸지 않는다"는 상위 제약을 위반하게 된다 (`[추론]`).
- **Django 비-ASCII 데이터 손상 ([실측])**:
  Django 목록의 비-ASCII 14건 중 9건은 UTF-8 대체 문자 바이트 시퀀스(`0xEF 0xBF 0xBD`, U+FFFD)가 CP1251 문자셋으로 오해석되어 커밋된 **손상된 레코드**이다.
- **SecLists NCSC 100k의 대소문자 보존 ([실측])**:
  - 소문자 75,526건, 대문자 668건, 혼합 2,150건으로 **원형 대소문자를 온전히 보존**하고 있다.
  - 실측 결과 원본 목록에는 대문자 시작 표기와 소문자 표기가 서로 다른 줄에 각각 독립 엔트리로 수록된 사례들이 확인되었다.

### 5.3 공백 및 비-ASCII / 한국어(한글) 범위 한계
- **공백 처리 ([실측])**:
  NCSC 100k에는 공백이 포함된 엔트리가 0건이다. Q3/Q16에 따라 trim을 적용하지 않으므로, 흔한 비밀번호 앞뒤에 공백을 붙인 합성 입력은 차단 목록과 일치하지 않고 통과된다 (`[실측: TEST 4]`).
- **한국어(한글) 부재 ([실측])**:
  - NCSC 100k(79건의 키릴 문자 외 모두 ASCII) 및 Django 목록 모두에 **한글(`가-힣`) 엔트리는 0건**이다.
  - 한국어 2벌식 타자 변환이나 한글 단어 형태의 흔한 비밀번호는 글로벌 유출 목록에 포함되어 있지 않다.
- **Unicode NFC 정규화 동등성**:
  - **[실측: 데이터셋 분석]**: 실제 다운로드된 5개 후보 목록의 전체 라인은 NFC 정규화 적용 전후 차이가 **0건**으로 모두 이미 정규화되어 있다.
  - **[실측: TEST 5 합성 로직 검증]**: NFD로 분해된 한글 합성 입력이 들어오더라도, 질의 전 NFC로 정규화하면 NFC로 저장된 합성 엔트리와 완벽히 동등하게 매칭됨을 단언 검증하였다.

### 5.4 빠른 비교 해시(SHA-256/Set)와 자격증명 저장(Argon2id)의 분리
- **빠른 비교 룩업**:
  - **문자열 Set 검색 ([실측])**: 인메모리 Python `set`에 대해 Unicode NFC 정규화 후 소속 여부를 질의하는 레이턴시는 질의당 약 **0.055~0.060 마이크로초(µs)** 내외 (초당 약 1,700~1,800만 회)에 완료된다 (`verify_blocklists.py:161`).
  - **SHA-256 Set 및 정렬 바이너리 검색 ([미검증] / [추론])**: SHA-256 digest 계산 후 Set 검색 및 정렬 바이너리 `bisect` 이진 탐색의 룩업 레이턴시는 본 벤치마크 루프에서 직접 측정하지 않아 **[미검증]**이다. 해시 계산과 이진 탐색이 Argon2id 검증보다 가볍다는 정성적 판단만 가능하며(`[추론]`), 정량 수치는 측정 전까지 제시하지 않는다.
- **Argon2id 저장**:
  - 가입/비밀번호 변경 통과 후 DB 저장을 위한 Argon2id 해싱(`pwdlib[argon2]`)은 의도적으로 CPU/메모리 부하를 주어 수십~수백 ms가 소요된다.
  - 빠른 차단 목록 검사가 파이프라인 최선두에서 부적격 입력을 수 µs 이내에 거절함으로써 고비용 Argon2 연산 자원 낭비를 방어한다 (`[추론]`).

---

## 6. [조사 범위 4] 실제 로컬 검증 및 벤치마크 실측 결과

### 6.1 검증 스위트 실행 결과 및 로그 증거

`verify_reproduction.sh`를 통해 격리 임시 디렉터리(`/tmp/pw-research-reproduce-xsfFKO`)에서 실행된 5개 단계와 종료 코드는 다음과 같다 (`password-blocklist-provenance/logs/run_summary.log`):

```
- Fetch candidate blocklists: exit 0
- Convert NCSC 100k to binary SHA-256: exit 0
- Convert NCSC 100k filtered to >= 15 code points: exit 0
- Verify blocklists and synthetic tests: exit 0
- Worktree plaintext absence check: exit 0
Overall Result: SUCCESS (all exit 0)
```

### 6.2 메모리 점유 및 로드 시간 벤치마크 실측치 ([실측])

`tracemalloc` 및 고해상도 타이머를 사용하여 측정된 후보별 로드 시간과 메모리 소비량 (`password-blocklist-provenance/logs/verify_candidates.log`):

> [!NOTE]
> 엔트리 수, 메모리 점유량, 파일 크기는 고정 불변이나, 로드 시간 및 룩업 레이턴시 수치는 시스템 부하 및 OS 스케줄링에 따라 매 실행마다 미세하게 변동되는 실측값이다.

| 후보 데이터셋 | 엔트리 수 | 문자열 Set 로드 시간 | 문자열 Set 피크 RAM | SHA-256 Set 로드 시간 | SHA-256 Set 피크 RAM | 룩업 레이턴시 (µs/query) |
|---|---|---|---|---|---|---|
| **SecLists NCSC 100k** | 99,839 | **153.15 ms** | **9.65 MB** | 752.17 ms | 10.90 MB | **0.057 µs** |
| **Django 20k common (압축)** | 19,640 | **31.47 ms** | **1.51 MB** | 142.96 ms | 1.82 MB | **0.059 µs** |
| **SecLists 10k** | 10,000 | **12.84 ms** | **0.96 MB** | 82.59 ms | 1.13 MB | **0.056 µs** |
| **SecLists probable-1575** | 1,575 | **2.19 ms** | **0.22 MB** | 10.87 ms | 0.24 MB | **0.055 µs** |
| **SecLists xato-net 10k** | 9,999 | **13.37 ms** | **0.97 MB** | 72.05 ms | 1.13 MB | **0.057 µs** |

- **평가 ([추론])**:
  10만 건에 달하는 NCSC 목록 전체를 Python 인메모리 `set`으로 올려도 피크 메모리는 **9.65 MB**, 로드 시간은 **0.15초 (153.15 ms)**에 불과하다. 15자 이상(331건)만 필터링할 경우 메모리는 100KB 미만으로 떨어진다. 단일 호스트 SQLite/FastAPI 환경에서 10만 건 전체를 인메모리 로드하는 것은 성능상 아무런 부담이 없다.

### 6.3 합성 정책 검증 및 인덱스 기반 무출력 검증 테스트 결과 ([실측])

`verify_blocklists.py`를 통해 단언 검증된 정책 테스트 결과 (`password-blocklist-provenance/logs/verify_candidates.log`):

- **[TEST 1] 합성 토큰 완전 일치 차단 (합성 로직 검증)**:
  목록과 무관한 15자 이상의 합성 토큰 입력 시 차단 목록(Set)에 포함되어 `BLOCKED` 판정 (assert 통과).
- **[TEST 2] 부분 일치(Substring) 비차단 검증 (합성 로직 검증)**:
  합성 토큰을 포함한 접두/접미 파생 문자열 입력 시 차단되지 않고 `ALLOWED` 판정 (Q19 전체 일치 계약 준수 확인, assert 통과).
- **[TEST 3] 대소문자 보존 검증 (합성 로직 검증)**:
  대소문자가 혼합된 단일 합성 엔트리(`SyntheticCaseSensitiveToken15Chars`)가 등록된 셋에 대해, 원래 대소문자 입력은 `True`, 소문자 변환 입력은 `False`로 단언 판정되어 대소문자 왜곡 없이 보존됨을 확인 (assert 통과).
- **[TEST 4] 공백 보존(No-trim) 검증 (합성 로직 검증)**:
  합성 토큰 앞뒤에 공백을 추가한 입력 시 trim이 적용되지 않아 차단되지 않고 `ALLOWED` 판정 (Q3/Q16 준수 확인, assert 통과).
- **[TEST 5] Unicode NFC 정규화 동등성 (합성 로직 검증)**:
  NFD 분해 합성 한글 문자열을 입력받아 NFC 정규화 후 대조 시 NFC 저장 합성 엔트리와 정확히 일치함을 확인 (assert 통과).
- **[TEST 6A~6C] 무결성 검증 및 실패 탐지**:
  - 유효 해시 파일 로드: 성공 (assert 통과).
  - 변조 해시 감지: `ValueError(Hash mismatch)` 즉각 발생 및 차단 확인 (assert 통과).
  - 파일 누락 상태 로드: `FileNotFoundError` 즉각 발생 확인 (assert 통과).
- **[TEST 7] 실제 데이터셋 인덱스 기반 무출력 룩업 검증**:
  실제 NCSC 100k 파일의 100번째 줄 항목을 원문 출력 없이 줄 번호(100), 길이(8), SHA-256 해시만 기록하고 인메모리 Set 존재를 단언 확인 (`password-blocklist-provenance/logs/verify_candidates.log`).

---

## 7. [조사 범위 5] 공급·업데이트 경계와 아키텍처 대안

### 7.1 권장 공급 아키텍처: 메타데이터 고정 + 빌드/배포 시 취득 + Auth Readiness 무결성 검증

1. **저장소 보존 범위**:
   - `metadata/candidate_sources.json`: 불변 URL, 태그 `2026.1`, 커밋 SHA, 파일 크기(`835538`), SHA-256 (`c2e5696882c6...`).
   - `scripts/fetch_candidate_blocklists.sh`: `set -euo pipefail` 기반의 다운로드 및 무결성 검증 도구.
   - 평문 비밀번호 파일은 저장소에 전혀 커밋하지 않는다.
2. **배포/준비 절차 (Offline Readiness)**:
   - 컨테이너 빌드 또는 오프라인 배포 패키징 시점에 `fetch_candidate_blocklists.sh`를 1회 실행하여 로컬 디렉터리(`data/passwords/`)에 다운로드 및 해시 검증을 완료한다.
   - 런타임에는 완전히 네트워크와 차단된 오프라인 상태로 기동한다.
3. **애플리케이션 기동 시 무결성 검증 (Auth Readiness)**:
   - FastAPI 수명주기(startup / lifespan)에서 `verify_blocklist_integrity()` 실행:
     1. 로컬 경로의 파일 존재 여부 확인.
     2. 파일의 SHA-256 계산 후 `candidate_sources.json`의 고정 해시와 엄격 비교.
     3. 불일치 또는 누락 시 **Auth Readiness 503 반환** 또는 프로세스 시작 즉시 중단.
     4. 일치 시 인메모리 `set`으로 0.15초 (153.15 ms) 만에 로드하여 준비 완료.

### 7.2 갱신(Update) 절차 및 경계
- 목록 갱신은 코드 배포와 동일하게 취급한다.
- 런타임 자동 갱신(auto-fetch)은 엄격히 금지된다.
- SecLists의 새 릴리스 태그가 나오면, 개발자가 로컬에서 다운로드·해시 계산 후 메타데이터를 수정하고 회귀 테스트를 통과한 뒤 git 커밋으로 반영한다.

---

## 8. [조사 범위 6] 저장소 무결성 검증 및 유출 원문 비포함 입증

### 8.1 전체 산출물 텍스트 대상 원문 대조 검사 실측 결과 ([실측])
본 조사 결과물이 git worktree에 유출 비밀번호 원문을 유입시키지 않았음을 다음과 같이 다중 검증하였다 (`password-blocklist-provenance/logs/worktree_check.log`):

1. **원문 파일 포맷 격리 검증**:
   worktree 내에 `.txt`, `.gz`, `.csv`, `.bin` 등 원본/압축/바이너리 데이터 파일이 전혀 존재하지 않음을 확인.
2. **다운로드 원본 항목 중 길이 ≥ 6이며 EXCLUDED_VOCABULARY에 없는 항목의 내용 대조 검사 실측 ([실측])**:
   - **검사 대상 및 범위**: 다운로드된 5개 후보 목록의 전체 라인 중 길이 ≥ 6이고 EXCLUDED_VOCABULARY(일반 단어·기술 용어 예외)를 제외한 고유 항목 (총 94,937건, 제외 후 검사 집합).
   - **예외 어휘 처리**: 표준 프로그래밍 언어 키워드, 마크다운 문서 기술 용어, 저장소 메타데이터로 구성된 `EXCLUDED_VOCABULARY` 제외.
   - **대조 방식**: 산출물 전체 텍스트(보고서, 스크립트, 메타데이터, 로그 요약)를 대상으로 부분 문자열(`pw in text`) 대조 방식 수행.
   - **실측 결과**: 유출 비밀번호 후보 원문 일치 **0건** (`Matches found: 0`, `PASS: Zero candidate password entries (len >= 6) found in deliverables`).
3. **Coordinator 독립 토큰 대조 결과 교차 검증 ([문서 근거])**:
   - Coordinator가 별도로 수행한 독립 토큰 대조(길이 ≥ 8의 숫자/대소문자 혼합 34,901건 대상)에서도 일반 단어 외 실제 유출 원문 노출 **0건**임이 교차 확인됨.
4. **Git 상태 확인**:
   모든 다운로드 및 변환 작업은 worktree 외부 격리 임시 디렉터리(`/tmp/pw-research-*`)에서만 수행되었으며, worktree 내부에는 메타데이터, 스크립트, 실행 로그 요약만 생성되었다.

---

## 9. 종합 결론 및 의사결정 권고

### 9.1 후보 비교 요약표

| 평가 항목 | SecLists NCSC 100k (기술적 최적 후보) | Django common-passwords | SecLists 10k | HIBP Pwned Passwords |
|---|---|---|---|---|
| **출처 공신력** | **최상** (UK NCSC & HIBP 공조) | **상** (Django 공식) | **중** (SecLists 통합본) | **최상** (업계 표준) |
| **데이터 재배포 권리** | **[미검증]** (제3자 유출물 기반) | **[미검증]** (코드만 BSD, 데이터 불명확) | **[미검증]** (출처 혼재) | **[미검증]** (API는 라이선스·표시 요건 없음 명시, 오프라인 덤프 재배포 권리 미검증) |
| **대소문자 보존** | **보존** (소/대/혼합 원형 유지) | **손실** (소문자 일괄 변환됨) | 보존 | 해시 형태 |
| **인코딩 무결성** | **정상** (PR #1229 정제 완료) | **결함** (14건 중 9건 깨진 바이트) | 정상 | N/A |
| **15자 이상 항목 수** | **331건** (최다) | 48건 (손상 바이트 다수) | 1건 | 수백만 건 (추정) |
| **오프라인 풋프린트** | **0.8 MB** (RAM 9.6 MB) | 0.08 MB (RAM 1.5 MB) | 0.07 MB (RAM 0.9 MB) | 35 GB+ (단일 호스트 부적합) |
| **Q19 정합성** | **완전 부합** | 부분 충돌 (대소문자 손실) | 완전 부합하나 데이터 부족 | API/용량 충돌 |

### 9.2 핵심 결론 (5줄 요약)
1. **[기술적 최적 후보]** UK NCSC와 HIBP가 공조하고 SecLists 태그 `2026.1`로 고정된 `100k-most-used-passwords-NCSC.txt`가 출처 공신력·대소문자 보존성·무결성에서 가장 우수하다.
2. **[권리 및 라이선스]** NCSC의 약관상 제3자 자료 예외 및 유출본 출처 특성상 데이터의 자유 재배포 권리는 `[미검증]` 상태이며, 저장소에 원문을 커밋하지 않는 분리 공급이 요구된다.
3. **[Django 목록 결함]** Django `common-passwords.txt.gz`는 전면 소문자화되어 있어 대소문자 보존 계약(Q16) 하에서 혼합 대소문자 차단이 불가하며, UTF-8 대체 문자 손상 레코드가 존재한다.
4. **[15자 제약 영향]** 15자 이상 최소 길이 정책(Q3)으로 인해 10만 건 중 99.67%는 길이 검증에서 선행 탈락하며, 실질 유효 차단 대상은 331건이나 장문 흔한 비밀번호 방어에 유효하다.
5. **[성능 및 가용성]** 10만 건 전체를 인메모리 Set으로 로드해도 메모리 9.65MB, 로드 0.15초 (153.15 ms), 질의 0.057µs로 극도로 가벼우며 기동 시 SHA-256 검증으로 Auth Readiness를 충족한다.

### 9.3 사람이 결정할 사항 (이슈 #15 인계 선택지)
1. **저장소 공급 형식 선택지**:
   - **선택지 A (권장)**: 메타데이터와 다운로드 스크립트만 두고 빌드/배포 시점에 다운로드·SHA-256 검증 수행 (저장소 내 유출 평문 전면 배제).
   - **선택지 B**: 정규화된 32바이트 바이너리 SHA-256 파일(`ncsc_100k.sha256.bin`, 3.19 MB)을 저장소에 직접 포함하여 외부 다운로드 절차 배제 (평문은 아니나 3MB 바이너리 git 추적 부담).
2. **차단 목록 데이터 범위 선택지**:
   - **선택지 1 (기본안)**: 10만 건 전체를 로드하여 대조 (추가 가공 없음, 메모리 9.65MB).
   - **선택지 2 (최적화안)**: 15자 이상 유효 엔트리(331건)만 필터링하여 로드 (메모리 100KB 미만, 단 15자 미만 임의 입력에 대한 방어는 길이 검증에만 의존).
3. **한국어 보조 목록 보강 여부 선택지**:
   - 글로벌 NCSC 목록에는 한글(`가-힣`) 및 2벌식 영문 변환 단어가 0건이다.
   - **선택지 A**: 글로벌 NCSC 100k 목록만 단일 차단 목록으로 유지.
   - **선택지 B**: 15자 이상의 한국어 일반 문구(예: 2벌식 변환 장문열)를 별도의 보조 로컬 목록으로 정의하여 함께 차단 목록에 병합.
