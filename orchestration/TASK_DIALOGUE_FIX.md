# TASK: DIALOGUE 품질 개선 -- 쓰레기 대화 근절

> **작성**: v-analyst (2026-02-08)
> **실행**: cx-main (Codex, 백엔드)
> **긴급도**: HIGH -- 데모 D-8, 핵심 루프(대화)가 망가져 있음

---

## 현재 문제 진단

사용자가 "gd"라고 입력했는데 펫이 아래처럼 응답:
- "화해로 분위기 살렸던 거 기억나" -- weekly_memory에서 온 무관한 인용
- "광장에선 선거 얘기 많던데" -- 동결 기능(선거)이 world_context를 통해 유입
- "coaching심심할 때 다음 할 일을..." -- coaching fact가 memory_refs.text로 그대로 노출

**근본 원인**: DIALOGUE job의 input 조립 과정에서 **5가지 오염원**이 LLM 프롬프트에 필터링 없이 주입되고 있음.

---

## 오염원 분석 (5가지)

### 오염원 1: coaching 데이터가 memory_refs에 raw 텍스트로 유입

**파일**: `apps/api/src/services/PetStateService.js:651-665`

```js
const MEMORY_REF_KINDS = new Set(['coaching', 'preference', 'forbidden', 'suggestion', 'direction']);
const memoryRefsFromFacts = (factRows || [])
  .map((f) => {
    // ...
    const text = safeText(v?.text ?? v?.summary ?? v?.value ?? key, 220);
    // ...
    return { kind, key, text, confidence };
  })
```

**문제**: `coaching` kind의 fact를 memory_refs에 포함하는데, coaching fact의 value.text는 `BrainJobService.js:68-102`의 `extractCoachingHintFromText()`가 추출한 원본 텍스트다. 이것은 "재판에서 공감 표현을 많이 써줘" 같은 **지시(instruction)**이지, 대화에서 인용할 **기억(memory)**이 아니다.

LLM 시스템 프롬프트(`ProxyBrainService.js:282-284`)는 memory_refs를 "'지난번에 네가 ...라고 했잖아'" 형식으로 인용하라고 지시한다. 그래서 coaching 지시문이 대화체 인용으로 왜곡되어 나온다: "coaching심심할 때 다음 할 일을..."

**증거**: `PetStateService.js:660` -- `safeText(v?.text ?? v?.summary ?? v?.value ?? key, 220)` 에서 coaching fact의 value.text가 그대로 추출됨.

### 오염원 2: weekly_memory의 memory_5가 memory_refs에 무조건 2개 추가

**파일**: `apps/api/src/services/PetStateService.js:667-673`

```js
const memoryRefsFromWeekly = Array.isArray(weekly?.summary?.memory_5)
  ? weekly.summary.memory_5
      .map((line) => safeText(line, 220))
      .filter(Boolean)
      .slice(0, 2)
      .map((text, idx) => ({ kind: 'weekly_memory', key: `weekly_${idx + 1}`, text, confidence: 1.0 }))
  : [];
```

**문제**: `memory_5`는 `MemoryRollupService.js:153-159`에서 생성된 5줄 요약이다:
```js
const memory5 = [
  `${weekStartDay}~${weekEndDay} 한 주 요약.`,
  `대표 장면: ${highlights[0]}`,           // <-- "화해로 분위기 살렸던 거" 같은 내용
  `이번 주 키워드: ${highlights.slice(0, 3).join(' / ')}`,
  signalLine || '대화 코어/중력: (아직 없음)',
  lastTomorrow ? `다음 주 예고: ${lastTomorrow}` : '다음 주 예고: …'
];
```

이 5줄 중 첫 2줄이 memory_refs에 들어간다. "2026-02-03~2026-02-08 한 주 요약." 같은 **메타 설명**이 기억 인용 후보가 된다. LLM은 이걸 억지로 인용하려고 "화해로 분위기 살렸던 거 기억나" 같은 쓰레기를 만든다.

**또한**: `weekly_memory`는 별도로 `jobInput.weekly_memory`에도 전체가 들어간다 (PetStateService.js:708). 이중 주입.

### 오염원 3: 선거/정치 데이터가 world_context.civic_line으로 유입

**파일**: `apps/api/src/services/WorldContextService.js:913`

```js
const civicLine = await ElectionService.getCivicLine(d).catch(() => null);
```

`ElectionService.js:980-1056`의 `civicLineForDayWithClient()`는 선거 진행 상황을 텍스트로 만든다:
- "시장 선거: 후보 등록 접수 중! (D-3)"
- "시장 선거 결과: 김XX(12) / 박XX(8)"

이게 `worldContext.civic_line`으로 DIALOGUE job input에 들어가고 (PetStateService.js:709), LLM user 메시지의 `world_context` 필드로 전달된다. 선거는 **동결 기능**인데 데이터가 프롬프트에 흘러간다.

**추가 경로**: `worldContext.world_daily`가 ShowrunnerService가 생성한 세계 요약을 포함하며, 이 안에 civicLine, 정책 변경, 경제 지표 등이 들어있다.

### 오염원 4: recent_events에 무관한 이벤트가 필터링 없이 10개 유입

**파일**: `apps/api/src/services/PetStateService.js:620-627`

```js
const { rows: recentEventRows } = await client.query(
  `SELECT event_type, payload, created_at
   FROM events
   WHERE agent_id = $1
   ORDER BY created_at DESC
   LIMIT 10`,
  [agentId]
);
```

**문제**: 모든 event_type을 무조건 10개 가져온다. 여기에 포함될 수 있는 타입:
- `SOLO_EVENT` -- "혼자 광장을 슬쩍 둘러봤다" (자동 생성, 의미 없음)
- `AUTO_FEED`, `AUTO_SLEEP`, `AUTO_REST` -- 자동 돌봄 (의미 없음)
- `FEED`, `PLAY`, `SLEEP` -- 기본 액션 (대화 맥락과 무관)
- `TALK` -- 이전 대화 (이건 유용할 수 있음)
- `SPENDING`, `SPENDING_FAILED` -- 경제 이벤트 (대화와 무관)
- `ARENA_MATCH` -- 아레나 결과 (유용할 수 있음)
- `DIALOGUE` -- 이전 대화 결과 (유용)

**무관한 이벤트가 대부분**을 차지하여 LLM이 "혼자 광장을 슬쩍 둘러봤다" 같은 자동 이벤트를 대화 소재로 삼는다.

### 오염원 5: facts 배열이 프로필/코칭/direction 등을 무차별 포함

**파일**: `apps/api/src/services/PetStateService.js:561-568`

```js
const { rows: factRows } = await client.query(
  `SELECT kind, key, value, confidence
   FROM facts
   WHERE agent_id = $1
   ORDER BY confidence DESC, updated_at DESC
   LIMIT 20`,
  [agentId]
);
```

**문제**: `facts` 테이블에는 profile, coaching, preference, forbidden, suggestion, direction, streak, arena 등 다양한 kind가 있다. 20개를 무차별로 가져오면:
- `arena` fact (debate:matchId 키) -- 이전 아레나 변론 내용
- `streak` fact (limbo_checkin) -- 체크인 연속 일수
- `direction` fact -- stage direction (24h TTL, 이미 별도 처리됨)

이들이 LLM 프롬프트의 facts 필드로 들어가면 대화 품질을 오염시킨다.

---

## 수정 지시서 (cx-main 실행)

### FIX-1: coaching을 memory_refs에서 제거 (PetStateService.js)

**파일**: `apps/api/src/services/PetStateService.js:651`

**변경 전**:
```js
const MEMORY_REF_KINDS = new Set(['coaching', 'preference', 'forbidden', 'suggestion', 'direction']);
```

**변경 후**:
```js
const MEMORY_REF_KINDS = new Set(['preference', 'forbidden', 'suggestion']);
```

**이유**:
- `coaching`은 지시(instruction)이지 기억(memory)이 아님. LLM이 인용하면 "coaching심심할 때..." 같은 쓰레기 발생.
- `direction`은 이미 `stage_direction`으로 별도 처리됨 (PetStateService.js:597-618). memory_refs에 이중 포함 불필요.
- coaching 효과는 `coach_effect` 필드로 이미 추적됨 (BrainJobService.js:592-599).

### FIX-2: weekly_memory의 memory_5를 memory_refs에서 제거 (PetStateService.js)

**파일**: `apps/api/src/services/PetStateService.js:667-673`

**변경 전**:
```js
const memoryRefsFromWeekly = Array.isArray(weekly?.summary?.memory_5)
  ? weekly.summary.memory_5
      .map((line) => safeText(line, 220))
      .filter(Boolean)
      .slice(0, 2)
      .map((text, idx) => ({ kind: 'weekly_memory', key: `weekly_${idx + 1}`, text, confidence: 1.0 }))
  : [];
```

**변경 후**:
```js
const memoryRefsFromWeekly = [];
```

**이유**:
- weekly_memory는 이미 `jobInput.weekly_memory`로 전체 요약이 전달됨 (PetStateService.js:708).
- memory_5의 1-2번째 줄은 "한 주 요약.", "대표 장면: ..." 같은 메타 설명으로, 인용 대상이 아님.
- LLM 시스템 프롬프트에 "weekly_memory가 있으면 1줄 정도로만 은근히 이어서 '연재감'을 준다"라는 별도 지시가 있음 (ProxyBrainService.js:290). memory_refs에 넣으면 이중 인용 강제.

### FIX-3: world_context에서 civic_line 제거 (PetStateService.js 또는 WorldContextService.js)

**방법 A (권장)**: DIALOGUE job input 조립 시 world_context에서 civic_line과 동결 기능 관련 데이터 제거

**파일**: `apps/api/src/services/PetStateService.js:709`

**변경 전**:
```js
world_context: worldContext
```

**변경 후**:
```js
world_context: worldContext ? {
  day: worldContext.day ?? null,
  world_concept: worldContext.world_concept ?? null,
  open_rumors: worldContext.open_rumors ?? []
} : null
```

**이유**:
- `civic_line`은 선거 관련 (동결 기능). DIALOGUE에 불필요.
- `world_daily`는 ShowrunnerService가 생성한 세계 요약인데, 정치/경제 데이터 포함. 이미 `world_concept` (PetStateService.js:692-694)로 theme/atmosphere만 추출해서 별도 전달 중.
- 전체 worldContext를 그대로 넣으면 토큰 낭비 + LLM이 선거 데이터를 대화에 끌어옴.

**방법 B (보수적)**: WorldContextService.getCompactBundle()에서 civic_line을 null로 반환
- 영향 범위가 넓어서 (다른 job type도 사용) 비추.

### FIX-4: recent_events 필터링 (PetStateService.js)

**파일**: `apps/api/src/services/PetStateService.js:620-627`

**변경 전**:
```js
const { rows: recentEventRows } = await client.query(
  `SELECT event_type, payload, created_at
   FROM events
   WHERE agent_id = $1
   ORDER BY created_at DESC
   LIMIT 10`,
  [agentId]
);
```

**변경 후**:
```js
const { rows: recentEventRows } = await client.query(
  `SELECT event_type, payload, created_at
   FROM events
   WHERE agent_id = $1
     AND event_type IN ('DIALOGUE', 'TALK', 'ARENA_MATCH', 'RELATIONSHIP_MILESTONE')
   ORDER BY created_at DESC
   LIMIT 6`,
  [agentId]
);
```

**이유**:
- `DIALOGUE`: 이전 대화 내용 -- 대화 연속성에 필수
- `TALK`: 사용자 액션 기록 -- 맥락 유지
- `ARENA_MATCH`: 경기 결과 -- 코어 루프(법정)와 관련
- `RELATIONSHIP_MILESTONE`: 관계 변화 -- 대화 소재로 적절
- 나머지 (`SOLO_EVENT`, `AUTO_FEED`, `FEED`, `PLAY`, `SLEEP`, `SPENDING` 등)는 대화 맥락과 무관한 노이즈.

### FIX-5: facts 필터링 (PetStateService.js)

**파일**: `apps/api/src/services/PetStateService.js:561-568`

**변경 전**:
```js
const { rows: factRows } = await client.query(
  `SELECT kind, key, value, confidence
   FROM facts
   WHERE agent_id = $1
   ORDER BY confidence DESC, updated_at DESC
   LIMIT 20`,
  [agentId]
);
```

**변경 후**:
```js
const { rows: factRows } = await client.query(
  `SELECT kind, key, value, confidence
   FROM facts
   WHERE agent_id = $1
     AND kind IN ('profile', 'preference', 'forbidden', 'suggestion', 'coaching')
   ORDER BY confidence DESC, updated_at DESC
   LIMIT 12`,
  [agentId]
);
```

**이유**:
- `profile`: 성격/MBTI/회사/역할 -- persona 구성에 필수
- `preference`/`forbidden`/`suggestion`: 사용자 넛지 -- 대화 톤 조절
- `coaching`: 훈련 지시 -- facts에는 남기되 memory_refs에서는 제거 (FIX-1과 연동)
- 제외: `streak` (체크인 숫자, 무의미), `arena` (변론 내용, 너무 김), `direction` (별도 처리됨), `relationship` (별도 처리됨), `world`/`world_worker` (세계 데이터, 대화 무관)

---

## LLM 프롬프트 개선 (선택, 효과 큼)

### FIX-6: ProxyBrainService.js의 DIALOGUE 시스템 프롬프트 개선

**파일**: `apps/api/src/services/ProxyBrainService.js:256-313`

현재 user 메시지에 facts, recent_events, weekly_memory가 전부 JSON으로 들어가는데, "gd" 같은 짧은 인사에 대해 이 모든 컨텍스트를 활용하라고 강제하는 것이 문제.

**추가할 시스템 프롬프트 규칙** (ProxyBrainService.js의 DIALOGUE 분기, system 변수에 추가):

```
## 짧은 인사/감탄사 처리
유저 메시지가 5자 이하(예: "gd", "ㅋ", "오", "히")이면:
- memory_refs, weekly_memory, facts를 인용하지 않는다.
- 짧고 자연스러운 인사/리액션만 한다 (1~2줄).
- 절대로 과거 기억이나 세계관 정보를 끌어오지 않는다.
```

**동일 수정 필요**: `UserByokLlmService.js:85-109`의 DIALOGUE 분기에도 동일 규칙 추가.

### FIX-7: ProxyBrainService.js user 메시지에서 world_context 제거

**파일**: `apps/api/src/services/ProxyBrainService.js:298-313`

현재 user JSON에 `recent_events`, `weekly_memory`, `facts`가 들어가지만 `world_context`는 빠져 있다. 그러나 FIX-3에서 `jobInput.world_context`를 정리하지 않으면 LLM이 input 전체를 볼 수 있는 경우(일부 모델)에 여전히 선거 데이터를 참조할 수 있다.

**확인**: ProxyBrainService.js:298-313의 user JSON에는 이미 `world_context`가 포함되지 않음. 하지만 UserByokLlmService.js:110-132의 user JSON에도 포함되지 않음. 이 부분은 안전.

다만, `weekly_memory` 필드(PetStateService.js:708)를 통해 weekly summary 전체가 들어가는데, 여기에 세계 이벤트(정치/경제)가 녹아있을 수 있다. FIX-2로 memory_refs 이중 주입은 막았지만, weekly_memory 자체를 제거하는 것은 과도하다 (연재감 유지 목적).

---

## 수정 우선순위

| 순서 | Fix | 파일 | 영향도 | 난이도 |
|------|-----|------|--------|--------|
| 1 | FIX-1 | PetStateService.js:651 | HIGH (coaching 쓰레기 제거) | 1줄 |
| 2 | FIX-2 | PetStateService.js:667-673 | HIGH (weekly 이중 주입 제거) | 1줄 |
| 3 | FIX-3 | PetStateService.js:709 | HIGH (선거 데이터 차단) | 5줄 |
| 4 | FIX-4 | PetStateService.js:620-627 | MEDIUM (노이즈 이벤트 제거) | 3줄 |
| 5 | FIX-5 | PetStateService.js:561-568 | MEDIUM (불필요 facts 제거) | 2줄 |
| 6 | FIX-6 | ProxyBrainService.js + UserByokLlmService.js | HIGH (짧은 인사 처리) | 4줄 |

**모든 수정은 `apps/api/src/services/PetStateService.js` 에 집중 (FIX-1~5)**
**FIX-6은 `ProxyBrainService.js`와 `UserByokLlmService.js`**

---

## 검증 방법

수정 후 아래 시나리오로 테스트:

1. **짧은 인사**: "gd", "ㅋ", "오" -> 1-2줄 간단 인사, 기억 인용 없음
2. **일상 질문**: "점심 뭐 먹을까" -> 구체적 추천, 선거/정치 언급 없음
3. **훈련 지시**: "재판에서 공감 표현 많이 써줘" -> 확인 + 계획, memory_hint 채워짐
4. **기억 인용 확인**: preference/forbidden이 있는 상태에서 관련 대화 -> 자연스러운 인용

DB에서 직접 확인:
```sql
-- 최근 DIALOGUE job의 input 확인
SELECT id, input->'memory_refs' AS refs,
       input->'world_context' AS wc,
       input->'recent_events' AS events
FROM brain_jobs
WHERE job_type = 'DIALOGUE'
ORDER BY created_at DESC
LIMIT 3;
```

---

## 요약

| 오염원 | 증상 | Fix |
|--------|------|-----|
| coaching in memory_refs | "coaching심심할 때..." | FIX-1 |
| weekly_memory in memory_refs | "화해로 분위기 살렸던 거 기억나" | FIX-2 |
| civic_line in world_context | "광장에선 선거 얘기 많던데" | FIX-3 |
| 무차별 recent_events | 자동 이벤트가 대화 소재 | FIX-4 |
| 무차별 facts | arena/streak 데이터 오염 | FIX-5 |
| 짧은 인사에 풀 컨텍스트 | 1글자에 기억+세계관 강제 | FIX-6 |
