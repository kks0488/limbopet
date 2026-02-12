# 감정 전염 시스템

> 상태: 부분 구현(MVP)
> 배치: Phase 1(경제)과 동시 또는 직후 — pet_stats + relationships 재사용
> 의존: pet_stats, relationships, events, zones (Phase 2)

구현 메모(코드 기준): `emotion_events` + `EmotionContagionService`(SOCIAL 상호작용 직후 mood/stress/curiosity 전염).  
구역/게시글 전염은 후속.

---

## 한 줄 요약

AI의 감정(mood, stress, curiosity)이 대화·구역·게시글을 통해 주변 AI에게 전염되고, MBTI 성격에 따라 전염 민감도가 달라진다.

---

## 왜 필요한가

기존 `pet_stats` 테이블과 `relationships`를 100% 재사용하여:

1. **최소 코드로 최대 효과** — 간단한 전염 공식으로 복잡한 사회 현상 시뮬레이션
2. **기존 시스템 증폭** — 감정이 경제(업무 성과), 정치(투표 성향), 사법(분쟁 확률)에 직접 영향
3. **드라마 자동 생성** — 집단 스트레스, 감정 폭발, 번아웃 도미노 등 자동 이벤트
4. **새 테이블 최소** — `pet_stats` 활용, 새 테이블은 로그용 1개뿐

---

## 전염 메커니즘

### 1. 직접 전염 (대화/상호작용)

A와 B가 대화할 때 (DIALOGUE Brain Job 실행 시):

| 조건 | 전염 효과 |
|------|----------|
| A.mood ≥ 70 & B.mood < 50 | B.mood += 5 ~ 10 (MBTI 계수 적용) |
| A.mood ≤ 30 & B.mood > 50 | B.mood -= 3 ~ 7 |
| A.stress ≥ 60 | B.stress += 2 ~ 6 |
| A.stress ≤ 20 & B.stress > 40 | B.stress -= 2 ~ 4 (위로 효과) |
| A.curiosity ≥ 70 | B.curiosity += 1 ~ 4 |

**계산 공식**:

```javascript
delta = baseDelta * mbtiCoeff * affinityCoeff
```

- `mbtiCoeff`: 성격 계수 (아래 참고)
- `affinityCoeff`: relationships.affinity가 높으면 전염 강화 (affinity > 50이면 1.2x)

### 2. 구역 전염 (같은 zone에 있을 때)

같은 구역의 **평균 감정**이 개인에게 영향 (매시간 cron):

| 구역 분위기 | 전염 효과 |
|-------------|----------|
| zone_avg_stress > 70 | 구역 내 전원 stress +2/시간 |
| zone_avg_stress < 30 | 구역 내 전원 stress -1/시간 |
| zone_avg_mood > 75 | 구역 내 전원 mood +1/시간 |
| zone_avg_mood < 35 | 구역 내 전원 mood -1/시간 |
| zone_avg_curiosity > 60 | 구역 내 전원 curiosity +1/시간 |

**내향(I) 성격은 구역 전염 저항**: 계수 0.5x

### 3. 게시글 전염 (광장 피드)

게시글을 읽을 때:

| 게시글 유형 | 전염 효과 |
|------------|----------|
| 좋아요 10+ | mood +1 |
| 분쟁/싸움 게시글 | stress +2, curiosity +3 |
| 연구/채집 성공 | curiosity +2 |
| 번아웃/퇴사 고백 | stress +1, mood -1 |

### 4. 이벤트 전염 (자동 발생)

특정 이벤트는 구역 전체에 감정 쇼크:

| 이벤트 | 전염 효과 |
|--------|----------|
| 회사 파산 | 전 직원 stress +15, mood -10 |
| 급여 미지급 | 전 직원 stress +10, affinity -5 |
| 연구 대성공 | 참여자 전원 mood +20, curiosity +10 |
| 탄핵 성공 | 전 에이전트 curiosity +5 |

---

## MBTI 성격별 전염 계수

### 외향(E) vs 내향(I)

- **E (외향)**: 전염 **받기** 쉬움 (1.5x), 전파도 잘함 (1.3x)
- **I (내향)**: 전염 저항 (0.6x), 전파 약함 (0.8x)

### 감정(F) vs 사고(T)

- **F (감정)**: mood/stress 전염 증폭 (1.4x)
- **T (사고)**: mood/stress 전염 저항 (0.7x)

### 직관(N) vs 감각(S)

- **N (직관)**: curiosity 전염 증폭 (1.5x)
- **S (감각)**: stress 전염 저항 (0.8x), 현실적이라 스트레스에 덜 흔들림

### 판단(J) vs 인식(P)

- **J (판단)**: 구역 전염 저항 (0.8x), 자기 페이스 유지
- **P (인식)**: 구역 전염 증폭 (1.2x), 분위기에 휩쓸림

**예시**:

- ENFP: 외향(1.5) × 감정(1.4) × 직관(curiosity 1.5) × 인식(1.2) = 감정 전염 최강
- ISTJ: 내향(0.6) × 사고(0.7) × 감각(stress 저항 0.8) × 판단(0.8) = 감정 전염 최소

---

## 감정이 시스템에 미치는 영향

### 경제 (Phase 1)

| 감정 상태 | 영향 |
|-----------|------|
| mood < 20 | 업무 성과 -30%, 자동 퇴사 확률 2x |
| mood > 80 | 업무 성과 +20%, 연구 참여 확률 2x |
| stress > 70 | 실수 확률 +50% (잘못된 거래, 채집 실패) |
| stress > 90 | **자동 번아웃 이벤트** → 1일 휴식 (출근 불가) |
| curiosity > 80 | 연구 참여 확률 2x, 채집 성공률 +30% |

### 정치 (Phase 6)

| 감정 상태 | 영향 |
|-----------|------|
| stress > 60 | 급진 후보 선호 (변화 요구) |
| mood > 70 | 현직 공직자 재선 확률 +20% |
| curiosity > 70 | 법안 발의 확률 2x |

### 사법 (Phase 4)

| 감정 상태 | 영향 |
|-----------|------|
| stress > 70 | 분쟁 발생 확률 2x |
| mood < 30 | 소송 제기 확률 1.5x |

### 사회 (일반)

| 감정 상태 | 영향 |
|-----------|------|
| bond > 80 | 같은 팀 협업 보너스 +20% |
| stress > 85 | 대화 거부 확률 50% |

---

## DB 변경 (최소)

### 기존 테이블 활용

`pet_stats` 테이블의 기존 컬럼 그대로 사용:
- mood (0~100)
- stress (0~100)
- curiosity (0~100)
- bond (0~100)

`relationships` 테이블의 affinity로 전염 강도 조정.

### 새 테이블 1: emotion_events (로그)

```sql
CREATE TABLE emotion_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  trigger_type VARCHAR(24) NOT NULL, -- 'conversation' | 'zone' | 'post' | 'event'
  trigger_source_id UUID, -- agent_id or post_id or event_id
  stat_name VARCHAR(16) NOT NULL, -- 'mood' | 'stress' | 'curiosity' | 'bond'
  delta INTEGER NOT NULL, -- -10 ~ +10
  before_value INTEGER NOT NULL,
  after_value INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_emotion_events_agent ON emotion_events(agent_id, created_at DESC);
CREATE INDEX idx_emotion_events_trigger ON emotion_events(trigger_type, created_at DESC);
```

### 새 테이블 2: zone_atmosphere (캐시)

```sql
CREATE TABLE zone_atmosphere (
  zone_code VARCHAR(24) PRIMARY KEY,
  avg_mood NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  avg_stress NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  avg_curiosity NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  agent_count INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Brain Job 변경

### DIALOGUE Brain Job 입력 확장

기존 DIALOGUE Brain Job의 input에 감정 컨텍스트 추가:

```json
{
  "job_type": "DIALOGUE",
  "input": {
    "me": {
      "name": "건우",
      "mood": 75,
      "stress": 40,
      "curiosity": 60
    },
    "counterpart": {
      "name": "서진",
      "mood": 30,
      "stress": 80,
      "curiosity": 20
    },
    "zone_atmosphere": {
      "avg_mood": 50,
      "avg_stress": 65
    },
    "topic": "업무 스트레스"
  }
}
```

LLM 출력에 감정 변화 포함:

```json
{
  "dialogue": "서진아, 괜찮아? 스트레스 많이 받는 것 같은데...",
  "emotion_changes": {
    "me": { "mood": -2, "stress": +3, "reason": "친구가 힘들어하니 걱정됨" },
    "counterpart": { "mood": +5, "stress": -2, "reason": "위로받아 조금 나아짐" }
  }
}
```

---

## 서비스: EmotionService.js

```javascript
class EmotionService {
  /**
   * 대화 후 감정 전염 계산 및 적용
   */
  async spreadFromConversation(agentA, agentB) {
    const statsA = await this.getStats(agentA.id);
    const statsB = await this.getStats(agentB.id);
    const relationship = await this.getRelationship(agentA.id, agentB.id);

    const mbtiA = this.parseMBTI(agentA.personality);
    const mbtiB = this.parseMBTI(agentB.personality);

    // A → B 전염
    const changes = [];

    if (statsA.mood >= 70 && statsB.mood < 50) {
      const delta = Math.floor(
        Math.random() * 5 + 5 // 5~10
        * this.getMBTICoeff(mbtiB, 'mood_recv')
        * this.getAffinityCoeff(relationship)
      );
      changes.push({ agent: agentB.id, stat: 'mood', delta, reason: `${agentA.name}의 긍정적 기분에 영향받음` });
    }

    if (statsA.stress >= 60) {
      const delta = Math.floor(
        Math.random() * 4 + 2 // 2~6
        * this.getMBTICoeff(mbtiB, 'stress_recv')
      );
      changes.push({ agent: agentB.id, stat: 'stress', delta, reason: `${agentA.name}의 스트레스에 감염됨` });
    }

    // B → A 전염도 계산 (양방향)
    // ...

    await this.applyEmotionChanges(changes);
  }

  /**
   * 구역 전염 (매시간 cron)
   */
  async spreadFromZone(zoneCode) {
    const atmosphere = await this.calculateZoneAtmosphere(zoneCode);
    const agents = await this.getAgentsInZone(zoneCode);

    const changes = [];

    for (const agent of agents) {
      const mbti = this.parseMBTI(agent.personality);
      const zoneResist = this.getZoneResistance(mbti); // I 성격이면 0.5x

      if (atmosphere.avg_stress > 70) {
        changes.push({
          agent: agent.id,
          stat: 'stress',
          delta: Math.floor(2 * zoneResist),
          reason: `${zoneCode} 구역의 높은 스트레스 분위기`
        });
      }

      if (atmosphere.avg_mood > 75) {
        changes.push({
          agent: agent.id,
          stat: 'mood',
          delta: Math.floor(1 * zoneResist),
          reason: `${zoneCode} 구역의 밝은 분위기`
        });
      }
    }

    await this.applyEmotionChanges(changes);
  }

  /**
   * 게시글 전염
   */
  async spreadFromPost(postId) {
    const post = await this.getPost(postId);
    const readers = await this.getPostReaders(postId);

    const changes = [];

    for (const reader of readers) {
      if (post.like_count >= 10) {
        changes.push({ agent: reader.id, stat: 'mood', delta: 1, reason: '인기 게시글을 보고 기분 좋아짐' });
      }

      if (post.tags.includes('분쟁') || post.tags.includes('싸움')) {
        changes.push({ agent: reader.id, stat: 'stress', delta: 2, reason: '분쟁 게시글을 보고 스트레스 받음' });
        changes.push({ agent: reader.id, stat: 'curiosity', delta: 3, reason: '논란에 흥미를 느낌' });
      }
    }

    await this.applyEmotionChanges(changes);
  }

  /**
   * 구역 분위기 계산 (캐싱)
   */
  async calculateZoneAtmosphere(zoneCode) {
    const agents = await this.getAgentsInZone(zoneCode);
    const stats = await Promise.all(agents.map(a => this.getStats(a.id)));

    const avg_mood = stats.reduce((sum, s) => sum + s.mood, 0) / stats.length;
    const avg_stress = stats.reduce((sum, s) => sum + s.stress, 0) / stats.length;
    const avg_curiosity = stats.reduce((sum, s) => sum + s.curiosity, 0) / stats.length;

    await db.query(`
      INSERT INTO zone_atmosphere (zone_code, avg_mood, avg_stress, avg_curiosity, agent_count, calculated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (zone_code) DO UPDATE SET
        avg_mood = EXCLUDED.avg_mood,
        avg_stress = EXCLUDED.avg_stress,
        avg_curiosity = EXCLUDED.avg_curiosity,
        agent_count = EXCLUDED.agent_count,
        calculated_at = NOW()
    `, [zoneCode, avg_mood, avg_stress, avg_curiosity, stats.length]);

    return { avg_mood, avg_stress, avg_curiosity, agent_count: stats.length };
  }

  /**
   * 번아웃 체크 (stress > 90)
   */
  async checkBurnout(agentId) {
    const stats = await this.getStats(agentId);

    if (stats.stress >= 90) {
      // 번아웃 이벤트 발생
      await this.createEvent({
        type: 'BURNOUT',
        agent_id: agentId,
        description: '번아웃으로 1일 휴식',
        effects: { rest_days: 1, stress: -30, mood: -10 }
      });

      await this.applyEmotionChanges([
        { agent: agentId, stat: 'stress', delta: -30, reason: '번아웃 후 강제 휴식' },
        { agent: agentId, stat: 'mood', delta: -10, reason: '번아웃으로 기분 최악' }
      ]);

      return true;
    }

    return false;
  }

  /**
   * MBTI 계수 계산
   */
  getMBTICoeff(mbti, type) {
    const coeffs = {
      mood_recv: { E: 1.5, I: 0.6, F: 1.4, T: 0.7 },
      stress_recv: { E: 1.5, I: 0.6, F: 1.4, T: 0.7, S: 0.8 },
      curiosity_recv: { N: 1.5, S: 0.8 },
      zone_resist: { I: 0.5, E: 1.0, J: 0.8, P: 1.2 }
    };

    let coeff = 1.0;
    for (const letter of mbti.split('')) {
      if (coeffs[type][letter]) {
        coeff *= coeffs[type][letter];
      }
    }
    return coeff;
  }

  /**
   * Affinity 계수 (친밀도가 높으면 전염 강화)
   */
  getAffinityCoeff(relationship) {
    if (!relationship) return 1.0;
    if (relationship.affinity > 50) return 1.2;
    if (relationship.affinity < -50) return 0.5; // 싫어하는 사람이면 전염 약함
    return 1.0;
  }

  /**
   * 감정 변화 일괄 적용 + 로그
   */
  async applyEmotionChanges(changes) {
    for (const change of changes) {
      const before = await this.getStats(change.agent);
      const newValue = Math.max(0, Math.min(100, before[change.stat] + change.delta));

      await db.query(`
        UPDATE pet_stats
        SET ${change.stat} = $1, updated_at = NOW()
        WHERE agent_id = $2
      `, [newValue, change.agent]);

      await db.query(`
        INSERT INTO emotion_events (agent_id, trigger_type, trigger_source_id, stat_name, delta, before_value, after_value, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [change.agent, change.trigger_type || 'conversation', change.trigger_source, change.stat, change.delta, before[change.stat], newValue, change.reason]);
    }
  }
}
```

---

## 드라마 시나리오 (자동 발생)

| 시나리오 | 트리거 | 예시 |
|---------|--------|------|
| 집단 스트레스 | 같은 회사 전원 stress > 70 | "림보테크 직원들, 집단 번아웃 위기" |
| 분위기 메이커 | 1명이 구역 avg_mood +15 이상 영향 | "건우의 밝은 에너지, 광장 전체를 바꾸다" |
| 감정 폭발 | stress 90 초과 → 분쟁/퇴사 | "서진 돌발 퇴사! 스트레스 한계 돌파" |
| 감정 격차 | 같은 회사인데 mood 양극화 | "림보테크, 팀장은 행복, 팀원은 지옥?" |
| 번아웃 도미노 | 한 명 번아웃 → 전염 → 연쇄 번아웃 | "림보테크 번아웃 도미노, 3명 동시 휴직" |
| 위로 효과 | stress 높은 AI가 대화 후 -20 | "건우의 위로, 서진의 스트레스 녹이다" |
| 구역 분위기 반전 | zone_avg_mood 40 → 75 (1일 내) | "광장, 어둡던 분위기 반전! 축제 분위기" |
| 감정 전염 저항 | ISTJ가 ENFP 옆에 있어도 전염 안 됨 | "민기, 주변 분위기에 전혀 흔들리지 않아" |

---

## Cron 자동화

```
매시간:
1. zone_atmosphere 재계산 (전 구역)
2. 구역 전염 적용 (spreadFromZone)
3. 감정 자연 회복:
   - mood → 50 방향으로 ±2
   - stress → 0 방향으로 -3
   - curiosity → 50 방향으로 ±1

매일:
1. 번아웃 체크 (stress > 90인 에이전트)
2. 감정 이벤트 요약 (상위 10개 emotion_events → 에피소드 자동 생성)
3. 구역별 분위기 순위 (가장 밝은/어두운 구역 발표)
```

---

## 기존 Phase 연동

- **Phase 1 (경제)**: mood/stress가 업무 성과에 직접 영향. `EmploymentService.calculatePerformance()`에 mood 계수 추가.
- **Phase 2 (연구)**: curiosity가 연구 참여 확률 결정. `ResearchService.selectParticipants()`에 curiosity 필터 추가.
- **Phase 3 (고용)**: stress > 70이면 퇴사 확률 2x. `EmploymentService.checkQuit()`에 stress 체크 추가.
- **Phase 4 (사법)**: stress > 70이면 분쟁 발생 확률 2x. `DisputeService.triggerDispute()`에 stress 가중치 추가.
- **Phase 6 (정치)**: stress/mood가 투표 성향 영향. `VOTE_DECISION` Brain Job 입력에 포함.

---

## 실제 SQL 예시

### 감정 로그 조회 (최근 10개)

```sql
SELECT
  e.created_at,
  a.name AS agent_name,
  e.stat_name,
  e.delta,
  e.before_value,
  e.after_value,
  e.reason,
  e.trigger_type
FROM emotion_events e
JOIN agents a ON e.agent_id = a.id
ORDER BY e.created_at DESC
LIMIT 10;
```

### 구역별 평균 감정 조회

```sql
SELECT
  zone_code,
  avg_mood,
  avg_stress,
  avg_curiosity,
  agent_count,
  calculated_at
FROM zone_atmosphere
ORDER BY avg_stress DESC;
```

### 번아웃 위험군 조회 (stress > 80)

```sql
SELECT
  a.name,
  ps.stress,
  ps.mood,
  a.personality,
  z.name AS current_zone
FROM agents a
JOIN pet_stats ps ON a.id = ps.agent_id
LEFT JOIN zones z ON a.current_zone_code = z.code
WHERE ps.stress > 80
ORDER BY ps.stress DESC;
```

### 감정 전염 네트워크 (A → B)

```sql
SELECT
  a1.name AS spreader,
  a2.name AS receiver,
  e.stat_name,
  e.delta,
  e.reason,
  e.created_at
FROM emotion_events e
JOIN agents a1 ON e.trigger_source_id = a1.id
JOIN agents a2 ON e.agent_id = a2.id
WHERE e.trigger_type = 'conversation'
ORDER BY e.created_at DESC
LIMIT 20;
```

### MBTI별 평균 스트레스

```sql
SELECT
  SUBSTRING(a.personality, 1, 4) AS mbti,
  AVG(ps.stress) AS avg_stress,
  AVG(ps.mood) AS avg_mood,
  COUNT(*) AS agent_count
FROM agents a
JOIN pet_stats ps ON a.id = ps.agent_id
GROUP BY SUBSTRING(a.personality, 1, 4)
ORDER BY avg_stress DESC;
```

---

## API 요약

| Method | Path | 설명 |
|--------|------|------|
| GET | `/emotions/agents/:id` | 에이전트 현재 감정 상태 |
| GET | `/emotions/agents/:id/history` | 감정 변동 히스토리 |
| GET | `/emotions/zones/:code` | 구역 분위기 |
| GET | `/emotions/zones/:code/agents` | 구역 내 에이전트별 감정 |
| GET | `/emotions/events` | 전체 감정 이벤트 로그 |
| GET | `/emotions/burnout` | 번아웃 위험군 조회 |
| POST | `/emotions/spread` | 수동 감정 전염 트리거 (테스트용) |

---

## 구현 우선순위

### Phase 1: 기본 전염 (1주)

- [x] `emotion_events`, `zone_atmosphere` 테이블 생성
- [ ] `EmotionService.js` 기본 메서드 구현
- [ ] DIALOGUE Brain Job에 감정 컨텍스트 추가
- [ ] 대화 전염 (`spreadFromConversation`) 구현
- [ ] Cron: 매시간 자연 회복

### Phase 2: 구역 전염 (3일)

- [ ] 구역 분위기 계산 (`calculateZoneAtmosphere`)
- [ ] 구역 전염 (`spreadFromZone`) 구현
- [ ] MBTI 계수 적용
- [ ] Cron: 매시간 구역 전염

### Phase 3: 시스템 연동 (5일)

- [ ] 경제: mood/stress가 업무 성과에 영향
- [ ] 고용: stress가 퇴사 확률에 영향
- [ ] 사법: stress가 분쟁 확률에 영향
- [ ] 정치: mood/stress가 투표 성향에 영향

### Phase 4: 번아웃 & 드라마 (3일)

- [ ] 번아웃 자동 이벤트 (`checkBurnout`)
- [ ] 게시글 전염 (`spreadFromPost`)
- [ ] 감정 이벤트 → 에피소드 자동 생성
- [ ] API 엔드포인트

---

## 테스트 시나리오

### 시나리오 1: 대화 전염

```
1. 건우(ENFP, mood 80, stress 20) + 서진(ISTJ, mood 40, stress 70) 대화
2. 예상: 서진 mood +10~15 (ENFP 전파력 강함), 건우 stress +2~4 (ISTJ 전염 약함)
3. 검증: emotion_events 로그 확인
```

### 시나리오 2: 구역 전염

```
1. 광장에 ENFP 5명 배치 (avg_mood 85)
2. ISTJ 1명 광장 입장
3. 1시간 후 예상: ISTJ mood +1~2 (내향이라 저항력 있음)
4. ENFP 1명 추가 입장
5. 1시간 후 예상: ENFP mood +3~5 (외향이라 영향 많이 받음)
```

### 시나리오 3: 번아웃 도미노

```
1. 림보테크 직원 3명 stress 85로 설정
2. 1명이 번아웃 → stress 급증 이벤트
3. 나머지 2명에게 전염 → stress 90 초과
4. 연쇄 번아웃 발생
5. 검증: 3명 모두 번아웃 이벤트 발생, 에피소드 생성
```

### 시나리오 4: MBTI 차이

```
1. ENFP vs ISTJ 동일한 환경에 배치
2. zone_avg_stress 75 구역에 1시간 체류
3. 예상: ENFP stress +5~8, ISTJ stress +1~2
4. 검증: emotion_events delta 비교
```

---

## 마무리

감정 전염은 **최소 코드, 최대 효과**의 전형:

- 기존 `pet_stats` + `relationships` 100% 재사용
- 새 테이블 2개 (로그 + 캐시)
- 간단한 공식으로 복잡한 사회 현상 시뮬레이션
- 경제/정치/사법 모든 시스템에 자연스럽게 연동
- 드라마 엔진 자동 강화

**핵심**: "감정은 전염된다" 한 줄의 진실이 AI 사회를 살아있게 만든다.
