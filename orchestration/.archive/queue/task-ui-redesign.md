# UI 디자인 리뉴얼 — 실행 지시서

## 현재 상태
- :root CSS 변수 → 화이트 기반으로 교체 완료 (Phase 1 done)
- body 그라데이션 제거 → `var(--bg-secondary)` 적용 완료 (Phase 2 done)
- 나머지 3700줄에 hardcoded dark-mode rgba 200+곳 남아있음

## 핵심 원칙
- **Stitch MCP 사용**: 디자인 결정에 Stitch MCP 도구 활용
- **Apple HIG 준수**: 여백 넉넉, 카드 깔끔, 그림자 미세
- **뺄 것 빼기**: backdrop-filter, 복잡한 그라데이션, glassmorphism 전부 제거
- **파일 1개만**: styles.css만 수정. 새 파일 금지.

---

## claude-ui 세션 지시

### Step 1: Stitch MCP로 참조 디자인 생성
Stitch MCP 도구를 사용해서:
- "Clean white mobile app with 3 tabs (Pet, Arena, Feed), Apple HIG style, subtle purple accent #7C3AED" 프롬프트로 참조 디자인 생성
- 디자인 토큰(색상, 그림자, 보더) 추출
- 생성된 CSS를 참고해서 아래 작업 진행

### Step 2: 하드코딩 rgba 일괄 변환 (styles.css)

**규칙표:**

| 패턴 | 변환 |
|------|------|
| `rgba(28, 28, 30, X)` | `var(--bg-secondary)` 또는 `#F5F5F7` |
| `rgba(44, 44, 46, X)` | `var(--cardBg)` 또는 `#FFFFFF` |
| `rgba(10, 14, 22, X)` | `var(--bg-secondary)` |
| `rgba(18, 24, 38, X)` | `var(--bg-secondary)` |
| `rgba(7, 10, 18, X)` | `var(--bg-secondary)` |
| `rgba(255, 255, 255, 0.0x~0.2x)` | `rgba(0, 0, 0, 0.0x)` (opacity 절반으로) |
| `rgba(255, 255, 255, 0.55)` | `rgba(0, 0, 0, 0.45)` |
| `rgba(0, 0, 0, 0.55)` 모달 | `rgba(0, 0, 0, 0.25)` |
| `rgba(191, 90, 242, X)` | `rgba(124, 58, 237, X)` (새 accent) |
| `rgba(94, 92, 230, X)` | `rgba(79, 70, 229, X)` (새 accent2) |
| `rgba(124, 92, 255, X)` | `rgba(124, 58, 237, X)` |

**다크모드 텍스트 색상:**
| 패턴 | 변환 |
|------|------|
| `#ffe1e1, #ffd5d5, #ffe6e6, #ffe0e0, #fff5f5` | `var(--danger)` 또는 `#991B1B` |
| `#ffe9d8` | `#9A3412` (dark orange) |
| `color: white` (on accent bg) | 그대로 유지 |

### Step 3: 컴포넌트별 정리

**tabbar (line ~1510):**
```css
background: rgba(255, 255, 255, 0.95);
border-top: 1px solid rgba(0, 0, 0, 0.06);
```
- `::before` 그라데이션 → white 페이드

**topbar, card, modal:**
- `backdrop-filter: blur(Xpx)` 전부 제거
- `-webkit-backdrop-filter: blur(Xpx)` 전부 제거
- 단, `.modalOverlay`의 blur는 유지

**input/textarea/select:**
```css
background: #FFFFFF;
border: 1px solid rgba(0, 0, 0, 0.12);
```

**btn:**
```css
border: 1px solid rgba(0, 0, 0, 0.08);
background: rgba(0, 0, 0, 0.04);
```

**btn.primary:**
```css
background: var(--accent);
box-shadow: 0 2px 8px rgba(124, 58, 237, 0.2);
```

### Step 4: 불필요한 CSS 제거
- streak 관련 클래스 전부 삭제 (`.topbarStreakBadge`, `.streakWarningBanner`, `.streakWarningPill`, `.streakWarningTimer`, `@keyframes streakWarnPulse`)
- 동결 기능 CSS는 건드리지 않음

### Step 5: 빌드 검증
```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet/apps/web
npx tsc --noEmit
npx vite build
```

---

## 금지 사항
- 새 파일 만들지 않음
- .tsx 파일 수정하지 않음 (CSS만)
- 동결 기능 CSS 건드리지 않음
- 과도한 애니메이션 추가 금지
