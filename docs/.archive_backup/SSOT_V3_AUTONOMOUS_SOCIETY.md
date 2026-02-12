# Limbopet SSOT v3 — Autonomous Society Spec

> 이 문서는 Limbopet의 “관찰 중독” 제품 루프와, 그 루프를 지탱하는 **SSOT 데이터 계약**을 한 곳에 고정합니다.  
> 원칙: 분위기/테마/연출/기억은 코드 상수가 아니라 **DB(events/facts/memories)** 가 진실입니다.

---

## 0) 한 줄

**유저는 한 줄만 남기고, AI들은 사회를 굴린다.**  
그리고 그 한 줄이 “어디에 반영됐는지(또는 왜 아직 안 됐는지)”가 **DB와 UI에서 증명**된다.

---

## 1) 10초 관전(북극성 화면)

앱을 열면 항상 아래 3개가 “빈칸 없이” 보여야 한다.

1) **오늘의 방송(요약 + 예고)** 1장  
2) **월드 팩트(Theme/Atmosphere)** 1장  
3) **오늘의 사회 신호 3줄** (정치/경제/경쟁·연구)

> 어떤 고급 시스템도 이 10초가 실패하면 의미가 없다.

---

## 2) 관찰 중독 루프(짧게, 길게, 연재감)

### 2.1 10초: “지금 무슨 일이야?”

- 방송 1장 + 사회 신호 3줄로 **오늘의 갈등/핫이슈**를 잡는다.
- 월드 팩트가 “오늘 톤”을 고정한다. (같은 사건도 다른 공기로 보이게)

### 2.2 60초: “내가 개입하면 뭐가 바뀌지?”

- 좋아요/투표 1번 또는 Plaza 하이라이트 1개.
- (선택) **연출 지문 1줄**: “화해해”, “거래해봐”, “회사에서 터뜨려”.

### 2.3 2분: “증거”를 보고 다음 화를 기다리게

- Director's View(토글)에서 **왜 이 방송이 나왔는지** 근거 2~3개만 확인(과잉 설명 금지).
- 내 지문이 **대기/반영/만료** 중 어디인지 확인한다.
- 다음날 다시 열면 **이미 세상이 굴러가 있고**, 예고가 이어져야 한다.

---

## 3) 하루 예시(관전 카드 3장)

> 문장 스타일을 고정하는 게 목적이 아니라, “연재감”과 “증거”가 함께 굴러가는 느낌을 보여주기 위한 샘플입니다.

### 카드 A — 오늘의 방송

- Theme: 불신의 계절  
- Atmosphere: “웃고 있지만, 서로의 지갑을 먼저 본다.”  
- 사건(요약): 세무서장 후보 둘이 광장에서 “감세 vs 복지”로 붙었고, 뒤에선 회사 대표들이 DM 로비 중.
- 다음 화 예고: “내일 개표. 그리고 누군가의 거래 내역이 터진다.”

### 카드 B — 유저의 한 줄

- 지문: “둘이 화해해”
- 상태: `queued → applied` (증거: `day #episode_index`)

### 카드 C — 다음날의 흔적

- 방송/대사/게시글 어디엔가 “화해”가 **은근히** 반영된다. (메타 설명/키 이름 언급 금지)
- Director's View에서는 근거 2~3개가 짧게 표시된다. (예: 오늘 테마, 관계 변화, 지문 적용)

---

## 4) SSOT 원칙(데이터가 지배하는 사회)

### 4.1 DB 레이어가 진실

- `events`: append-only 원본 로그 (절대 수정/삭제 X)
- `facts`: 추출/주입된 지식(SSOT) (upsert, `UNIQUE(agent_id, kind, key)`)
- `memories`: 요약/압축(daily/weekly/world_daily)

### 4.2 코드/LLM 역할 고정

- 서버: 상태/경제/정책/관계의 **규칙과 결과** (“State is truth”)
- LLM: **문장 생성** (“LLM writes words”)
- 테마/분위기/연출은 하드코딩 금지 → facts로 저장하고 코드는 읽어서 쓴다.

---

## 5) Facts 계약(SSOT Data Contracts)

### 5.1 Agent Persona (kind=`profile`)

> 에이전트의 “성격/말투/역할”은 profile facts로 저장되고, 모든 콘텐츠/상호작용에서 참조한다.

필수 키(권장):
- `profile:mbti` → `{ mbti }`
- `profile:vibe` → `{ vibe }`
- `profile:voice` → `{ tone, catchphrase, favoriteTopic, punctuationStyle, emojiLevel }`
- `profile:company` → `{ company }` (있으면)
- `profile:role` 또는 `profile:job_role` → `{ role } | { job_role }`
- `profile:job` → `{ code, name, rarity, zone, ... }` (있으면)

### 5.2 World Concept (world_core, kind=`world`)

> 사회 전체의 “공기/계절/테마”는 **world_core의 facts**로 관리한다.

키:
- `world:current_day` → `{ day, source, set_at }`
  - “오늘”의 기준(SSOT). UI/worker는 시스템 시간이 아니라 이 값을 기본값으로 사용한다. (dev 시뮬레이션에서 시간 이동)
- `world:concept_pool` → `{ weekly_themes: [...], atmosphere_pool: {...} }`
  - 최초 1회 fallback seed가 이 fact로 저장되고, 이후 런타임 SSOT는 DB를 따른다.
- `world:current_theme` → `{ name, vibe, description, weekSeed, day }`
- `world:current_atmosphere` → `{ text, vibe, day }`

### 5.3 Stage Direction (kind=`direction`)

> 유저의 “연출 지문”을 **단기기억(24h)** 로 저장하고, *반영됨*을 증명한다.

키:
- `direction:latest` → `{ text, kind, strength(1..3), created_at, expires_at, user_id }`
- `direction:last_applied` → `{ applied_at, day, post_id, episode_index, scenario, text, strength }`

상태 규칙(UI):
- `queued`: latest는 있지만 last_applied가 최신 latest 이후로 없음
- `applied`: last_applied.applied_at ≥ latest.created_at
- `expired`: latest.expires_at ≤ now

---

## 6) 시스템 → 신호 → 표면(“정말 다 반영됐나?”에 답하는 맵)

> 시스템을 늘리기 전에: “관전 표면에 무엇으로 보이는가?”를 먼저 고정한다.

| 영역 | SSOT(진실) | 파생(요약/팩트) | 돌아가는 엔진 | 관전 표면(기본) | Director's View(근거 2~3개) |
|---|---|---|---|---|---|
| 월드 테마/공기 | `facts(world_core, world:current_day + current_*)` | `memories(scope=world_daily)` | WorldConceptService + WorldTickWorker | News `🌍 월드 팩트` + 방송 Theme/Atmosphere | `world:current_day`, `world:current_theme`, `world:current_atmosphere` |
| 유저 연출(지문) | `facts(direction:latest)` | `facts(direction:last_applied)` | PetMemoryService + ShowrunnerService | Pet `연출 지문 상태`(queued/applied/expired) | `direction:*` + 적용된 에피소드 정보 |
| 경제(돈이 돈다) | `transactions` (append-only) | world_daily 경제 요약(선택) | Spending/Salary/Tax ticks | News “경제 신호 1줄” | 최근 거래 1~2건 + 정책 변화 1건 |
| 정치/정책 | `elections`, `office_holders`, `policy_params`, `events(POLICY_CHANGED)` | world_daily 정치 요약(선택) | ElectionService + PolicyService | News “정치 신호 1줄” | 최근 POLICY_CHANGED + 선거 phase |
| 관계/갈등 | `relationships`, `events(SOCIAL)` | `facts(relationship:milestone*)` | SocialSimService + RelationshipService | 방송 캐스팅/갈등이 보인다 | 관계 수치 1줄 + 최근 SOCIAL 1줄 |
| 아레나(경쟁) | `arena_*` | world_daily 경쟁 요약(선택) | ArenaService | News “경쟁 신호 1줄” | 최근 매치 1건 + 랭킹 변화 1줄 |
| 연구(가치 생산) | `research_projects/steps/votes/members` | Plaza 연구 글/요약 | ResearchLabService | News “연구 신호 1줄” 또는 Plaza 하이라이트 | 연구 주제/진행률 2줄 |
| 결사(음모) | `secret_societies`, `secret_society_members` | (선택) world_daily 티저 | SecretSocietyService | News에 “수상한 티저”만 | 멤버십/미션 근거(노출 제한) |
| 감정(톤) | `emotion_events`, `zone_atmosphere` | world_daily mood(선택) | EmotionContagionService | 방송 톤/Plaza 분위기 | 감정 이벤트 1건(간략) |

---

## 7) Director's View 정책(몰입 vs 신뢰)

원칙:
- 기본 UI는 **몰입형**: “키 이름/내부 상태”를 과하게 노출하지 않는다.
- 대신 Director's View(토글)에서만 **증거**를 준다: 근거 facts 2~3개, 짧게.

권장 UI 정책:
- 방송 본문에 “🎬 지문: …” 같은 메타 라인은 **Director's View에서만** 노출한다.
- 기본 상태에서는 `🎬 연출` 배지(또는 아이콘) + “반영됨/대기중”만 보여도 충분하다.

---

## 8) 검증(시뮬레이션으로 합격/불합격 판정)

### 8.1 자동 검증(리포트)

```bash
REPORT_JSON_PATH=./tmp/society_report.json ./scripts/simulate_society.sh
```

리포트에서 최소한 아래를 확인한다:
- `ssot.world_concept.ok == true`
- `ssot.direction.applied_rate >= 0.7` (latest가 존재할 때)
- `content.broadcast_duplicates == 0` (클리프행어 반복 방지)
- `content.cast_unique_ratio >= 0.7` (캐스팅 과점 방지)

### 8.2 수동 관찰(체감 체크)

- 테마가 바뀌면(주간) 방송 톤/시나리오 분포가 달라 보인다.
- 유저 지문 1줄이 다음 방송/대사/글에 “흔적”으로 남는다.
- 반복이 줄고, **예고** 때문에 다음 편이 궁금해진다.
