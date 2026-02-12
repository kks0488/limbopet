# TASK: UI 디자인 리뉴얼 — 화이트 기반, 미려하고 일관성 있게

## 현재 상태
- 다크모드 전용 (color-scheme: dark)
- rgba 하드코딩 33곳, 그라데이션 39곳
- CSS 변수 60%만 실사용, 나머지 하드코딩
- 보라 글래스모피즘 → 게임 느낌, 프로덕트 느낌 아님

## 목표
- 화이트 배경, 깨끗하고 미려한 디자인
- CSS 변수 100% 사용 (하드코딩 제거)
- 핵심 3탭만 신경씀: 펫 | 아레나 | 피드
- Apple HIG 스타일: 여백 넉넉, 카드 깔끔, 그림자 미세

---

## 디자인 토큰 (새 컬러 시스템)

```css
:root {
  color-scheme: light;

  /* 배경 */
  --bg: #FFFFFF;
  --bg-secondary: #F5F5F7;
  --surface: #FFFFFF;

  /* 텍스트 */
  --text: #1D1D1F;
  --text-secondary: #6E6E73;
  --muted: #86868B;

  /* 카드 */
  --cardBg: #FFFFFF;
  --cardBgStrong: #FFFFFF;
  --card-border: rgba(0, 0, 0, 0.06);

  /* 보더 */
  --border: rgba(0, 0, 0, 0.08);
  --separator: rgba(0, 0, 0, 0.1);

  /* 액센트 — 보라 유지 but 채도 조절 */
  --accent: #7C3AED;
  --accent-light: #EDE9FE;
  --accent2: #4F46E5;

  /* 시맨틱 */
  --danger: #EF4444;
  --good: #10B981;
  --warn: #F59E0B;

  /* 그림자 — 미세하게 */
  --shadow1: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow2: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-warm: 0 2px 8px rgba(0, 0, 0, 0.06);
  --shadow-glow: 0 0 0 3px rgba(124, 58, 237, 0.15);

  /* 레이아웃 */
  --radius-card: 16px;
  --radius-btn: 12px;
  --radius-pill: 999px;
}
```

---

## 실행 계획

### Phase 1: CSS 변수 교체 (styles.css :root)
- `:root` 블록의 모든 변수를 화이트 기반으로 교체
- `color-scheme: dark` → `color-scheme: light`
- body 배경 그라데이션 제거 → 깨끗한 화이트

### Phase 2: 하드코딩 rgba 제거 (33곳)
- `rgba(28,28,30,...)` → `var(--surface)` 또는 `var(--bg-secondary)`
- `rgba(44,44,46,...)` → `var(--cardBg)`
- `rgba(0,0,0,0.3+)` 그림자 → `var(--shadow1)` / `var(--shadow2)`
- `rgba(255,255,255,...)` 텍스트/보더 → `var(--text)` / `var(--border)`

### Phase 3: body/레이아웃 정리
- body 퍼플 그라데이션 → `background: var(--bg-secondary)`
- `.container` 패딩 조정
- `.card` 스타일: 흰 배경 + 미세 보더 + 미세 그림자

### Phase 4: 컴포넌트 정리
- TabBar: 하단 탭 — 화이트 bg, 미세 top border
- TopBar: 상단바 — 화이트 bg, 미세 bottom border
- PetCard: 대화 영역 — 깨끗한 카드
- ArenaCard: 재판 결과 — 깨끗한 카드
- PlazaPost: 피드 포스트 — 깨끗한 카드

### Phase 5: 타입체크 + 빌드 확인
- `npx tsc --noEmit`
- `npx vite build`
- 브라우저 확인

---

## 세션 배분

### claude-ui (이 세션 = Claude Code)
- Phase 1-3: styles.css 전면 교체 (메인 작업)
- Phase 4: 컴포넌트 CSS 정리
- Phase 5: 빌드 확인

### codex-limbopet
- 대기. 프론트엔드 작업이라 백엔드 건드릴 것 없음.
- 필요시: ArenaTab.tsx, PlazaPost.tsx 컴포넌트 내 인라인 스타일 정리

### simulation
- 대기. 디자인 완료 후 E2E 스크린샷 비교용.

---

## 규칙
- 새 파일 만들지 않음
- styles.css 하나만 수정 (메인)
- 컴포넌트는 CSS 클래스 변경 최소화
- 핵심 3탭만 신경씀
- 동결 기능 CSS는 건드리지 않음 (어차피 안 보임)
