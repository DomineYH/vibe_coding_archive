# #111 visual partial raster 비활성화 공통화

## 변경 이유

- `--disable-partial-raster`를 visual 공통 설정(`frontend/playwright.visual.config.js`)에 적용했다. app-create spec의 개별 덮어쓰기는 제거했다.
- `gallery-loading` 1024×900 CI 실패(±1, 둥근 가장자리)와 같은 계열의 래스터 흔들림을 모든 spec에서 예방하기 위함이다. 연속 캡처 결정성 테스트(`gallery.spec.js`)도 추가했다.

## 승인

- 메인테이너 2026-10-01 승인. 기준 이미지 2장으로 한정: `docs/evidence/phase-2/issue95/2026-09-30/visual-state-baselines/gallery-empty-{360x844,390x844}.png`
- #95의 `verification-summary.json`과 README는 당시 기록이므로 수정하지 않았다.

## 기준 이미지 해시 (옛 → 새, sha256)

- 360x844: `333dbe77784dd2ba68efaeacbca58d381ba22220a657e30538fd9dba14625070` → `72f0f68ccb9ff2f9f083799abcdac299ef25355ff104c256109a43c537123d9d`
- 390x844: `0bc969bc4c5572a4de2f378c720639769cda422736257a3ce649403815f9d84d` → `6c8e940ee21103ab033bbd247a9ba8679aae626e12d8edf12cddeebdc8b2d4b7`

## 차이 영역

- 플래그를 켜면 과목 탭 pill 행 가장자리에서만 89px(maxChannelDelta 18)가 달라진다. 크기는 동일하다.
- 360x844: bbox x34–301, y404–429 / 390x844: bbox x34–301, y365–390 (포함 범위). 그 밖의 픽셀은 같다.

## 가설 확인 (retries=0, 결정성 테스트)

- (a) 플래그 없음: 10회 중 셋업 실패 1건(status locator 미발견, 픽셀 비교 이전) + 별도 30회 중 30 통과. 픽셀 흔들림 0건.
- (b) 플래그 있음: 30회 중 30 통과.

## 원인 판정

- 미확정, 예방 조치 적용.
