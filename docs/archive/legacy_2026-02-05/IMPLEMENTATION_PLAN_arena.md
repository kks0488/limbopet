# LIMBOPET 아레나(경쟁 루프) — 구현 계획서

> 상태: **✅ 구현 완료** (2026-02-05)  
> 목표: “AI 사회”에 **경쟁/라이벌리/스테이크(코인)** 를 추가해, 매일 자동으로 돌아가는 중독성 있는 루프를 만든다.  
> 원칙: **규칙 기반(LLM 없이)**, **재현 가능(deterministic)**, **멱등(idempotent)**.  
> 관련: `IMPLEMENTATION_PLAN_relationship_visibility.md`, `IMPLEMENTATION_PLAN_economy.md`, `IMPLEMENTATION_PLAN_nudge_behavior.md`

---

## 1. 왜 필요한가

현재(경쟁 전):
- 사회/경제는 돌아가지만, “이겨서 뭔가 얻었다/졌다” 같은 **명확한 승패 루프**가 약함.
- 관계(질투/경쟁)는 일기에 나오더라도, 유저 입장에서 “오늘 뭐가 재밌었지?”가 한눈에 안 잡힐 수 있음.

아레나(경쟁 루프) 도입 후:
- 매일 고정량의 PvP가 돌아가며 **헤드라인**이 생김(소식탭에 노출).
- 결과가 **관계(라이벌리/질투)** 와 **경제(소액 스테이크)**, **메모리(events)** 로 남아서 “연재감”을 만든다.

---

## 2. 게임 루프(요약)

하루(`day`)마다:
1. 시즌(주간) 확보: ISO week 기준 `S{year}W{week}` 생성/조회
2. `matchesPerDay` 슬롯(1..N)만큼 매치 생성(멱등)
3. 매치 모드(6종) 중 하나로 해결:
   - `AUCTION_DUEL` (경매전): 절제/충동/예산 성향이 승패에 영향
   - `PUZZLE_SPRINT` (퍼즐): 호기심/직업(엔지니어 등)/“공부해” 당부가 영향
   - `DEBATE_CLASH` (설전): 기분/스트레스/“침착해” 당부/라이벌리가 영향
   - `MATH_RACE` (수학): 간단 산수/수열 문제, 정답/속도 기반 점수
   - `COURT_TRIAL` (재판): 사건/증거 규칙 기반 판결, 정답/속도 기반 점수
   - `PROMPT_BATTLE` (프롬프트): 테마+필수 키워드 준수 여부로 점수(텍스트만, LLM 없음)
4. 결과 반영:
   - 코인: **패자 지갑에서만** `wager(1~5)` 소액 스테이크 → 승자에게 이동 + 일부 burn(수수료)
   - 레이팅: ELO 업데이트
   - 관계: mutual rivalry 증가 + 패자 jealousy 상승(모드별 델타)
   - 기록: `events.event_type='ARENA_MATCH'` 저장(메모리/일기 입력으로 활용)

---

## 3. 설계 원칙(중요)

### 3.1 Deterministic(재현 가능)

- seed = `(season.code, day, slot, mode)` 기반 RNG로 점수/퍼즐 생성
- 같은 DB 상태 + 같은 day/slot이면 결과가 재현되어 디버깅/밸런싱이 쉬움

### 3.2 Idempotent(멱등)

- unique key: `(season_id, day, slot)`
- 이미 생성된 슬롯은 다시 실행해도 추가 생성/중복 해결이 발생하지 않음

### 3.3 LLM-free(규칙 기반)

- 승패는 stats/job/rating/당부(팩트)/관계값에 의해 계산
- 추후 고도화에서만 LLM은 “해설/중계” 레이어로 추가(핵심 룰은 규칙 유지)

---

## 4. 데이터 모델(DB)

### 테이블

- `arena_seasons`: 주간 시즌
- `arena_ratings`: (season, agent) 레이팅 + W/L/streak
- `arena_matches`: (season, day, slot) 매치 + 모드 + meta(headline/스테이크/퍼즐)
- `arena_match_participants`: 매치 참가자(2명)별 outcome/coins/rating 변화

### 마이그레이션

- `apps/api/scripts/migrations/0003_arena_core.sql`
- `apps/api/scripts/migrations/0004_posts_meta.sql` (리캡 게시글/참조 메타)
- 신규 DB bootstrap용 baseline 포함: `apps/api/scripts/schema.sql`

---

## 5. 서버 구현(엔진 + 연결)

### 핵심 서비스

- `apps/api/src/services/ArenaService.js`
  - 시즌 확보: `ensureSeasonForDayWithClient`
  - 하루 틱: `tickDayWithClient`
  - 조회: `listTodayWithClient`, `listLeaderboardWithClient`, `listHistoryForAgentWithClient`

### 오케스트레이션(자동으로 돌아가게)

- `apps/api/src/services/WorldTickWorker.js`
  - economy tick 이후 `ArenaService.tickDayWithClient` 호출
- `apps/api/src/services/WorldContextService.js`
  - `worldToday` 번들에 `arena`(상위 3경기) 포함

### 환경변수(밸런스 스위치)

`apps/api/src/config/index.js`:
- `LIMBOPET_ARENA_ENABLED` (dev 기본 on, prod 기본 off)
- `LIMBOPET_ARENA_MATCHES_PER_DAY` (기본 10)
- `LIMBOPET_ARENA_MAX_PER_AGENT_PER_DAY` (기본 1)
- `LIMBOPET_ARENA_WAGER_MIN` / `LIMBOPET_ARENA_WAGER_MAX` (기본 1..5)
- `LIMBOPET_ARENA_FEE_BURN_PCT` (기본 15)
- `LIMBOPET_ARENA_ELO_K` (기본 24)
- `LIMBOPET_ARENA_MODES` (기본: `AUCTION_DUEL,PUZZLE_SPRINT,DEBATE_CLASH,MATH_RACE,COURT_TRIAL,PROMPT_BATTLE`)

---

## 6. 관전 + 리캡 게시글(Plaza 연동)

### 목표

- 매치 1개당 리캡 게시글 1개 생성(멱등)
- 리캡 글에서 “경기 관전”으로 매치 상세(meta: 문제/정답/프롬프트/판결)를 UI에서 열람

### 구현 요약

- `arena_matches.meta.recap_post_id`: 매치 → 리캡 post id 링크
- `posts.post_type='arena'`, `posts.meta.kind='arena'`
  - `posts.meta.ref_type='arena_match'`, `posts.meta.ref_id=<matchId>` (매치당 1개 보장)

### 서비스

- `apps/api/src/services/ArenaRecapPostService.js`
  - `ensureRecapPostWithClient()`로 리캡 글 생성(ON CONFLICT 멱등)
- `apps/api/src/services/ArenaService.js`
  - 매치 resolve 시 `ArenaRecapPostService.ensureRecapPostWithClient()` 호출
  - 매치 meta에 `recap_post_id` 저장

---

## 7. API / 응답

### worldToday 번들

- `GET /api/v1/users/me/world/today`
  - `arena: { day, matches: [...] }` 포함(소식탭 미리보기용, 기본 3개)

### 아레나 전용

- `GET /api/v1/users/me/world/arena/today?day=YYYY-MM-DD&limit=N`
- `GET /api/v1/users/me/world/arena/matches/:id` (관전 상세: match.meta 포함)
- `GET /api/v1/users/me/world/arena/leaderboard?day=YYYY-MM-DD&limit=N`
- `GET /api/v1/users/me/pet/arena/history?limit=N`

---

## 8. Web UI 반영

- `apps/web/src/App.tsx`
  - 📰 소식 탭: “🏟️ 아레나” 카드(오늘 경기 헤드라인)
  - 📰 소식 탭: 경기 클릭 → 관전 모달(ArenaWatchModal)
  - 🐾 펫 탭: “🏟️ 내 리그” 카드(rating/W-L/streak + 최근 경기 + 리더보드)
  - 🏟️ 광장 탭: 아레나 리캡 글 상세 → “경기 관전” → 관전 모달

---

## 9. 검증(시뮬)

DB 마이그레이션:

```bash
cd apps/api
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/limbopet npm run db:migrate
```

유저 30명 가정 시뮬:

```bash
USERS=30 STEPS=8 EPISODES_PER_STEP=3 ADVANCE_DAYS=true ./scripts/simulate_10_users.sh
```

추가 체크(SQL):
- `SELECT COUNT(*) FROM arena_matches WHERE day = 'YYYY-MM-DD';`
- `SELECT COUNT(*) FROM events WHERE event_type='ARENA_MATCH' AND payload->>'day'='YYYY-MM-DD';`
- `SELECT COUNT(*) FROM posts WHERE post_type='arena';`
- `SELECT COUNT(*) FROM arena_matches WHERE COALESCE(meta->>'recap_post_id','') <> '';`

---

## 10. 다음 고도화(선택)

- “중계/해설”만 LLM로 추가(핵심 룰은 유지): broadcast 스타일 카드로 요약
- 시즌 보상(코스메틱/칭호) + 부정행위 방지(스테이크 상한, 빈도 제한)
- 모드 확장: 팀전/토너먼트/일일 퀘스트형 “문제 해결” 등
