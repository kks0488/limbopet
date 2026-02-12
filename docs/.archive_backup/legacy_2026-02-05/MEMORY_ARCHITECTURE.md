# LIMBOPET 메모리 아키텍처 & AI 메모리 생태계 레퍼런스

작성일: 2026-02-04
목적: AI 메모리 구조를 이해하고, 외부 오픈소스와 비교하여 개선 방향을 잡기 위한 개발자 레퍼런스

---

## 목차

1. [현재 메모리 구조](#1-현재-메모리-구조)
2. [테이블 스키마](#2-테이블-스키마)
3. [메모리 흐름](#3-메모리-흐름)
4. [Brain Job 시스템](#4-brain-job-시스템)
5. [검색 및 활용 패턴](#5-검색-및-활용-패턴)
6. [vendor/memU 관계](#6-vendormemu-관계)
7. [현재 구조 평가](#7-현재-구조-평가)
8. [오픈소스 AI 메모리 생태계](#8-오픈소스-ai-메모리-생태계)
9. [개선 로드맵](#9-개선-로드맵)
10. [핵심 파일 맵](#10-핵심-파일-맵)

---

## 1. 현재 메모리 구조

LIMBOPET은 **3계층 메모리**를 PostgreSQL만으로 운영한다. Vector DB/Embedding 없음.

```
┌──────────────────────────────────────────┐
│  Layer 1: events  (append-only 원본 로그) │
│  - 모든 행동/대화/사건의 블랙박스          │
│  - salience_score로 중요도 표시           │
├──────────────────────────────────────────┤
│  Layer 2: facts  (추출된 지식)            │
│  - preference / forbidden / suggestion   │
│  - 유저 넛지로 직접 주입 가능              │
│  - confidence 점수로 신뢰도 관리           │
├──────────────────────────────────────────┤
│  Layer 3: memories  (요약/압축)           │
│  - daily: "림보룸" (하루 요약)            │
│  - weekly: 주간 요약                      │
│  - world_daily: 세계 전체 요약            │
└──────────────────────────────────────────┘
```

**설계 원칙:**
- events는 절대 삭제/수정하지 않음 (append-only)
- facts는 upsert (`UNIQUE(agent_id, kind, key)`)
- memories는 날짜+scope 단위로 덮어쓰기

---

## 2. 테이블 스키마

> Source: `apps/api/scripts/schema.sql`

### 2.1 events (line 226)

```sql
CREATE TABLE events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type     VARCHAR(32) NOT NULL,   -- DIALOGUE | DIARY_POST | SOCIAL | ...
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  salience_score INTEGER NOT NULL DEFAULT 0,  -- 0~10
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_events_agent_created ON events(agent_id, created_at DESC);
CREATE INDEX idx_events_agent_type_created ON events(agent_id, event_type, created_at DESC);
```

### 2.2 facts (line 239)

```sql
CREATE TABLE facts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind            VARCHAR(24) NOT NULL,   -- preference | forbidden | suggestion | profile | streak
  key             VARCHAR(64) NOT NULL,
  value           JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  confidence      REAL NOT NULL DEFAULT 1.0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, kind, key)
);

CREATE INDEX idx_facts_agent_kind ON facts(agent_id, kind);
```

**kind 분류:**

| kind | 의미 | 예시 |
|------|------|------|
| `preference` | 좋아하는 것 | `로맨스`, `카페` |
| `forbidden` | 싫어하는 것 | `싸움`, `야근` |
| `suggestion` | 유저 힌트 | `화해하기` |
| `profile` | 프로필 정보 | `성격: 내향적` |
| `streak` | 출석/연속 기록 | `연속출석: 5일` |

### 2.3 memories (line 255)

```sql
CREATE TABLE memories (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scope      VARCHAR(16) NOT NULL,   -- daily | weekly | world_daily
  day        DATE,
  summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, scope, day)
);

CREATE INDEX idx_memories_agent_scope_day ON memories(agent_id, scope, day DESC);
```

---

## 3. 메모리 흐름

```
[유저 행동 / AI 상호작용]
          │
          ▼
  ┌─────────────────┐
  │ 1. event 기록    │  append-only, salience_score 부여
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │ 2. Brain Job    │  DAILY_SUMMARY / DIARY_POST 등 생성
  │    생성 (비동기)  │
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │ 3. 로컬 Brain   │  유저 두뇌(키/계정)로 LLM 처리
  │    LLM 분석      │  events + facts 읽고 요약
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │ 4. memory 저장   │  "림보룸" (scope=daily)
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │ 5. facts 추출    │  LLM이 발견한 새 선호도/패턴
  └─────────────────┘
```

---

## 4. Brain Job 시스템

API 서버(Node.js)가 Job을 생성하고, 로컬 Brain(Python)이 polling으로 가져가 LLM 호출 후 결과를 제출한다.

```
  API Server (Node.js)              Local Brain (Python)
  ┌──────────────────┐              ┌──────────────────┐
  │ Job 생성 + input  │──── poll ──→│ Job 가져오기       │
  │ DB에서 대기       │              │ LLM 호출          │
  │ Side-effect 처리  │←── submit ──│ Result 제출        │
  └──────────────────┘              └──────────────────┘
```

### Job Types

| Job Type | 입력 | 출력 | 메모리 효과 |
|----------|------|------|-------------|
| `DIALOGUE` | 대화 컨텍스트 + facts | 대화 응답 | events에 기록 |
| `DIARY_POST` | 오늘의 경험 | 일기 글 | posts + events |
| `DAILY_SUMMARY` | events + facts | 요약 + 새 facts | memories + facts 업데이트 |
| `RESEARCH_*` | 연구 주제 | 연구 결과 | 연구소 시스템 업데이트 |

> Source: `apps/api/src/services/BrainJobService.js`, `apps/brain/limbopet_brain/runner.py`

---

## 5. 검색 및 활용 패턴

### 5.1 검색 (SQL 기반, 시맨틱 검색 없음)

```sql
-- 오늘 사건 가져오기
SELECT event_type, payload, salience_score, created_at
FROM events
WHERE agent_id = $1
  AND (
    ((payload ? 'day') AND (payload->>'day') = $2::text)
    OR (NOT (payload ? 'day') AND created_at::date = $2::date)
  )
ORDER BY created_at ASC LIMIT 200;

-- 넛지(선호도) 가져오기
SELECT kind, key, value
FROM facts
WHERE agent_id = $1 AND kind IN ('preference','forbidden','suggestion')
ORDER BY updated_at DESC LIMIT 50;

-- 하루 요약 가져오기
SELECT summary FROM memories
WHERE agent_id = $1 AND scope = 'daily' AND day = $2;
```

> Source: `apps/api/src/services/PetMemoryService.js:90-230`

### 5.2 활용 패턴

**패턴 A: Brain Job에 메모리 주입**

```javascript
const input = {
  kind: 'daily_summary',
  day: '2026-02-04',
  stats: { mood: 75, stress: 30 },  // 현재 상태
  facts: [...],                      // 선호도/금기사항
  events: [...]                      // 오늘의 사건들
};
```

**패턴 B: 소셜 시뮬레이션에 넛지 반영**

```javascript
// SocialSimService.js
const nudges = await loadNudgeMap(client, [agentId]);
applyNudgeBiasToWeights(scenarioWeights, nudges);
// "로맨스" preference → ROMANCE 시나리오 가중치 ↑
// "싸움" forbidden   → BEEF 시나리오 가중치 ↓
```

**패턴 C: 세계 컨텍스트 번들**

```javascript
// WorldContextService.js
const bundle = {
  day: '2026-02-04',
  episode: { /* 오늘의 방송 */ },
  worldDaily: { /* 세계 요약 */ },
  civicLine: '시장 선거 D-7'
};
```

---

## 6. vendor/memU 관계

| 항목 | 현황 |
|------|------|
| 위치 | `vendor/memU/` |
| 사용 여부 | **미사용** (참조용으로만 존재) |
| memU 특징 | pgvector 기반 시맨틱 검색, 계층적 자동 분류, OpenAI embedding 필수 |

### LIMBOPET vs memU 비교

| 측면 | LIMBOPET (현재) | memU |
|------|----------------|------|
| 저장소 | PostgreSQL (JSONB) | PostgreSQL + pgvector |
| 검색 | SQL 필터링 (시간순) | 시맨틱 유사도 검색 |
| 메모리 분류 | 수동 (kind 컬럼) | 자동 (LLM + 카테고리) |
| 비용 | 0원 (embedding 없음) | embedding API 비용 발생 |
| 복잡도 | 낮음 | 높음 |
| 적합 단계 | MVP / 소규모 | 장기 운영 / 대규모 |

**현재 판단:** AI 사회 시뮬레이션 MVP에서는 시간순 로그 + facts 관리로 충분. 스케일 이후 재검토.

---

## 7. 현재 구조 평가

### 강점

- **단순함**: PostgreSQL만으로 완결, 추가 인프라 불필요
- **비용 0원**: embedding API 없이 동작, 유저가 연결한 **펫 두뇌**로 LLM 비용도 서버 부담 아님
- **명확한 계층**: events(원본) → facts(지식) → memories(요약), 역할 분리 깔끔
- **유저 개입**: 넛지로 AI 행동에 직접 영향, "내 AI를 내가 조종"

### 약점

- **시맨틱 검색 불가**: "비슷한 과거 사건" 찾기 어려움, 키워드/날짜 필터만 가능
- **스케일링**: events가 append-only로 무한 증가, 파티셔닝/아카이빙 전략 없음
- **자동 학습 제한**: facts 추출은 단순 upsert, 패턴 발견이나 지식 그래프 없음
- **중복/모순 미해결**: 같은 사실 중복 기록 가능, 모순 정보 해소 메커니즘 없음

---

## 8. 오픈소스 AI 메모리 생태계

2025~2026년 기준 주요 프로젝트 정리. LIMBOPET 개선 시 참고용.

### 8.1 Tier 1: 메이저 프로젝트

#### Mem0

- **GitHub**: https://github.com/mem0ai/mem0
- **핵심**: Universal memory layer for AI Agents
- **방식**: 대화에서 salient information을 자동 추출/통합/검색
- **성능**: 기존 대비 26% 향상 (LLM-as-a-Judge), 91% 낮은 p95 레이턴시, 90%+ 토큰 절감
- **기본 LLM**: `gpt-4.1-nano`
- **라이선스**: Apache 2.0
- **LIMBOPET 적용 가능성**: facts 자동 추출 파이프라인 참고, 메모리 통합(consolidation) 로직

#### Letta (구 MemGPT)

- **GitHub**: https://github.com/letta-ai/letta
- **핵심**: OS 영감의 메모리 계층 — core memory(즉시 접근) + archival memory(검색 필요)
- **특징**: 에이전트가 자기 메모리를 스스로 관리, 고정 context window 내에서 무제한 메모리
- **벤치마크**: LoCoMo 74.0% (GPT-4o mini)
- **LIMBOPET 적용 가능성**: 자가 관리 메모리 패턴, core/archival 분리 개념

#### MemOS

- **GitHub**: https://github.com/MemTensor/MemOS
- **핵심**: Memory Operating System — LLM/Agent용 메모리 OS
- **특징**: 멀티모달 메모리(이미지/차트), Tool memory(에이전트 계획용), MCP 지원
- **버전**: v2.0 "Stardust" (2025.12)
- **LIMBOPET 적용 가능성**: Tool memory로 에이전트 행동 패턴 학습

#### LangMem (LangChain)

- **GitHub**: https://github.com/langchain-ai/langmem
- **핵심**: LangGraph 네이티브 장기 메모리 SDK
- **메모리 타입**:
  - Semantic: 핵심 사실 저장
  - Episodic: 과거 상호작용 경험
  - Procedural: 작업 수행 방법 (프롬프트 자동 업데이트)
- **LIMBOPET 적용 가능성**: Semantic/Episodic/Procedural 분류 체계 참고

### 8.2 Tier 2: 주목할 프로젝트

| 프로젝트 | GitHub | 핵심 |
|----------|--------|------|
| **OpenMemory** | https://github.com/CaviraOSS/OpenMemory | 로컬 persistent memory, Hierarchical Memory Decomposition, Claude Desktop/Copilot 지원 |
| **SimpleMem** | https://github.com/aiming-lab/SimpleMem | 시맨틱 무손실 압축, 최소 토큰(~550)으로 F1 43.24% 달성 (2026.01 arXiv) |
| **Zep + Graphiti** | https://github.com/getzep/zep | 시간 인식 Knowledge Graph, Fact 추출, 시간 흐름에 따른 지식 변화 추적 |
| **Cognee** | https://github.com/topoteretes/cognee | 메모리 + 지식 관리 파이프라인, 데이터 enrichment/structuring |

### 8.3 Tier 3: 리서치 & 벤치마크

| 프로젝트 | GitHub | 용도 |
|----------|--------|------|
| **Agent-Memory-Paper-List** | https://github.com/Shichun-Liu/Agent-Memory-Paper-List | AI 에이전트 메모리 서베이 논문 모음 (HuggingFace Daily #1, 2025.12) |
| **Awesome-Agent-Memory** | https://github.com/TeleAI-UAGI/Awesome-Agent-Memory | 시스템/벤치마크/논문 큐레이션 |
| **MemoryAgentBench** | https://github.com/HUST-AI-HYZ/MemoryAgentBench | ICLR 2026 메모리 평가 벤치마크 |

### 8.4 생태계 비교 매트릭스

| 기능 | LIMBOPET | Mem0 | Letta | MemOS | LangMem |
|------|----------|------|-------|-------|---------|
| 시맨틱 검색 | - | O | O | O | O |
| 자동 추출 | 제한적 | O | O | O | O |
| 메모리 자가관리 | - | - | O | - | - |
| 멀티모달 | - | - | - | O | - |
| Knowledge Graph | - | O (graph variant) | - | - | - |
| Procedural Memory | - | - | - | O | O |
| 유저 직접 개입 (넛지) | O | - | - | - | - |
| 두뇌(유저 키/계정, 비용 0원) | O | - | - | - | - |
| 복잡도 | 낮음 | 중간 | 높음 | 높음 | 중간 |

---

## 9. 개선 로드맵

### Phase A: 현재 구조 최적화 (변경 최소)

#### 구현 상태 (2026-02-04)

- ✅ **A-1 confidence 점수 활용**: 반복 관찰(같은 value 재등장) 시 `facts.confidence`가 점진 증가(최대 2.0). 대화/일기 입력 facts는 `confidence DESC, updated_at DESC`로 주입, 사회 시뮬레이터의 넛지 가중치에도 반영.
- ✅ **A-3 memories scope 확장(weekly)**: `weekly` 요약을 *새 Brain Job 없이* 기존 `daily` 요약들을 롤업해서 생성/갱신. LimboRoom 응답에 포함(주간 하이라이트/흐름/중력).
- ⏳ **A-2 events 파티셔닝**: DB 마이그레이션 성격이 강하므로 운영 단계에서 적용(유저 증가/데이터 증가 시점에 재검토).

**A-1. confidence 점수 활용**

현재 `facts.confidence`가 항상 1.0. 반복 관찰 시 증가시키면 중요한 facts를 우선 참조 가능.

```sql
UPDATE facts SET confidence = LEAST(confidence + 0.1, 2.0), updated_at = NOW()
WHERE agent_id = $1 AND kind = $2 AND key = $3;
```

**A-2. events 파티셔닝**

append-only events가 무한 증가하므로 월별 파티션 도입.

```sql
CREATE TABLE events (
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_02 PARTITION OF events
FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

**A-3. memories scope 확장**

현재 `daily`만 적극 사용. `weekly`, `monthly` 요약을 추가하면 장기 맥락 유지 가능.

### Phase B: 시맨틱 검색 도입

**B-1. pgvector 확장**

PostgreSQL에 pgvector 추가하여 facts/events에 embedding 컬럼 부착.

```sql
CREATE EXTENSION vector;

ALTER TABLE facts ADD COLUMN embedding vector(1536);
CREATE INDEX idx_facts_embedding ON facts
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

**B-2. 유사 사건 검색**

```sql
-- "과거에 비슷한 일이 있었나?"
SELECT key, kind, confidence
FROM facts
WHERE agent_id = $1
ORDER BY embedding <=> $2  -- cosine similarity
LIMIT 10;
```

**B-3. embedding 생성 시점**

- Brain Job 결과 제출 시 → facts에 embedding 같이 저장
- 두뇌 LLM에 embedding API 지원 여부에 따라 분기 필요

### Phase C: 외부 메모리 시스템 통합 (선택)

| 옵션 | 장점 | 단점 | 적합 시점 |
|------|------|------|-----------|
| vendor/memU 활성화 | 이미 코드 있음, 계층적 분류 | embedding 비용, 복잡도 증가 | 유저 1000+ |
| Mem0 통합 | 검증된 성능, 커뮤니티 | 외부 의존성 | 메모리 품질이 병목일 때 |
| Zep/Graphiti | Knowledge Graph | 인프라 추가 | 관계 기반 검색 필요 시 |
| SimpleMem 참고 | 토큰 절감 | 아직 초기 | 두뇌 비용 최적화 필요 시 |

---

## 10. 핵심 파일 맵

```
apps/api/src/services/
├── PetMemoryService.js      ← facts/memories CRUD, 넛지 upsert
├── BrainJobService.js       ← 비동기 Brain Job 생성/처리
├── WorldContextService.js   ← 세계 컨텍스트 번들 조립
├── SocialSimService.js      ← 넛지 기반 시나리오 가중치 결정
└── ShowrunnerService.js     ← 방송 카드 생성 (메모리 활용)

apps/brain/limbopet_brain/
├── client.py                ← API 통신
├── runner.py                ← Job polling 루프
└── generators/
    ├── openai_gen.py        ← OpenAI LLM 호출
    ├── anthropic_gen.py     ← Anthropic LLM 호출
    └── google_gen.py        ← Google LLM 호출

apps/api/scripts/
└── schema.sql               ← 메모리 테이블 정의
    ├── events    (line 226)
    ├── facts     (line 239)
    └── memories  (line 255)

vendor/memU/                  ← 참조용 (현재 미사용)
```
