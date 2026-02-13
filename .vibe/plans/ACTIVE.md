# limbopet 수정계획 -- D-2 (2/16 데모)

> Updated: 2026-02-14 (세션 4)
> 데모 준비도: **~99%**
> TypeScript: 0 에러 | 백엔드 npm test: 31/31 | E2E 시뮬레이션: 7/7 PASS
> 남은 작업: P1-3~5 (프롬프트 튜닝) + 데모 데이터 준비 + 리허설

---

## 2/13~14 세션 4: 종합 리뷰 + 시뮬레이션 + 핫픽스

### 커밋 3건
| 커밋 | 내용 | 파일 |
|------|------|------|
| `5198640` | P0/P1/P2 리뷰 이슈 15건 수정 | 26파일 |
| `663bf3c` | talk 500 해결 + safeCatch + 개선 6건 | 13파일 |
| `bb4b747` | 마이그레이션 러너 + 아레나 화이트리스트 | 5파일 |

### 핵심 수정
- **talk 500 해결**: migration 0016 미적용 + `.catch(() => null)` TX 훼손 → safeCatch SAVEPOINT 패턴
- **마이그레이션 자동 실행**: 서버 시작 시 `scripts/migrate.js` 자동 실행
- **아레나 모드 화이트리스트**: COURT_TRIAL/DEBATE_CLASH만 허용, 나머지 400
- **API 안정성**: UUID검증, parseBool, max_tokens, regex, VoteService import
- **E2E 시뮬레이션 7/7 PASS** 확인

---

## 남은 작업 (D-2)

| ID | 작업 | 담당 | 상태 |
|----|------|------|------|
| P1-3 | 재판 프롬프트 튜닝 | codex | TODO |
| P1-4 | AI 판결 비교 정교화 | codex | TODO |
| P1-5 | 관전 해설 검증 | codex | TODO |
| D-1 | Brain worker 기동 확인 | codex | TODO |
| D-2 | 데모 데이터 준비 (펫 2마리+대화+아레나) | codex | TODO |
| D-3 | 데모 리허설 dry run | 수동 | TODO |

---

## 완료된 작업 전체

### 2/9 세션 1: UI 강화 + 버그 수정 + 리뷰

| 티켓 | 내용 | 상태 |
|------|------|------|
| 7-1 | PetStage 96px PixelPet 대화 화면 상단 배치 | DONE |
| 7-2 | 펫 리액션 (thinkingPulse, memoryCitedGlow, sparkle) | DONE |
| 7-3 | 기억 카드 그룹 (다중 인용 카드, KIND_KO 한국어, 3장+오버플로) | DONE |
| 7-4 | Facts 기반 인사 ("치킨 좋아한다며!") | DONE |
| 7-5 | Stats 미니 카드 (레벨, XP바, 친밀, 기분, 호기심) | DONE |
| 7-6 | 성격 관찰 카드 (personality_observation 표시) | DONE |
| 7-7 | 아레나 결과 배너 (승/패, 상대 이름, 모드, X 해제) | DONE |
| 7-8 | 대화 힌트 버튼 (5회 미만일 때 표시) | DONE |

**버그 수정 (9건):**

| 항목 | 상세 | 위치 |
|------|------|------|
| chatHistory DESC 정렬 | `[0]`=최신, reverse로 표시 | `ChatUI.tsx:74`, `PetTab.tsx:89` |
| HIDDEN_REF_KINDS | 모듈 스코프로 이동 | `ChatUI.tsx:18` |
| 애니메이션 충돌 | opacity/brightness만, transform 제거 | `styles.css:6005-6012` |
| Sparkle 희석 | "okay" 제거, "bright"+forceSparkle만 | `PixelPet.tsx` |
| CSS 변수 6개 | --green→--system-green 등 | `styles.css` 전체 |
| loss vs lose | 양쪽 체크 | `PetStateService.js:669` |
| 기억 카드 truncation | nowrap→2줄 clamp | `styles.css:6203` |
| 인용 글로우 | brightness 1.6 + drop-shadow | `styles.css:6009-6012` |
| 배너 해제 | X 버튼 + dismissed state | `PetTab.tsx:97,118` |

### 2/9 세션 2: P0 + P1-1 + P2 클린업

| ID | 내용 | 상태 |
|----|------|------|
| P0-1 | 채팅 스켈레톤 shimmer (bouncing dots 교체) + 3초 후 3줄째 + 5초 후 extra msg | **DONE** |
| P1-1 | 채팅 에러 시 메시지 복원 (`setChatText(msg)` in catch) | **DONE** |
| P2-1 | 힌트 버튼 threshold 3→5 | **DONE** |
| P2-4 | `memorySlideIn`→`slideInUp` 이름 정리 (4곳+keyframe) | **DONE** |
| P2-5 | `--system-orange` 인라인 폴백 전부 제거 (5곳) | **DONE** |

### 2/9 세션 3: P1-2 + P2-2 + P2-3 + 버그 수정

| ID | 내용 | 상태 |
|----|------|------|
| P1-2 | 모바일 세로 공간 최적화 — compact mode (3+msg: 펫 48px, stats/personality 숨김) | **DONE** |
| P2-2 | 펫 탭 반응 — 클릭 시 바운스 + 랜덤 말풍선 ("냥?", "왜~?" 등 6종) | **DONE** |
| P2-3 | 백그라운드 새로고침 인디케이터 — 2px accent 프로그레스 바 | **DONE** |
| BUG | React hooks 위반 수정 — useState/useRef를 함수 최상단으로 이동 | **DONE** |
| BUG | tapTimerRef plain object → useRef (타이머 누수 수정) | **DONE** |
| BUG | PET_TAP_LINES 모듈 스코프로 이동 (렌더당 재할당 제거) | **DONE** |
| BUG | petTapBubble CSS 센터링 (compact 모드 오정렬 수정) | **DONE** |

### 리뷰 결과 (4세션 동시 리뷰, 모두 통과)

| 파일 | 리뷰어 | 판정 |
|------|--------|------|
| `.vibe/reviews/result-final-backend.md` | cx-main | PASS (npm test 28/28) |
| `.vibe/reviews/result-final-frontend.md` | v-critic | APPROVED |
| `.vibe/reviews/result-final-ux.md` | v-analyst | 75%→92% |
| `.vibe/reviews/result-final-integration.md` | v-analyst | ALL CLEAR (5/5 계약) |

---

## 알아야 할 것들

### chatHistory 정렬 규칙
- **API**: `getTimeline()` → `ORDER BY created_at DESC` → index 0 = 최신
- **ChatUI**: `reversed = chatHistory.reverse()` → 오래된 것이 위, 최신이 아래
- **PetTab**: `chatHistory[0]`로 최신 메시지의 mood/memory_cited 확인
- **latestPetIdx**: `for (i=0; ...)` 전방 탐색 = 최신 펫 응답 인덱스 찾기

### CSS 변수 체계
- `:root` 정의: `styles.css:1-100` 부근
- 사용 가능: `--accent`, `--system-green`, `--system-orange`, `--bg-secondary`, `--label`, `--label-secondary`, `--separator`, `--card-bg`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill`
- 사용 금지 (미정의): `--green`, `--orange`, `--fill-tertiary`, `--fill-quaternary`, `--label-primary`, `--radius`

### 스켈레톤 재사용 패턴
- 클래스: `.skeletonLine`, `.skeletonWide`, `.skeletonMedium`, `.skeletonShort`, `.skeletonBlock`
- 정의: `styles.css:3776-3798`
- 사용처: ArenaTab, PostDetailModal, ArenaWatchModal, **ChatUI (P0-1)**

### 오보 정정: chatBubbleNew
- `idx === reversed.length - 1`은 **최신 메시지**가 맞음 (reversed 배열의 마지막)
- UX 리뷰어가 "가장 오래된 메시지"라고 오판한 것. 코드가 정확함.

---

## P3 -- 데모 후 (지금 건드리지 말 것)

| ID | 작업 | 위치 |
|----|------|------|
| P3-1 | Dead typeof branch | `PetTab.tsx:101` |
| P3-2 | 미사용 props (profileBadges, petAdvanced, chatOpen) | `PetTab.tsx:17-47` |
| P3-3 | `facts: any[]` 타입 부채 | PetTab/ChatUI/App |
| P3-4 | GreetingMessage facts 지연 로딩 | `ChatUI.tsx:183-225` |
| P3-5 | autoFocus 모바일 키보드 | `ChatUI.tsx:167` |
| P3-6 | 토스트 PetHeader 겹침 | `styles.css:1022` |
| P3-7 | 스탯 컬러 코딩 | `PetTab.tsx` |
| P3-8 | 성격 카드 길이 제한 | `PetTab.tsx:150-154` |
| P3-9 | profile.voice fact 밀림 | `PetStateService.js:561-567` |
| P3-10 | facts/memory_refs 토큰 중복 | `PetStateService.js:561-698` |
| P3-11 | Anti-spam 메시지 유실 | `PetStateService.js:530-557` |
| P3-12 | 다크 모드 | `styles.css` 전체 |

---

## 타임라인

```
2/9  (D-7): ✅ Tier1+Tier2 구현, 4세션 리뷰, P0-1/P1-1/P2 완료
2/10 (D-6): P1-2 모바일 최적화 [cl-ui] / P1-3 재판 프롬프트 [cx-main]
2/11 (D-5): P2-2 펫 탭 반응 [cl-ui] / P1-4,P1-5 [cx-main]
2/12 (D-4): P2-3 리프레시 인디케이터 [cl-ui] / D1 시드 데이터 [cx-main]
2/13 (D-3): 데모 리허설 #1 [둘 다]
2/14 (D-2): 핫픽스 + 비상 대응 준비
2/15 (D-1): 데모 리허설 #2 → 코드 프리징
2/16 (D-0): 데모
```

## 데모 시나리오 (10분)

| ACT | 시간 | 내용 | 관객 반응 목표 |
|-----|------|------|---------------|
| 0 | 30초 | 앱 오픈 → 96px 펫 둥실 + 기억 기반 인사 | "어? 기억하네?" |
| 1 | 3분 | 대화 → 스켈레톤 → 기억 카드 인용 → sparkle | "2일 전 거까지?" |
| 2 | 4분 | 아레나 탭 → 모의재판 → 3라운드 → 판결 | "재밌다" |
| 3 | 2분 | 펫탭 복귀 → 결과 배너 → 코칭 인용 | "루프로 돌아가네" |
| 4 | 30초 | 스탯 + 성격 카드 → 클로징 | "펫이 나를 안다" |

> **팁:** 데모 전 3-5회 대화로 facts 축적. "치킨", "김치찌개" 등 구체적 키워드.

---

## 금지 사항

- 새 기능, 새 서비스, 새 DB 테이블 추가 금지
- 동결 기능 (정치/비밀결사/연구소/4모드 아레나 등) 수정 금지
- 리팩토링 자체가 목적인 작업 금지
- "나중에 좋겠다"를 지금 만들기 금지
