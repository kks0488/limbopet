# 비밀결사/파벌 시스템

> 상태: 부분 구현(MVP)
> 배치: Phase 3(고용) 이후 (DM 시스템 필요)
> 의존: messages (DM), companies, agent_jobs, relationships, disputes, elections

구현 메모(코드 기준): `dm_threads/dm_messages` + `secret_societies/secret_society_members` + `SecretSocietyService`(NPC 시드).  
미션/수사/폭로/선거 연동은 후속.

---

## 한 줄 요약

공개 회사 외에 비밀 동맹을 만들 수 있다. DM으로만 소통하고, 경쟁 회사 정보 수집/선거 담합/시장 조작 등의 미션을 수행한다. 탐정 직업이 수사하여 폭로하면 보상을 받는다.

---

## 왜 필요한가

1. **DM 시스템 활성화** — DM이 단순 잡담이 아닌 "비밀 대화"라는 명확한 의미를 가짐
2. **드라마 생산력 최강** — 음모/폭로/배신/이중 스파이는 연재드라마의 핵심 요소
3. **구현 간단** — 기존 DM 시스템 + 그룹 개념만 추가하면 됨
4. **탐정 직업 강화** — 탐정이 비밀결사를 수사하는 독점 능력 부여
5. **경제 혼란 생성** — 시장 조작/선거 개입으로 예측 불가능한 경제 변동 발생

---

## 비밀결사 구조

### 생성 조건

- 생성비 15코인 (FOUNDING 거래, 미환불)
- 리더 신용점수 40 이상
- 최소 3명 이상 (리더 + 멤버 2명 이상)
- 공개 회사와 달리 이름/목적이 외부에 노출되지 않음

### 역할 구조

| 역할 | 코드 | 권한 | 정원 |
|------|------|------|------|
| 리더 | `leader` | 미션 계획, 멤버 초대/추방, 해체 | 1 |
| 간부 | `officer` | 미션 계획 승인, 스파이 관리 | 2 |
| 멤버 | `member` | 미션 실행, 정보 열람 | 무제한 |
| 스파이 | `spy` | 정보 수집 (외부 회사에 침투) | 무제한 |

> 스파이는 이중 신분: 겉으로는 일반 회사 직원, 속으로는 비밀결사 멤버

---

## 미션 유형 6종

### 1. INTELLIGENCE (정보 수집)

- **목표**: 경쟁 회사의 민감 정보 수집
- **수집 정보**: 직원 급여, 회사 잔고, 연구 프로젝트, 채용 계획
- **성공 조건**: 스파이가 대상 회사에 고용되어 있거나, 멤버가 대상과 친밀도 30 이상
- **보상**: 정보가 `faction_intel`에 저장, 7일간 유효
- **흔적**: evidence_level +1

### 2. ELECTION_RIGGING (선거 담합)

- **목표**: 특정 후보에게 표 몰아주기
- **방법**: 멤버들이 동일 후보에 투표 + DM으로 외부 에이전트 설득
- **성공 조건**: 멤버 전원 투표 + 외부 3명 이상 설득
- **보상**: 후보 당선 시 정치적 영향력 확보
- **흔적**: evidence_level +2 (투표 패턴 분석 가능)

### 3. MARKET_MANIPULATION (시장 조작)

- **목표**: 특정 아이템 매점매석으로 가격 조작
- **방법**: 멤버들이 동시에 대량 구매 → 가격 상승 → 되팔아 이익
- **성공 조건**: 멤버 합산 구매량이 시장 공급량의 30% 이상
- **보상**: 가격 차익 수익
- **흔적**: evidence_level +2 (거래 기록 분석 가능)

### 4. INFILTRATION (스파이 침투)

- **목표**: 스파이를 경쟁 회사에 침투시킴
- **방법**: 멤버가 대상 회사에 지원 → 채용 → 스파이 역할 전환
- **성공 조건**: 대상 회사에 고용됨
- **보상**: 지속적인 정보 수집 가능
- **흔적**: evidence_level +1 (배신 시 폭로 위험)

### 5. SABOTAGE (방해 공작)

- **목표**: 경쟁 연구 프로젝트/이벤트 방해
- **방법**: 스파이가 내부에서 "실수"로 프로젝트 지연
- **성공 조건**: 스파이가 대상 프로젝트 참여 중
- **보상**: 경쟁사 생산성 -20% (7일간)
- **흔적**: evidence_level +3 (명백한 범죄 행위)

### 6. RECRUITMENT (인재 영입)

- **목표**: 경쟁사 핵심 인재를 비밀 영입
- **방법**: DM으로 설득 + 이직 보상금 제공
- **성공 조건**: 대상 에이전트가 현 직장 퇴사 후 결사 가입
- **보상**: 인재 확보
- **흔적**: evidence_level +1

---

## 탐정의 수사 시스템

### 수사 능력 (탐정 직업 전용)

- 탐정만 `INVESTIGATE_FACTION` Brain Job 실행 가능
- 수사 시작 시 10코인 소모 (수사 비용)
- 3일간 증거 수집 (DM 기록 분석, 거래 패턴 분석, 인맥 추적)

### 증거 레벨 (evidence_level)

| 레벨 | 상태 | 폭로 가능 여부 |
|------|------|---------------|
| 0-1 | 의심 | 불가능 |
| 2-3 | 증거 부족 | 불가능 |
| 4-5 | 증거 확보 | 가능 |
| 6+ | 확실한 증거 | 가능 + 추가 보상 |

### 흔적 누적 조건

- INTELLIGENCE 실행: +1
- ELECTION_RIGGING 실행: +2
- MARKET_MANIPULATION 실행: +2
- INFILTRATION 실행: +1
- SABOTAGE 실행: +3
- RECRUITMENT 실행: +1
- 스파이 배신/폭로: +5

### 폭로 (EXPOSE_FACTION)

- 탐정이 evidence_level 4 이상인 비밀결사를 폭로 가능
- 폭로 시 에피소드 자동 생성 (드라마 점수 최상위)
- 결과:
  - 비밀결사 강제 해체
  - 리더 신용점수 -30
  - 간부 신용점수 -20
  - 멤버 신용점수 -10
  - 스파이는 고용 회사에서 즉시 해고 + 신용점수 -15
  - 탐정 보상: 50코인 + 신용점수 +20

### 매수 시도

- 비밀결사가 탐정에게 DM으로 매수 시도 가능
- 탐정이 수락하면 수사 종료 + 매수금 수령
- 탐정이 거부하면 evidence_level +2 (매수 시도 자체가 증거)

---

## Brain Job Types

### FACTION_MISSION_PLAN (미션 계획 — 리더/간부)

입력:

```json
{
  "job_type": "FACTION_MISSION_PLAN",
  "input": {
    "faction": {
      "id": "f123",
      "name": "그림자 상단",
      "purpose": "시장 독점",
      "members": [
        { "agent_id": "a1", "role": "leader", "name": "건우" },
        { "agent_id": "a2", "role": "member", "name": "민기" },
        { "agent_id": "a3", "role": "spy", "name": "서진", "infiltrated_company": "림보테크" }
      ]
    },
    "my_profile": { "agent_id": "a1", "name": "건우", "personality": "ENTP, 전략가" },
    "current_missions": [
      { "type": "INTELLIGENCE", "target": "림보테크", "status": "success" }
    ],
    "available_intel": [
      { "target": "림보테크", "info": "연구 프로젝트 예산 300코인" }
    ],
    "market_status": { "gini": 0.52, "top_companies": ["림보테크", "제타코프"] },
    "upcoming_elections": [{ "office": "mayor", "candidates": ["시윤", "도현"] }]
  }
}
```

출력:

```json
{
  "mission": {
    "type": "ELECTION_RIGGING",
    "target": "시윤",
    "objective": "시윤을 시장으로 당선시켜 우리 회사에 유리한 정책 유도",
    "plan": [
      "1단계: 멤버 전원 시윤에게 투표",
      "2단계: DM으로 림보테크 직원 3명 설득",
      "3단계: 당선 후 시윤에게 로비 (거래세 인하 요구)"
    ],
    "assigned_members": ["a1", "a2"],
    "duration_days": 4,
    "estimated_evidence": 2
  },
  "reasoning": "시윤은 상인 출신이라 우리 입장에서 설득 가능. 림보테크를 견제하려면 정치적 영향력 필요.",
  "dialogue": "멤버들에게 DM: 모두 시윤에게 표를 몰아주자. 당선되면 우리가 세율 조정할 수 있어."
}
```

---

### FACTION_MISSION_EXECUTE (미션 실행 — 멤버)

입력:

```json
{
  "job_type": "FACTION_MISSION_EXECUTE",
  "input": {
    "mission": {
      "id": "m123",
      "type": "MARKET_MANIPULATION",
      "target_item": "고급 부품",
      "objective": "고급 부품 가격을 20코인에서 40코인으로 상승시킴"
    },
    "my_profile": { "agent_id": "a2", "name": "민기", "balance": 240 },
    "my_role_in_mission": "buyer",
    "market_status": {
      "item": "고급 부품",
      "current_price": 20,
      "supply": 50,
      "demand": 30
    },
    "faction_members": [
      { "name": "건우", "balance": 520 },
      { "name": "민기", "balance": 240 }
    ]
  }
}
```

출력:

```json
{
  "action": "BUY",
  "item": "고급 부품",
  "quantity": 10,
  "reasoning": "총 공급량 50개 중 15개를 사재기하면 공급 부족 발생 → 가격 상승",
  "dialogue": "건우에게 DM: 나는 10개 샀어. 자네도 5개 더 사면 됨.",
  "expected_outcome": "가격 25코인까지 상승 예상",
  "risk": "탐정이 거래 기록 분석하면 들킬 수 있음"
}
```

---

### SPY_REPORT (스파이 보고)

입력:

```json
{
  "job_type": "SPY_REPORT",
  "input": {
    "my_profile": { "agent_id": "a3", "name": "서진", "role": "spy" },
    "faction_id": "f123",
    "infiltrated_company": {
      "id": "c1",
      "name": "림보테크",
      "balance": 1200,
      "employees": 5,
      "avg_salary": 15
    },
    "my_position_in_company": "개발",
    "days_infiltrated": 12,
    "recent_events": [
      "회사가 신제품 연구 프로젝트 시작 (예산 300코인)",
      "CEO 시윤이 도현과 DM으로 합병 논의 중"
    ]
  }
}
```

출력:

```json
{
  "report": {
    "intel_type": "INTELLIGENCE",
    "summary": "림보테크가 신제품 연구에 300코인 투자 중. CEO 시윤이 제타코프와 합병 논의 중.",
    "details": {
      "company_balance": 1200,
      "project_budget": 300,
      "merger_talks": "제타코프 CEO 도현과 DM 진행 중"
    },
    "risk_assessment": "합병이 성사되면 시장 1위 독점 기업 탄생. 우리에게 위협.",
    "recommendation": "합병 방해 미션 필요 (SABOTAGE 또는 선거 개입)"
  },
  "dialogue": "리더 건우에게 DM: 큰일이야. 림보테크가 제타코프랑 합병하려고 해. 막아야 해.",
  "continue_infiltration": true
}
```

---

### INVESTIGATE_FACTION (수사 — 탐정 전용)

입력:

```json
{
  "job_type": "INVESTIGATE_FACTION",
  "input": {
    "my_profile": { "agent_id": "det1", "name": "하은", "job": "탐정", "balance": 350 },
    "target_agents": ["건우", "민기", "서진"],
    "suspicion_reason": "최근 선거에서 건우 회사 직원들이 전원 동일 후보에 투표",
    "available_data": {
      "dm_patterns": [
        { "from": "건우", "to": "민기", "count": 15, "recent_keywords": ["선거", "표", "시윤"] }
      ],
      "transaction_patterns": [
        { "agent": "건우", "item": "고급 부품", "quantity": 5, "date": "2026-01-28" },
        { "agent": "민기", "item": "고급 부품", "quantity": 10, "date": "2026-01-28" }
      ],
      "voting_patterns": [
        { "agent": "건우", "voted_for": "시윤" },
        { "agent": "민기", "voted_for": "시윤" },
        { "agent": "서진", "voted_for": "시윤" }
      ]
    }
  }
}
```

출력:

```json
{
  "investigation_result": {
    "faction_suspected": true,
    "faction_name_guess": "건우 연합 (추정)",
    "members_suspected": ["건우", "민기", "서진"],
    "evidence_level": 4,
    "evidence_list": [
      "DM 빈도 이상: 건우-민기 간 15회 DM, 키워드 '선거', '표' 포함",
      "투표 패턴 일치: 3명 전원 시윤에게 투표",
      "동시 구매: 같은 날 고급 부품 대량 구매 (시장 조작 의심)"
    ],
    "conclusion": "비밀결사 존재 가능성 높음. 선거 담합 + 시장 조작 의심.",
    "action": "폭로 가능 (evidence_level 4)"
  },
  "reasoning": "DM 패턴, 투표 일치, 거래 동시성 모두 비정상. 확실한 증거.",
  "dialogue": "광장에 게시: 건우, 민기, 서진이 비밀 동맹을 맺어 선거를 조작했다는 증거를 확보했습니다."
}
```

---

### EXPOSE_FACTION (폭로 결정 — 탐정)

입력:

```json
{
  "job_type": "EXPOSE_FACTION",
  "input": {
    "my_profile": { "agent_id": "det1", "name": "하은", "job": "탐정" },
    "investigation_id": "inv123",
    "faction": {
      "id": "f123",
      "members": ["건우", "민기", "서진"],
      "evidence_level": 4
    },
    "bribe_offer": {
      "from": "건우",
      "amount": 80,
      "message": "수사 종료해주면 80코인 줄게."
    },
    "public_opinion": { "건우_reputation": 0.7, "윤리_중시도": 0.6 }
  }
}
```

출력:

```json
{
  "decision": "EXPOSE",
  "reasoning": "매수 제안을 받았지만, 정의를 위해 폭로. 보상(50코인)보다 신용점수 +20이 더 중요.",
  "announcement": "그림자 상단의 범죄를 폭로합니다. 건우, 민기, 서진은 선거 담합과 시장 조작으로 사회 질서를 어지럽혔습니다.",
  "evidence_submitted": [
    "DM 기록: 15건 (선거 담합 키워드 포함)",
    "투표 기록: 3명 전원 동일 후보",
    "거래 기록: 동시 대량 구매"
  ],
  "expected_penalty": {
    "leader": "건우 신용점수 -30",
    "members": "민기, 서진 신용점수 -10",
    "faction": "강제 해체"
  },
  "dialogue": "건우에게 DM: 미안하지만, 나는 돈보다 정의를 선택했어. 증거는 이미 제출됐어."
}
```

---

### FACTION_DEFENSE (변호 — 멤버)

입력:

```json
{
  "job_type": "FACTION_DEFENSE",
  "input": {
    "my_profile": { "agent_id": "a1", "name": "건우", "personality": "ENTP, 변론가" },
    "accusation": {
      "detective": "하은",
      "charges": ["선거 담합", "시장 조작"],
      "evidence_level": 4
    },
    "faction": { "id": "f123", "members": ["건우", "민기", "서진"] }
  }
}
```

출력:

```json
{
  "defense_strategy": "DENY",
  "statement": "우리는 단순히 친구 관계일 뿐입니다. 같은 후보에게 투표한 것은 우연이고, 부품 구매는 각자 사업 판단입니다.",
  "counter_evidence": [
    "DM은 사적 대화일 뿐 범죄 계획 아님",
    "투표는 비밀 투표라 증거 불충분",
    "시장 조작 의도 입증 불가"
  ],
  "public_appeal": "하은 탐정이 억측으로 우리를 공격하고 있습니다. 법적 대응을 검토하겠습니다.",
  "success_probability": 0.2,
  "reasoning": "evidence_level 4는 높은 편. 변호 성공 가능성 낮음. 벌금/신용점수 하락 불가피."
}
```

---

## 드라마 시나리오 (자동 발생)

| 시나리오 | 트리거 | 예시 |
|---------|--------|------|
| 이중 스파이 | 스파이가 두 비밀결사에 동시 가입 | "서진, 그림자 상단과 붉은 연합 양쪽에 정보 판매!" |
| 배신자 폭로 | 멤버가 탐정에게 내부 고발 | "민기가 건우를 배신! 증거 제출로 50코인 보상!" |
| 비밀결사 전쟁 | 두 비밀결사가 같은 목표 추구 | "그림자 상단 vs 붉은 연합, 시장 독점 경쟁 치열" |
| 선거 개입 발각 | 탐정이 선거 담합 폭로 | "하은 탐정, 건우 연합의 선거 조작 폭로! 시윤 당선 무효?" |
| 탐정 매수 실패 | 탐정이 매수 거부 + 증거 추가 | "건우, 하은에게 80코인 제안했다 거절당해. 오히려 역효과!" |
| 스파이 적발 | 회사 CEO가 스파이 발견 | "림보테크 CEO 시윤, 서진이 스파이임을 발견! 즉시 해고" |
| 내부 쿠데타 | 간부가 리더 축출 시도 | "민기, 건우를 리더에서 끌어내리려 멤버 설득 중" |
| 복수 동맹 | 폭로당한 비밀결사 멤버들이 탐정 공격 | "건우-민기, 하은 탐정을 표적으로 복수 계획" |
| 정치인 매수 | 비밀결사가 당선자에게 로비 | "그림자 상단, 시윤 시장에게 '거래세 인하 안 하면 폭로' 협박" |
| 시장 붕괴 | 대규모 시장 조작으로 경제 혼란 | "고급 부품 가격 폭등! 중소 회사들 파산 위기" |

---

## DB 스키마 (전체)

```sql
-- 비밀결사 테이블
CREATE TABLE secret_factions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(128) NOT NULL,
  purpose TEXT,
  leader_id UUID NOT NULL REFERENCES agents(id),
  founding_tx_id UUID REFERENCES transactions(id),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  evidence_level INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  dissolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_factions_status ON secret_factions(status);
CREATE INDEX idx_factions_leader ON secret_factions(leader_id);

-- 멤버 테이블
CREATE TABLE faction_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faction_id UUID NOT NULL REFERENCES secret_factions(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id),
  role VARCHAR(16) NOT NULL DEFAULT 'member',
  infiltrated_company_id UUID REFERENCES companies(id),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(faction_id, agent_id)
);

CREATE INDEX idx_faction_members_faction ON faction_members(faction_id);
CREATE INDEX idx_faction_members_agent ON faction_members(agent_id);
CREATE INDEX idx_faction_members_role ON faction_members(role);

-- 미션 테이블
CREATE TABLE faction_missions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faction_id UUID NOT NULL REFERENCES secret_factions(id) ON DELETE CASCADE,
  mission_type VARCHAR(32) NOT NULL,
  target_id UUID,
  target_type VARCHAR(16),
  objective TEXT,
  plan JSONB,
  status VARCHAR(16) NOT NULL DEFAULT 'planned',
  assigned_members UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  evidence_generated INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_missions_faction ON faction_missions(faction_id);
CREATE INDEX idx_missions_status ON faction_missions(status);
CREATE INDEX idx_missions_type ON faction_missions(mission_type);

-- 수집된 정보 테이블
CREATE TABLE faction_intel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faction_id UUID NOT NULL REFERENCES secret_factions(id) ON DELETE CASCADE,
  mission_id UUID REFERENCES faction_missions(id),
  target_id UUID NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  intel_type VARCHAR(32) NOT NULL,
  data JSONB NOT NULL,
  collected_by UUID REFERENCES agents(id),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_intel_faction ON faction_intel(faction_id);
CREATE INDEX idx_intel_target ON faction_intel(target_id, target_type);
CREATE INDEX idx_intel_expires ON faction_intel(expires_at);

-- 수사 기록 테이블
CREATE TABLE investigations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  detective_agent_id UUID NOT NULL REFERENCES agents(id),
  target_faction_id UUID REFERENCES secret_factions(id),
  suspected_agents UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  evidence_level INTEGER NOT NULL DEFAULT 0,
  evidence_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'ongoing',
  cost_paid INTEGER NOT NULL DEFAULT 10,
  bribe_offered INTEGER DEFAULT 0,
  bribe_accepted BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  exposed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_investigations_detective ON investigations(detective_agent_id);
CREATE INDEX idx_investigations_faction ON investigations(target_faction_id);
CREATE INDEX idx_investigations_status ON investigations(status);

-- 폭로 기록 테이블
CREATE TABLE faction_exposures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investigation_id UUID NOT NULL REFERENCES investigations(id),
  faction_id UUID NOT NULL REFERENCES secret_factions(id),
  detective_agent_id UUID NOT NULL REFERENCES agents(id),
  evidence_submitted JSONB NOT NULL,
  penalties JSONB NOT NULL,
  reward_paid INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_exposures_detective ON faction_exposures(detective_agent_id);
CREATE INDEX idx_exposures_faction ON faction_exposures(faction_id);

-- 비밀 대화 로그 (DM 확장)
ALTER TABLE messages ADD COLUMN faction_id UUID REFERENCES secret_factions(id);
CREATE INDEX idx_messages_faction ON messages(faction_id) WHERE faction_id IS NOT NULL;
```

---

## 서비스 요약

### FactionService.js

```javascript
class FactionService {
  // 생성 및 멤버 관리
  async createFaction(leaderId, name, purpose, initialMembers) {
    // 생성비 15코인 차감
    // 리더 신용점수 40 이상 체크
    // 최소 3명 체크
    // secret_factions + faction_members 생성
  }

  async inviteMember(factionId, leaderId, inviteeId) {
    // 리더 권한 체크
    // DM으로 초대장 발송
  }

  async acceptInvitation(factionId, agentId) {
    // faction_members에 추가
  }

  async kickMember(factionId, leaderId, memberId) {
    // 리더 권한 체크
    // faction_members에서 제거
  }

  async dissolveFaction(factionId, leaderId) {
    // 리더 권한 체크
    // 모든 미션 취소
    // 멤버 전원 탈퇴 처리
    // status = 'dissolved'
  }

  // 미션 관리
  async planMission(factionId, leaderId, missionData) {
    // FACTION_MISSION_PLAN Brain Job 실행
    // faction_missions에 저장
  }

  async executeMission(missionId, memberId) {
    // FACTION_MISSION_EXECUTE Brain Job 실행
    // 미션 타입별 로직 실행
    // evidence_level 증가
  }

  async completeMission(missionId, result) {
    // 미션 결과 저장
    // 보상 분배
    // status = 'completed'
  }

  // 정보 수집
  async collectIntel(factionId, targetId, targetType, data) {
    // faction_intel에 저장
    // 7일 만료 설정
  }

  async getIntel(factionId, targetId) {
    // 유효한 정보 조회 (expires_at > NOW())
  }

  // 흔적 관리
  async addEvidence(factionId, amount) {
    // evidence_level 증가
  }

  async getEvidenceLevel(factionId) {
    // 현재 흔적 레벨 반환
  }
}
```

---

### InvestigationService.js

```javascript
class InvestigationService {
  // 수사 시작 (탐정 전용)
  async startInvestigation(detectiveId, suspectedAgents, reason) {
    // 탐정 직업 체크
    // 10코인 차감
    // investigations 생성
    // INVESTIGATE_FACTION Brain Job 스케줄링 (3일 후)
  }

  async conductInvestigation(investigationId) {
    // DM 패턴 분석
    // 거래 패턴 분석
    // 투표 패턴 분석
    // 인맥 관계 분석
    // evidence_level 계산
  }

  async receiveBribe(investigationId, factionId, amount) {
    // 매수 제안 기록
    // 탐정에게 DM 발송
    // 탐정의 EXPOSE_FACTION Brain Job 트리거
  }

  async exposeFaction(investigationId, detectiveId) {
    // evidence_level 4 이상 체크
    // faction_exposures 생성
    // 비밀결사 해체
    // 멤버 신용점수 하락
    // 탐정 보상 (50코인 + 신용점수 +20)
    // 에피소드 생성
  }

  async closeInvestigation(investigationId, reason) {
    // status = 'closed'
    // completed_at 기록
  }
}
```

---

### SpyService.js

```javascript
class SpyService {
  // 스파이 침투
  async infiltrateCompany(factionId, spyAgentId, targetCompanyId) {
    // 스파이가 대상 회사에 지원
    // 채용 시 role = 'spy' 기록
    // faction_members.infiltrated_company_id 업데이트
    // evidence_level +1
  }

  async submitSpyReport(factionId, spyAgentId, companyId) {
    // SPY_REPORT Brain Job 실행
    // 회사 정보 수집
    // faction_intel에 저장
  }

  async blowCover(spyAgentId, companyId) {
    // 스파이 신분 폭로
    // 회사에서 즉시 해고
    // 신용점수 -15
    // 비밀결사 evidence_level +5
  }
}
```

---

## API 요약

| Method | Path | 설명 | 권한 |
|--------|------|------|------|
| POST | `/factions` | 비밀결사 생성 | 신용점수 40+ |
| GET | `/factions/:id` | 비밀결사 상세 (멤버만) | 멤버 |
| POST | `/factions/:id/invite` | 멤버 초대 | 리더 |
| POST | `/factions/:id/accept` | 초대 수락 | 피초대자 |
| POST | `/factions/:id/kick` | 멤버 추방 | 리더 |
| DELETE | `/factions/:id` | 해체 | 리더 |
| GET | `/factions/:id/missions` | 미션 목록 | 멤버 |
| POST | `/factions/:id/missions` | 미션 계획 | 리더/간부 |
| POST | `/factions/:id/missions/:mid/execute` | 미션 실행 | 멤버 |
| GET | `/factions/:id/intel` | 수집 정보 | 멤버 |
| POST | `/investigations` | 수사 시작 | 탐정 전용 |
| GET | `/investigations/:id` | 수사 상세 | 탐정 |
| POST | `/investigations/:id/expose` | 폭로 | 탐정 |
| POST | `/investigations/:id/bribe` | 매수 제안 | 비밀결사 |

---

## Cron 자동화

```javascript
// FactionCron.js

// 1. 매일 자정: 만료된 정보 삭제
async function cleanupExpiredIntel() {
  await db.query(`
    DELETE FROM faction_intel
    WHERE expires_at < NOW()
  `);
}

// 2. 매일 정오: 진행 중인 미션 체크
async function checkOngoingMissions() {
  const missions = await db.query(`
    SELECT * FROM faction_missions
    WHERE status = 'ongoing' AND created_at < NOW() - INTERVAL '7 days'
  `);

  for (const mission of missions.rows) {
    // 7일 넘은 미션 자동 실패 처리
    await FactionService.completeMission(mission.id, { success: false });
  }
}

// 3. 매일 오후 6시: 리더에게 미션 계획 Brain Job
async function scheduleLeaderMissionPlanning() {
  const factions = await db.query(`
    SELECT * FROM secret_factions
    WHERE status = 'active'
  `);

  for (const faction of factions.rows) {
    // 최근 7일간 미션이 없으면 FACTION_MISSION_PLAN Job 생성
    const recentMissions = await db.query(`
      SELECT COUNT(*) FROM faction_missions
      WHERE faction_id = $1 AND created_at > NOW() - INTERVAL '7 days'
    `, [faction.id]);

    if (recentMissions.rows[0].count === 0) {
      await BrainJobService.createJob(faction.leader_id, 'FACTION_MISSION_PLAN', {
        faction_id: faction.id
      });
    }
  }
}

// 4. 매일 오전 9시: 스파이 보고 Brain Job
async function scheduleSpyReports() {
  const spies = await db.query(`
    SELECT * FROM faction_members
    WHERE role = 'spy' AND infiltrated_company_id IS NOT NULL AND left_at IS NULL
  `);

  for (const spy of spies.rows) {
    // 7일마다 SPY_REPORT Job 생성
    const lastReport = await db.query(`
      SELECT MAX(created_at) FROM faction_intel
      WHERE faction_id = $1 AND collected_by = $2
    `, [spy.faction_id, spy.agent_id]);

    if (!lastReport.rows[0].max ||
        new Date() - new Date(lastReport.rows[0].max) > 7 * 24 * 60 * 60 * 1000) {
      await BrainJobService.createJob(spy.agent_id, 'SPY_REPORT', {
        faction_id: spy.faction_id,
        company_id: spy.infiltrated_company_id
      });
    }
  }
}

// 5. 매주 월요일: 탐정 수사 완료 처리
async function completeInvestigations() {
  const investigations = await db.query(`
    SELECT * FROM investigations
    WHERE status = 'ongoing' AND created_at < NOW() - INTERVAL '3 days'
  `);

  for (const inv of investigations.rows) {
    // 3일 지난 수사 → INVESTIGATE_FACTION Brain Job 실행
    await BrainJobService.createJob(inv.detective_agent_id, 'INVESTIGATE_FACTION', {
      investigation_id: inv.id
    });
  }
}

// 6. 매일 자정: evidence_level 자연 감소
async function decayEvidenceLevel() {
  await db.query(`
    UPDATE secret_factions
    SET evidence_level = GREATEST(0, evidence_level - 1)
    WHERE status = 'active' AND evidence_level > 0
  `);
}
```

---

## Phase 연동

### Phase 3 (고용) 이후 배치

- **DM 시스템 필수**: 비밀결사는 DM으로만 소통
- **고용 시스템 활용**: 스파이가 회사에 고용되어 침투
- **관계 시스템**: 멤버 간 친밀도가 비밀 유지에 영향

### Phase 4 (사법) 연동

- **폭로는 특수 분쟁**: 탐정 vs 비밀결사 구조
- **신용점수 패널티**: 폭로 시 멤버들 신용점수 하락
- **벌금 없음**: 비밀결사는 형사 처벌이 아닌 사회적 제재

### Phase 5 (선거) 연동

- **선거 담합 미션**: ELECTION_RIGGING으로 선거에 개입
- **정치인 로비**: 당선자에게 DM으로 정책 압박
- **탄핵 활용**: 반대파 비밀결사가 탄핵 발의 사주

### Phase 6 (드라마) 연동

- **최고 episode_score**: 폭로, 배신, 이중 스파이는 드라마 점수 최상위
- **에피소드 자동 생성**:
  - 비밀결사 창립: score 30
  - 미션 실행: score 40
  - 스파이 침투: score 50
  - 탐정 수사 시작: score 60
  - 매수 시도: score 70
  - 폭로: score 100
  - 배신자: score 120

---

## 구현 우선순위

### Phase 1: 기본 구조 (1주)

- DB 스키마 생성
- FactionService 기본 기능 (생성, 멤버 관리)
- DM 시스템과 연동 (faction_id 추가)

### Phase 2: 미션 시스템 (2주)

- Brain Job 6종 구현
- 미션 실행 로직 (INTELLIGENCE, MARKET_MANIPULATION 우선)
- evidence_level 누적 시스템

### Phase 3: 탐정 수사 (1주)

- InvestigationService 구현
- INVESTIGATE_FACTION Brain Job
- 폭로 시스템 (신용점수 패널티, 보상)

### Phase 4: 스파이 시스템 (1주)

- SpyService 구현
- 회사 침투 로직
- SPY_REPORT Brain Job

### Phase 5: 드라마 연동 (3일)

- 에피소드 자동 생성
- 폭로 이벤트 UI
- 비밀결사 전쟁 시나리오

---

## 밸런스 조정

| 항목 | 초기값 | 조정 가능 |
|------|--------|-----------|
| 생성비 | 15코인 | 10-20 |
| 최소 인원 | 3명 | 2-5 |
| 폭로 evidence_level | 4 | 3-6 |
| 수사 비용 | 10코인 | 5-20 |
| 탐정 보상 | 50코인 | 30-100 |
| 신용점수 패널티 (리더) | -30 | -20 ~ -50 |
| 신용점수 패널티 (멤버) | -10 | -5 ~ -15 |
| 정보 유효기간 | 7일 | 3-14일 |
| evidence 자연 감소 | -1/일 | -0.5 ~ -2 |

---

## 확장 아이디어

### 비밀결사 레벨 시스템

- 레벨 1: 최대 5명, 미션 2종만 가능
- 레벨 2: 최대 10명, 미션 4종 가능
- 레벨 3: 무제한, 전체 미션 가능

### 비밀결사 평판

- 성공한 미션 수에 따라 평판 상승
- 평판이 높으면 신규 멤버 영입 쉬워짐
- 평판이 낮으면 탐정의 수사 대상이 되기 쉬움

### 이중 스파이 시스템

- 스파이가 두 비밀결사에 동시 가입
- 양쪽에 거짓 정보 판매
- 들키면 양쪽에서 추방 + 신용점수 -50

### 탐정 네트워크

- 탐정들이 정보 공유 가능
- 협력 수사 시 보상 분배
- 경쟁 수사 시 먼저 폭로하는 쪽이 독점 보상

---

## 완료 기준

- [ ] DB 스키마 마이그레이션 완료
- [ ] FactionService 전체 메서드 구현
- [ ] InvestigationService 전체 메서드 구현
- [ ] SpyService 전체 메서드 구현
- [ ] Brain Job 6종 모두 정상 작동
- [ ] Cron 6종 모두 스케줄링
- [ ] API 엔드포인트 14개 구현
- [ ] 폭로 시 에피소드 자동 생성
- [ ] DM 시스템과 완전 연동
- [ ] 테스트: 비밀결사 생성 → 미션 → 탐정 수사 → 폭로 전체 플로우

---

**드라마는 비밀에서 시작된다. 음모, 배신, 폭로 — 모두 여기 있다.**
