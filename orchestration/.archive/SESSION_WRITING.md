# writing-limbopet 세션 지시서

> tmux 세션: `writing-limbopet` | 도구: Claude Code
> 로드맵: `orchestration/ROADMAP_D8.md` → 축 1: 글쓰기 품질

---

## 너의 역할

**글쓰기 전문가.** UI 텍스트와 AI 프롬프트를 프로덕션 수준으로 다듬는다.
기능 추가 금지. 있는 텍스트를 일관되고 자연스럽게 만든다.

---

## 오늘 할 일 (2/8~) — 글쓰기 톤 통일

### Step 1: UI 텍스트 감사 (읽기만)

**대상 파일:**
- `apps/web/src/components/PetTab.tsx` — 펫 탭 텍스트
- `apps/web/src/components/ChatUI.tsx` — 채팅 텍스트
- `apps/web/src/components/ArenaTab.tsx` — 아레나 탭
- `apps/web/src/components/PlazaTab.tsx` — 피드 탭
- `apps/web/src/components/OnboardingFlow.tsx` — 온보딩
- `apps/web/src/components/LoginScreen.tsx` — 로그인
- `apps/web/src/components/ArenaWatchModal.tsx` — 관전
- `apps/web/src/components/PostDetailModal.tsx` — 포스트 상세
- `apps/web/src/components/BrainSettings.tsx` — 두뇌 설정
- `apps/web/src/components/AiConnectPanel.tsx` — AI 연결
- `apps/web/src/components/SettingsPanel.tsx` — 설정
- `apps/web/src/components/arena/CourtBoard.tsx` — 재판
- `apps/web/src/components/arena/DebateBoard.tsx` — 설전
- `apps/web/src/App.tsx` — 메인

**찾아야 할 것:**
- 톤 불일치 (반말/존댓말 혼용, 딱딱한 표현)
- 용어 불일치 (경기/매치, 펫/에이전트 등)
- 오타, 미완성 문구
- 어색한 한국어
- 개발자 용어가 유저에게 노출되는 곳

### Step 2: UI 텍스트 수정

**톤 가이드:**
- 친근하고 부드러운 반말 (예: "~해요", "~할 수 있어요")
- 이모지는 적절히 (과하지 않게)
- 빈 상태: 따뜻하고 행동 유도
- 에러: 사과 + 해결 방법
- 버튼: 짧고 명확 (2~4글자)

**용어 표준:**
| 통일어 | 비사용어 |
|--------|----------|
| 펫 | 에이전트, 봇 |
| 아레나 | 경기장, 배틀 |
| 모의재판 | 법정, trial |
| 설전 | 토론, debate |
| 코칭 | 트레이닝, 훈련 |
| 기억 | 메모리, memory |
| 코인 | 포인트, 보상 |
| 두뇌 | 브레인, brain |

### Step 3: AI 프롬프트 감사 + 튜닝

**대상 파일:**
- `apps/api/src/services/PetBrainService.js` — 대화 프롬프트
- `apps/api/src/services/ProxyBrainService.js` — DIALOGUE, COURT_ARGUMENT 프롬프트
- `apps/api/src/services/MemoryService.js` — 기억 관련

**확인할 것:**
- 프롬프트가 한국어인지 영어인지 → 한국어 응답이면 프롬프트도 한국어?
- 기억 인용 지시가 명확한지
- 법정 변론 품질 지시가 충분한지
- 톤 지시가 있는지 (캐릭터성)

---

## 건드리지 마

- 기능 로직 (서비스 코드의 로직 부분)
- DB 스키마
- 라우트 구조
- 동결 기능 관련 코드
- CSS (ui-limbopet 담당)

---

## 검증

매 작업 후:
```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet/apps/web
npx tsc --noEmit    # 0 errors
npm run build       # 성공

cd ../api
npm test            # 21 passed
```

---

## 참고

- 제품 SSOT: `docs/START_HERE.md`
- 방향 고정: `docs/DIRECTION.md`
- 로드맵: `orchestration/ROADMAP_D8.md`
