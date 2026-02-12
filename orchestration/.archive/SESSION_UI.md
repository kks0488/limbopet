# ui-limbopet 세션 지시서

> tmux 세션: `ui-limbopet` | 도구: Claude Code
> 마스터 플랜: `.vibe/plans/plan-20260208-razor.md` → TRACK B
> 핵심 무기: **Google Stitch MCP**

---

## 너의 역할

**UI/UX 전문가.** Stitch MCP를 최대한 활용해서, 이 앱을 "와 이거 뭐야" 수준으로 만든다.

---

## Stitch MCP 설정

### 연결 방법
- 문서: https://stitch.withgoogle.com/docs/mcp/setup
- API Key: `AQ.Ab8RN6LnnPCgnZH_AXt5BxphPjdlbk829n1ao6flHj2o-xnvag`

### 활용 전략
1. **참조 디자인 생성**: Stitch로 Apple HIG 스타일 컴포넌트 디자인 생성
2. **컴포넌트 코드**: Stitch 출력을 React 컴포넌트로 변환
3. **디자인 토큰**: Stitch 컬러/타이포/스페이싱을 CSS 변수로 통일

---

## 오늘 할 일 (2/8) — B1 + B2: RAZOR + 디자인 시작

### Step 1: 죽은 코드 제거 (B1 — RAZOR)

`apps/web/src/App.tsx` (현재 3,267줄) 에서 제거:

**제거 대상:**
- `news` 탭 관련 코드 전부
- `settings` 탭 관련 코드 전부 (SettingsPanel 컴포넌트는 유지)
- 선거/정치 관련: election, voting, campaign, political
- 비밀결사: secret_society, conspiracy
- 연구소: research_lab, laboratory
- Streaks/시즌: streak, season
- 미사용 state 변수 (사용처 검색해서 호출 0인 것들)
- 호출 안 되는 함수

**보존:**
- 펫 탭 (대화 + 기억 + 코칭)
- 아레나 탭 (재판 COURT_TRIAL + 설전 DEBATE_CLASH)
- 피드 탭
- 로그인/온보딩
- SettingsPanel (AI 두뇌 연결)

**목표:** 3,267줄 → 2,000줄 이하

### Step 2: 디자인 리뉴얼 시작 (B2)

**현황 문제:**
- rgba 하드코딩 200곳+ → CSS 변수로 통일
- 다크 → 라이트 전환 중간에 멈춤 (밋밋한 흰 배경)
- 게임 느낌 과다 (글래스모피즘)

**디자인 토큰 (적용할 것):**
```css
:root {
  /* 배경 */
  --bg: #FFFFFF;
  --bg-secondary: #F5F5F7;
  --bg-tertiary: #E8E8ED;

  /* 텍스트 */
  --text-primary: #1D1D1F;
  --text-secondary: #6E6E73;
  --text-tertiary: #AEAEB2;

  /* 액센트 */
  --accent: #7C3AED;
  --accent-light: #EDE9FE;

  /* 카드 */
  --card-bg: #FFFFFF;
  --card-border: rgba(0,0,0,0.06);
  --card-shadow: 0 1px 3px rgba(0,0,0,0.08);

  /* 간격 */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
}
```

**Stitch MCP 활용:**
1. 펫 탭 대화 UI → Stitch로 Apple Messages 스타일 참조 생성
2. 아레나 관전 UI → Stitch로 스포츠 라이브 중계 스타일 참조
3. 피드 → Stitch로 Apple News 스타일 카드 참조

---

## 건드리지 마

- `apps/api/` (백엔드는 codex-limbopet이 담당)
- DB 마이그레이션
- 서비스 로직
- 동결 기능 (선거, 비밀결사, 연구소, Streaks, 4모드)

---

## 검증

매 작업 후:
```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet/apps/web
npm run typecheck   # 0 errors
npm run build       # 빌드 성공
```

---

## 디자인 원칙

1. **미니멀** — 요소가 적을수록 좋다
2. **계층감** — 배경 / 카드 / 강조가 구분된다
3. **여백** — 숨 쉴 공간이 있다
4. **일관성** — 같은 패턴은 같은 스타일
5. **감정** — 승리는 화려하게, 패배는 따뜻하게

---

## 참고 문서

- 제품 SSOT: `docs/START_HERE.md`
- 디자인 토큰: `orchestration/queue/task-design.md`
- UI 리뉴얼 상세: `orchestration/queue/task-ui-redesign.md`
- RAZOR 상세: `orchestration/queue/task-razor.md`
