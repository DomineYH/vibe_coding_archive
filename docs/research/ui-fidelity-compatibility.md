# 원본 UI 충실도 보존을 위한 프론트엔드 의존성 및 호환성 조사 보고서

- **조사 일자**: 2026-09-22
- **대상 이슈**: GitHub Issue #3 (원본 UI를 보존할 프론트엔드 의존성·폰트 조합 조사)
- **참조 근거**: PRD v1.0 (§4~5, §11), `basic_design/` 원본 코드 (HTML/JSX/CSS)
- **원칙**: 1차 출처(공식 문서, 패키지 레지스트리 메타데이터, 보안 권고 벌크 API, 공식 표준)만 근거로 활용

> [!IMPORTANT]
> **후보안 성격 및 검증 기준 안내**
> 본 보고서에서 제시하는 버전 조합(Option A)은 2026-09-22 시점의 1차 출처 조사에 근거한 **조사 후보(Candidate)**일 뿐이며, 후속 HITL(Human-in-the-Loop) 검토 및 Phase 1 브라우저 캡처 비교 통과 전까지는 채택을 확정하지 않습니다.
> 동일 버전을 채택하더라도 런타임 환경, 번들러 플러그인, CSS 캐스케이딩 및 OS 폰트 래스터라이저 차이로 인해 시각적 차이가 발생할 수 있으므로, **"실제 시각적 동등성은 원본과 이식본의 브라우저 캡처로만 판정"**합니다.

---

## 1. 핵심 질문 및 조사 요약

> **질문**: 원본 JSX/CSS/아이콘/폰트의 렌더링을 유지하면서 PRD의 Vite·빌드형 Tailwind·React Router·TanStack Query로 옮길 때 사용할 수 있는 정확한 버전 조합과 호환성 제약은 무엇인가?

### 핵심 요약
1. **버전 조합 후보 (Option A: 최소 위험 보존 후보)**
   - **React / React-DOM**: `18.3.1` (원본 CDN과 동일 버전 후보; 단, 실제 렌더링 동등성은 브라우저 캡처로 판정)
   - **Vite**: `6.4.3` (이전 6.4.2 이하의 Windows 관련 보안 권고 등이 해결된 6.x 안정판 후보, Node 18/20/22 지원)
   - **@vitejs/plugin-react**: `4.3.4` (Vite 6 호환 공식 플러그인 후보. 내부적으로 `@babel/core`를 사용하나, 플러그인 옵션·트랜스파일 파이프라인 차이로 인해 브라우저 런타임 `@babel/standalone@7.29.0`과 변환 결과가 일치한다고 단정할 수 없으며 Phase 1 빌드 및 캡처 검증 필수)
   - **Tailwind CSS**: `3.4.17` (Tailwind Play CDN 리다이렉트 대상과 동일 버전 후보, `tailwind.config.js`를 통한 색상 재정의 구조 유지 후보; 실제 렌더링 동등성은 브라우저 캡처로 판정)
   - **PostCSS / Autoprefixer**: `postcss@8.5.28`, `autoprefixer@10.6.1` (보안 패치 확인 버전 후보)
   - **React Router**: `react-router-dom@6.30.6` (React 18 호환 범위 내 v6 안정판 후보, Remix 병합 v7의 프레임워크 변경 회피)
   - **TanStack Query**: `@tanstack/react-query@5.66.9` (React 18 피어 의존성 범위 내 v5 안정판 후보)
   - **아이콘**: `lucide-react@0.453.0` (원본 CDN 명시 버전과 동일 버전 후보, 빈 span 프록시 폴백 제거 후 ESM named import 적용; 실제 글리프 렌더링 동등성은 브라우저 캡처로 판정)
   - **글꼴**: `pretendard@1.3.9` (SIL Open Font License 1.1, 오프라인 번들링 지원 후보)

2. **런타임 및 설치 조건 주의사항**
   - 권장 Node 환경: `^20.19.0 || >=22.0.0` (현재 개발 환경: Node `v22.23.2`, npm `12.0.2` 기준 메타데이터 요구치 부합)
   - **피어 의존성(peerDependencies) 한계 명시**: npm 레지스트리 메타데이터 상으로는 후보 패키지 간의 선언 범위가 충돌하지 않는 것으로 확인되었으나, 본 티켓의 범위 제약(패키지 설치 및 잠금파일 작성 금지)에 따라 실제 임시 `npm install` 및 lockfile 생성을 수행하지 않았으므로 실제 설치 시의 peer 충돌 여부는 미검증 상태이며 Phase 1 착수 시 검증이 필요합니다.

---

## 2. 의존성 패키지 호환성 및 버전 비교

- **조회일**: 2026-09-22
- **보안 권고 1차 검증 방법**: npm 벌크 보안 권고 API(`POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`)를 통해 각 후보 버전의 패키지명을 직접 페이로드로 전송하여 질의함.

| 패키지 | 원본 상태 (CDN) | 권장 후보 (Option A) | 최신 메이저 (Option B) | Node/npm 요건 | 보안 권고 질의 결과 (2026-09-22) | 불확실성 (Uncertainty) | 1차 출처 근거 |
|---|---|---|---|---|---|---|---|
| **react** | `18.3.1` | `18.3.1` | `19.3.0` | `>=0.10.0` | 0건 보고 (벌크 API 질의) | 동일 버전 후보이나 실제 렌더링 동등성은 브라우저 캡처로 판정 | [npm: react@18.3.1](https://registry.npmjs.org/react/18.3.1), [React 18.3.1 Release](https://github.com/facebook/react/releases/tag/v18.3.1) |
| **react-dom** | `18.3.1` | `18.3.1` | `19.3.0` | peer: `react@^18.3.1` | 0건 보고 (벌크 API 질의) | 실제 설치 미실시로 잠금파일 생성 시 peer 검증 필요 | [npm: react-dom@18.3.1](https://registry.npmjs.org/react-dom/18.3.1) |
| **vite** | 미사용 | `6.4.3` | `8.3.0` | `^18.0.0 \|\| ^20.0.0 \|\| >=22.0.0` | 0건 보고 (6.4.2 이하 GHSA-fx2h-pf6j-xcff 패치 확인) | 빌드 번들러 교체에 따른 에셋 서빙 경로 차이 검증 필요 | [npm: vite@6.4.3](https://registry.npmjs.org/vite/6.4.3), [Vite Guide](https://vite.dev/guide/) |
| **@vitejs/plugin-react** | Babel 7.29.0 CDN | `4.3.4` | `6.1.1` (Vite 8 전용) | peer: `vite@^4/5/6` | 0건 보고 (벌크 API 질의) | Babel standalone과의 변환 결과 일치 미보장(Phase 1 빌드 검증 대상) | [npm: @vitejs/plugin-react@4.3.4](https://registry.npmjs.org/@vitejs/plugin-react/4.3.4) |
| **tailwindcss** | CDN (3.4.17 리다이렉트) | `3.4.17` | `4.3.3` | `>=14.0.0` | 0건 보고 (벌크 API 질의) | 동일 버전 후보이나 빌드형 PostCSS 설정과의 캐스케이딩 검증 필요 | [npm: tailwindcss@3.4.17](https://registry.npmjs.org/tailwindcss/3.4.17), [Play CDN Docs](https://tailwindcss.com/docs/installation/play-cdn) |
| **postcss** | 미사용 | `8.5.28` | `8.5.28` | `>=10.0.0` | 0건 보고 (8.5.22 이하 GHSA-fxqj-rqcc-2cmp 패치 확인) | 빌드 환경 종속성 검증 필요 | [npm: postcss@8.5.28](https://registry.npmjs.org/postcss/8.5.28) |
| **autoprefixer** | 미사용 | `10.6.1` | `10.6.1` | `>=10.0.0` | 0건 보고 (벌크 API 질의) | 빌드 환경 종속성 검증 필요 | [npm: autoprefixer@10.6.1](https://registry.npmjs.org/autoprefixer/10.6.1) |
| **react-router-dom** | 미사용 (해시/상태 뷰) | `6.30.6` | `7.18.4` | `>=14.0.0`, peer: `react@>=16.8` | 0건 보고 (벌크 API 질의) | 기존 탭 전환 상태를 브라우저 History로 매핑 시 라우팅 검증 필요 | [npm: react-router-dom@6.30.6](https://registry.npmjs.org/react-router-dom/6.30.6), [React Router Release](https://github.com/remix-run/react-router/releases/tag/react-router%406.28.2) |
| **@tanstack/react-query** | 미사용 (인라인 mock) | `5.66.9` | `5.103.2` | peer: `react@^18 \|\| ^19` | 0건 보고 (벌크 API 질의) | 실제 설치 미실시로 임시 install 검증 미완료 | [npm: @tanstack/react-query@5.66.9](https://registry.npmjs.org/@tanstack/react-query/5.66.9), [TanStack Docs](https://tanstack.com/query/v5/docs/framework/react/overview) |
| **lucide-react** | `0.453.0` UMD | `0.453.0` | `1.47.0` | peer: `react@^16 \|\| ^17 \|\| ^18 \|\| ^19` | 0건 보고 (벌크 API 질의) | 동일 버전 후보이나 실제 렌더링 글리프 동등성은 브라우저 캡처로 판정 | [npm: lucide-react@0.453.0](https://registry.npmjs.org/lucide-react/0.453.0), [Lucide Guide](https://lucide.dev/guide/packages/lucide-react) |
| **pretendard** | `1.3.9` jsDelivr CDN | `1.3.9` | `1.3.9` | 모든 Node 환경 호환 | 0건 보고 (벌크 API 질의) | 로컬 번들 시 픽셀 동일성 자동 미보장(OS별 래스터라이저 차이) | [npm: pretendard@1.3.9](https://registry.npmjs.org/pretendard/1.3.9), [Pretendard Repo](https://github.com/orioncactus/pretendard) |

---

## 3. Tailwind CSS 충실도 분석 및 v3 vs v4 비교

### 3.1 원본 Tailwind 색상 재정의 및 스케일 유지
원본 `basic_design/EduVibe 아카이브.html`은 다음 스크립트로 설정을 주입합니다:
```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        white: '#FBFAF7',
        neutral: { 50:'#F7F5F1', 100:'#F0EEE9', 200:'#E2DED5', 300:'#CFC9BF', 400:'#9A948B', 500:'#75706A', 600:'#585450', 700:'#433F3C', 800:'#2F2C29', 900:'#232120' },
        emerald: { 50:'#EAF1EE', 200:'#C1D7D0', 600:'#3C7A72', 700:'#2F6159' },
        red:     { 50:'#F6EBEA', 200:'#E2C7C6', 600:'#9B3B41', 700:'#7D2F34' },
        amber:   { 50:'#F7F1E4', 200:'#E3D3B6', 600:'#A9714B', 700:'#8A5C3D', 800:'#6F4A31' },
      },
    },
  },
};
```
- **Tailwind v3.4.17**:
  - `tailwind.config.js`의 `theme.extend.colors`에 상기 객체를 동일하게 구성하는 후보입니다.
  - 동일 설정 구성을 채택하더라도 빌드 시 CSS 추출 순서 및 전역 인라인 스타일과의 결합에 따라 차이가 생길 수 있으므로, **동일 버전 후보이며 실제 동등성은 원본/이식본 브라우저 캡처로만 판정**합니다.
  - 근거: [Tailwind CSS Theme Configuration](https://tailwindcss.com/docs/theme), [Customizing Colors](https://tailwindcss.com/docs/customizing-colors).
- **Tailwind v4.x 도입 시 위험**:
  - v4는 `tailwind.config.js` 대신 CSS 전용 `@theme` 디렉티브 구조로 전면 개편되었습니다.
  - v4의 색상 불투명도 및 CSS 변수 바인딩 방식 변경으로 인해 기존 v3 임의 투명도 문법과 시각적 차이가 발생할 위험이 있습니다.
  - 근거: [Tailwind CSS Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide).

### 3.2 임의 값(Arbitrary Values), 불투명도(Alpha), 그리드 문법
`basic_design/*.jsx` 전수 분석 결과 사용된 핵심 임의 클래스:
1. **임의 색상 및 Alpha 문법**:
   - `bg-[#EAE7E2]/88`, `bg-[#4C7A96]/[0.10]`, `border-[#4C7A96]/20`, `border-[#4C7A96]/40`
   - `ring-[#4C7A96]/10`, `ring-black/[0.06]`, `shadow-[#4C7A96]/25`
   - `border-neutral-200/80`, `border-neutral-200/70`, `bg-white/10`, `bg-white/20`, `bg-white/60`, `bg-black/15`, `bg-black/35`
2. **임의 크기 / 그리드 / 종횡비**:
   - 그리드: `grid-cols-[1fr_320px]`, `grid-cols-[1fr_340px]`
   - 종횡비: `aspect-[16/10]`, `aspect-[16/5.5]`, `aspect-[16/7]`
   - 최대/최소 너비: `max-w-[1280px]`, `max-w-[1080px]`, `max-w-[420px]`, `max-w-[60%]`, `min-w-[160px]`, `min-w-[200px]`, `min-w-[220px]`
   - 높이/여백: `h-[57px]`, `top-[57px]`, `left-[26px]`, `left-[3px]`, `w-[3px]`
   - 타이포그래피: `text-[10.5px]`, `text-[11.5px]`, `text-[12.5px]`, `text-[13.5px]`, `text-[15.5px]`, `text-[17px]`, `text-[26px]`, `text-[28px]`, `text-[34px]`, `text-[44px]`
   - 그림자: `shadow-[0_1px_2px_rgba(0,0,0,0.04)]`, `shadow-[0_14px_32px_-12px_rgba(15,76,129,0.22)]`
   - 애니메이션: `animate-[toastIn_0.25s_ease-out]`
3. **`h-5.5`, `w-5.5` 클래스 처리 주의점**:
   - `basic_design/ui.jsx` 68행: `<span className={'... h-5.5 w-5.5 ...'} style={{ width: 22, height: 22 }}></span>`
   - Tailwind 기본 스케일에는 `5.5`(1.375rem / 22px)가 기본 정의되어 있지 않습니다. 원본 코드에서는 인라인 스타일 `style={{ width: 22, height: 22 }}`로 보완하고 있습니다.
   - 빌드형 Tailwind 전환 시 `theme.extend.spacing['5.5'] = '1.375rem'`을 추가하는 방안을 고려할 수 있으나, 실제 토글 크기 동등성은 브라우저 캡처로 판정해야 합니다.
   - 근거: [Tailwind CSS Arbitrary Values](https://tailwindcss.com/docs/adding-custom-styles#using-arbitrary-values).

### 3.3 Preflight 호환성
- 원본 HTML은 `https://cdn.tailwindcss.com` 로드 시 기본 Preflight(브라우저 스타일 초기화)를 적용받았습니다.
- 빌드형 Tailwind v3.4.17의 `@tailwind base;`가 주입하는 Preflight는 동일 계통의 리셋 규칙을 따르는 후보이나, 빌드 환경에 따른 스타일 적용 순서 영향이 있을 수 있어 실제 동등성은 원본/이식본 브라우저 캡처로만 판정합니다.
- 근거: [Tailwind CSS Preflight](https://tailwindcss.com/docs/preflight).

---

## 4. 글꼴 및 CSS 규격: Pretendard Variable & `color-mix()`

### 4.1 Pretendard Variable 공급, 라이선스 및 렌더링 한계
- **라이선스**: SIL Open Font License (OFL-1.1)
  - 상업적 이용 및 소프트웨어 번들링/재배포 허용.
  - 근거: [Pretendard OFL-1.1 LICENSE](https://raw.githubusercontent.com/orioncactus/pretendard/main/LICENSE).
- **원본 사용 방식**:
  - `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`
  - jsDelivr CDN을 통해 다이나믹 서브셋 WOFF2 파일들을 네트워크에서 온디맨드 다운로드함.
- **오프라인/결정론적 재현과 픽셀 동등성의 한계**:
  - npm 패키지 `pretendard@1.3.9`를 설치하거나 가변 폰트 파일을 로컬에 번들링하면 외부 CDN 다운로드 실패를 방지하여 **네트워크 결정성 및 오프라인 가용성을 확보**할 수 있습니다.
  - **그러나 로컬 번들링이 픽셀 단위 동일성(Pixel-perfect fidelity)을 자동으로 보장하지는 않습니다.**
  - 이유: 클라이언트 OS(Linux, macOS, Windows)별 텍스트 래스터라이저 엔진(FreeType, Core Text, DirectWrite)의 차이, 서브픽셀 앤티앨리어싱 방식, 글꼴 힌팅 처리, 디스플레이 DPR 차이에 따라 텍스트의 미세한 굵기나 자간이 다르게 렌더링될 수 있습니다.
  - 따라서 로컬 번들은 네트워크 장애를 방지하는 조치이며, 시각적 동등성 평가는 동일 캡처 환경(동일 OS·동일 브라우저·동일 DPR)에서의 비교 캡처로만 검증 가능합니다.
  - 근거: [Pretendard Official Repository](https://github.com/orioncactus/pretendard).

### 4.2 CSS `color-mix()` 규격 및 호환성 분류
- 원본 `basic_design/EduVibe 아카이브.html` 인라인 CSS:
  ```css
  .acc-soft { background-color: color-mix(in srgb, var(--accent) 9%, var(--cloud-dancer)); }
  ::selection { background: color-mix(in srgb, var(--accent) 24%, var(--cloud-dancer)); }
  a:hover { color: color-mix(in srgb, var(--accent) 72%, #232120); }
  ```
- **표준 규격**: W3C CSS Color Module Level 4 §5.6
  - 근거: [W3C CSS Color 4 color-mix](https://www.w3.org/TR/css-color-4/#color-mix).
- **브라우저 최소 버전 호환성 상태**: **[미검증]**
  - W3C 사양서는 표준 기능만을 정의하며 브라우저 벤더의 최소 지원 버전을 증명하지 않습니다.
  - 구체적인 브라우저 버전 지원 여부는 벤더 공식 릴리스 공지를 직접 대조하지 않았으므로 미검증 상태로 분류하며, 실제 동작 여부는 Phase 1의 대상 브라우저 및 Playwright 캡처 환경에서 직접 렌더링하여 판정해야 합니다.

---

## 5. Lucide 아이콘: ESM 모듈 매핑 및 글리프 충실도

### 5.1 원본 폴백 프록시 분석 및 결함 방지
- 원본 `basic_design/ui.jsx` 2행:
  ```javascript
  const LR = (window.LucideReact && window.LucideReact.Copy)
    ? window.LucideReact
    : new Proxy({}, { get: () => (p) => <span style={{ display: 'inline-block', width: p.size || 16, height: p.size || 16 }}></span> });
  ```
  - 원본은 CDN 로딩 실패 시 빈 span으로 오류를 숨기는 폴백을 포함하고 있습니다.
  - Issue #3 지침: **"빈 span을 충실도 성공으로 취급하지 않는다."**
  - ESM 모듈 기반 전환 시 정적 named import를 적용하여, 아이콘 이름 오류나 누락이 있을 경우 번들 타임에 즉시 오류를 검출하도록 구성해야 합니다.

### 5.2 사용 아이콘 전수 조사 및 UMD vs ESM 매핑
원본 basic_design 전체 JSX 파일에서 사용된 12개 아이콘을 확인하고 `lucide-react@0.453.0` 메타데이터 및 SVG 정의와의 1:1 매핑을 조사하였습니다:

| 아이콘 이름 | 원본 사용 파일 및 위치 | UMD 속성명 | ESM Named Import 구문 | 글리프 판정 기준 |
|---|---|---|---|---|
| **ArrowUpRight** | `view-detail.jsx:50` | `window.LucideReact.ArrowUpRight` | `import { ArrowUpRight } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **Check** | `ui.jsx:88` | `window.LucideReact.Check` | `import { Check } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **ChevronLeft** | `view-detail.jsx:14` | `window.LucideReact.ChevronLeft` | `import { ChevronLeft } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **Copy** | `ui.jsx:88` | `window.LucideReact.Copy` | `import { Copy } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **Inbox** | `ui.jsx:162` | `window.LucideReact.Inbox` | `import { Inbox } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **Loader2** | `ui.jsx:22` | `window.LucideReact.Loader2` | `import { Loader2 } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **Lock** | `ui.jsx:127` | `window.LucideReact.Lock` | `import { Lock } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **LogOut** | `app.jsx:54` | `window.LucideReact.LogOut` | `import { LogOut } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **Pencil** | `view-detail.jsx:18` | `window.LucideReact.Pencil` | `import { Pencil } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **RefreshCw** | `view-admin.jsx:117`, `view-detail.jsx:112` | `window.LucideReact.RefreshCw` | `import { RefreshCw } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **Search** | `view-gallery.jsx:44` | `window.LucideReact.Search` | `import { Search } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |
| **SearchX** | `view-gallery.jsx:57` | `window.LucideReact.SearchX` | `import { SearchX } from 'lucide-react'` | 동일 버전 후보이며 실제 동등성은 브라우저 캡처로만 판정 |

- **버전 선정 배경**: 원본 HTML에 명시된 버전인 `0.453.0`을 유지하는 것이 메이저 변경에 따른 패딩/스트로크 변경 위험을 최소화할 수 있는 유력 후보이나, 최종 글리프 일치성은 실제 화면 렌더링 캡처를 통해 판정해야 합니다.
- 근거: [Lucide React Guide](https://lucide.dev/guide/packages/lucide-react).

---

## 6. 점진적 전환 및 TypeScript 방침 (PRD §5 / §11)

### 6.1 Babel 트랜스파일 동등성 단정 철회
- 이전 검토에서 제기되었던 "@vitejs/plugin-react의 Babel 7 의존성이 @babel/standalone 7.29.0과 동일 변환을 보장한다"는 주장은 **철회**합니다.
- 사유: Vite 플러그인은 번들러 환경에서 동작하며 내부 프리셋, 헬퍼 함수 인라인 처리, JSX 런타임(`react/jsx-runtime` vs `React.createElement`) 설정에 따라 `@babel/standalone`의 브라우저 인라인 트랜스파일 결과물과 차이가 발생할 수 있습니다. 따라서 실제 JSX 변환 결과와 렌더링 동등성은 Phase 1 빌드 검증을 통해 확인해야 합니다.

### 6.2 점진적 TypeScript 적용
- PRD 원칙: "서비스·API 계약부터 적용한다. 기존 JSX의 일괄 TSX 변환이 첫 구동을 막지 않게 한다." (PRD §5)
- Vite 환경에서 `tsconfig.json`의 `"allowJs": true`를 활용하여:
  - Phase 1: `basic_design/*.jsx` UI 컴포넌트를 변경 없이 `.jsx` 파일로 유지하여 첫 구동을 확보.
  - Phase 2 이후: `frontend/src/contracts/`, `frontend/src/services/`부터 TypeScript(`.ts`)를 점진적으로 적용.

---

## 7. 브라우저 지원 및 캡처/시각 회귀 검수 환경 제약

1. **브라우저 지원 제약 [미검증 상태]**:
   - `color-mix(in srgb, ...)`, CSS Grid arbitrary tracks (`grid-cols-[1fr_320px]`), CSS Variable이 요구되나, 벤더 공식 릴리스 기반의 최소 브라우저 버전은 미검증 상태이며 Phase 1 실측 캡처로 확인해야 합니다.
2. **시각 검수(Playwright) 캡처 환경 제약**:
   - **OS 글꼴 렌더링 차이**: Linux/macOS/Windows의 폰트 엔진 차이로 서브픽셀 렌더링 결과가 달라질 수 있으므로, 시각 회귀 테스트는 동일한 OS 환경과 동일한 뷰포트/DPR 조건에서 수행해야 합니다.
   - **캡처 일관성 확보**: PRD §4.3의 4개 규격(1440×1000, 1024×900, 768×1024, 390×844)을 고정하고, `animate-spin` 및 `toastIn` 등의 애니메이션은 비활성화(`animations: 'disabled'`)한 상태에서 캡처해야 합니다.
   - 근거: [Vite Guide: Env and Mode](https://vite.dev/guide/env-and-mode), [Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots).

---

## 8. 1차 출처 URL 및 조회일 검증 기록 (총 30건)

모든 근거는 2026-09-22 기준 유효한 1차 출처(공식 레지스트리, 공식 저장소, W3C 표준, 보안 API)에서 확인되었습니다.

1. `https://registry.npmjs.org/react/18.3.1` (React 18.3.1 메타데이터)
2. `https://registry.npmjs.org/react-dom/18.3.1` (ReactDOM 18.3.1 피어 의존성)
3. `https://github.com/facebook/react/releases/tag/v18.3.1` (React 공식 릴리스 공지)
4. `https://react.dev/blog/2024/04/25/react-19-upgrade-guide` (React 19 마이그레이션 안내)
5. `https://registry.npmjs.org/vite/6.4.3` (Vite 6.4.3 메타데이터)
6. `https://vite.dev/guide/` (Vite 공식 가이드)
7. `https://vite.dev/guide/env-and-mode` (Vite 환경 변수 공식 문서)
8. `https://registry.npmjs.org/@vitejs/plugin-react/4.3.4` (React 플러그인 메타데이터)
9. `https://registry.npmjs.org/tailwindcss/3.4.17` (Tailwind CSS 3.4.17 메타데이터)
10. `https://tailwindcss.com/docs/installation/play-cdn` (Tailwind Play CDN 공식 문서)
11. `https://tailwindcss.com/docs/theme` (Tailwind 테마 확장 공식 문서)
12. `https://tailwindcss.com/docs/customizing-colors` (Tailwind 색상 커스터마이징 문서)
13. `https://tailwindcss.com/docs/adding-custom-styles#using-arbitrary-values` (임의 값 및 alpha 공식 문서)
14. `https://tailwindcss.com/docs/preflight` (Preflight 스타일 초기화 문서)
15. `https://tailwindcss.com/docs/upgrade-guide` (Tailwind v4 마이그레이션 변경점)
16. `https://cdn.tailwindcss.com` (Tailwind Play CDN 엔드포인트 - 3.4.17로 리다이렉트)
17. `https://registry.npmjs.org/react-router-dom/6.30.6` (React Router v6 메타데이터)
18. `https://github.com/remix-run/react-router/releases/tag/react-router%406.28.2` (React Router 공식 릴리스)
19. `https://registry.npmjs.org/@tanstack/react-query/5.66.9` (TanStack Query v5 메타데이터)
20. `https://tanstack.com/query/v5/docs/framework/react/overview` (TanStack Query React 공식 가이드)
21. `https://registry.npmjs.org/lucide-react/0.453.0` (Lucide React 0.453.0 메타데이터)
22. `https://lucide.dev/guide/packages/lucide-react` (Lucide React 공식 가이드)
23. `https://registry.npmjs.org/pretendard/1.3.9` (Pretendard 1.3.9 패키지 메타데이터)
24. `https://github.com/orioncactus/pretendard` (Pretendard 공식 저장소)
25. `https://raw.githubusercontent.com/orioncactus/pretendard/main/LICENSE` (SIL Open Font License 1.1)
26. `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css` (Pretendard 원본 CDN 스타일시트)
27. `https://www.w3.org/TR/css-color-4/#color-mix` (W3C CSS Color 4 공식 표준)
28. `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` (npm 벌크 보안 권고 질의 엔드포인트)
29. `https://nodejs.org/en/about/previous-releases` (Node.js 공식 릴리스 주기 및 LTS 정보)
30. `https://playwright.dev/docs/test-snapshots` (Playwright 공식 시각 회귀 스냅샷 가이드)

---

## 9. 후속 HITL (Human-in-the-Loop) 결정 사항 및 채택 유의점

> **채택 유의사항**: 아래 안들은 2026-09-22 조사에 기반한 후보군이며, 실제 채택은 HITL 검토를 거쳐 결정되며 Phase 1의 실제 브라우저 캡처 티켓 통과 전까지는 채택이 확정되지 않습니다.

1. **글꼴 제공 방식 결정**:
   - *후보 1*: `pretendard@1.3.9` 패키지를 통한 로컬 번들링 (네트워크 결정성 확보; 단, OS별 래스터라이저 차이에 따른 픽셀 동등성은 브라우저 캡처로 검증 필요).
   - *후보 2*: 기존 jsDelivr CDN 동적 서브셋 링크 유지 (번들 크기 최소화되나 외부망 차단 시 글꼴 렌더링 실패 위험 존재).
2. **Tailwind 버전 유지 정책**:
   - *후보 1*: Phase 1~4까지 Tailwind v3.4.17 유지하여 원본 색상/클래스 설정을 보존하고, 시각적 동등성을 브라우저 캡처로 우선 검증한 후 추후 v4 전환 검토.
   - *후보 2*: 초기부터 v4 도입 (CSS `@theme` 재작성 필요, 시각적 편차 위험 검수 필요).
3. **`h-5.5`, `w-5.5` 토글 스위치 클래스 처리**:
   - *후보 1*: `tailwind.config.js`에 `spacing: { '5.5': '1.375rem' }`를 추가하여 원본 클래스 지원 검토.
   - *후보 2*: 원본의 인라인 스타일 `style={{ width: 22, height: 22 }}`에 의존하거나 `h-[22px] w-[22px]`로 교체 검토.
