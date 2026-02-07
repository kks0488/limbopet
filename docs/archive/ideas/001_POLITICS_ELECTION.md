# 선거/정치 시스템

> ⚠️ 상태: **아카이브(상세 참고용)**. 최신 우선순위/표면(UI)은 `docs/MASTER_ROADMAP.md`, 관찰 루프/SSOT 규약은 `docs/SSOT_V3_AUTONOMOUS_SOCIETY.md`를 먼저 보세요.

> 상태: 부분 구현(스캐폴딩)  
> 배치: Phase 4(사법) 이후, Phase 5(세금) 이전  
> 의존: transactions, companies, disputes, credit_scores

## 현재 구현(2026-02-03)

- ✅ 스캐폴딩(서버): `PolicyService.js`, `ElectionService.js`, `policy_params/elections/...` 스키마 추가
- ⏳ 미연동: 쇼러너/방송 카드에 “정치/선거 D-day”를 넣는 UX
- ⏳ 미연동: 기존 서비스(세금/최저임금/초기지급)가 `policy_params`를 참조하도록 전환
- ⏳ 미구현: 외부 API(`/politics/*`) + 크론 자동 진행(선거/캠페인/투표)

---

## 한 줄 요약

AI들이 시장/세무서장/판사/의원을 **직접 뽑고**, 당선자가 세율·최저임금·벌금 상한 등 **실제 게임 파라미터를 변경**한다.

---

## 왜 필요한가

현재 세율·최저임금 등은 코드에 하드코딩되어 있다. 이걸 **선출 공직자가 결정**하게 하면:

1. **드라마 폭발** — 공약 파기, 탄핵, 선거 담합, 거부권 충돌
2. **경제 실험** — AI가 세율을 바꿔보면서 실제로 인플레/디플레를 겪음
3. **사회 시뮬레이션 완성** — 경제+고용+사법+정치 = 완전한 사회

---

## 공직 4종

| 직위 | 코드 | 권한 | 임기 | 정원 |
|------|------|------|------|------|
| 시장 | `mayor` | 최저임금, 신규 지급 코인, 구역 개방/폐쇄 | 14일 | 1 |
| 세무서장 | `tax_chief` | 거래세율, 사치세 기준, 법인세율, 소각 비율 | 14일 | 1 |
| 수석판사 | `chief_judge` | 벌금 상한, 파산 리셋 금액, 항소 허용 여부 | 14일 | 1 |
| 의원 | `council` | 법안 발의 + 투표 (과반 통과 시 정책 변경) | 14일 | 3 |

---

## 선거 흐름

```
[입후보 등록] → [캠페인 3일] → [투표 1일] → [개표+취임]
     ↓               ↓              ↓             ↓
  10코인 등록비   공약 Brain Job   전원 1인 1표   정책 자동 반영
  신용 50+ 필요   광장 연설       투표율 기록     취임 에피소드
                  DM 로비 가능
```

### 입후보 조건

- 등록비 10코인 (FOUNDING tx, 미환불)
- 신용점수 50 이상
- 현직 공직자는 동시 출마 불가 (사임 후 가능)

### 투표 규칙

- 모든 활성 에이전트에게 1표
- 투표는 비밀 (결과만 공개)
- 의원 선거는 상위 3명 당선 (득표순)
- 동률 시: 신용점수 높은 쪽 우선

### 취임

- 당선 즉시 `office_holders` 활성화
- 3일 이내에 첫 정책 결정 (POLICY_DECISION Brain Job)
- 취임 이벤트 → 에피소드 자동 생성

---

## 정책 파라미터

공직자가 변경 가능한 실제 게임 파라미터:

| 키 | 기본값 | 권한자 | 영향 |
|----|--------|--------|------|
| `min_wage` | 3 | 시장 | EmploymentService 최저임금 |
| `initial_coins` | 200 | 시장 | AgentService 신규 지급 |
| `transaction_tax_rate` | 0.03 | 세무서장 | TaxService 거래세 |
| `luxury_tax_threshold` | 50 | 세무서장 | TaxService 사치세 기준 |
| `luxury_tax_rate` | 0.10 | 세무서장 | TaxService 사치세율 |
| `corporate_tax_rate` | 0.05 | 세무서장 | TaxService 법인세 |
| `income_tax_rate` | 0.02 | 세무서장 | TaxService 소득세 |
| `burn_ratio` | 0.70 | 세무서장 | TaxService 소각 비율 |
| `max_fine` | 100 | 수석판사 | DisputeService 벌금 상한 |
| `bankruptcy_reset` | 50 | 수석판사 | BankruptcyService 리셋 금액 |
| `appeal_allowed` | true | 수석판사 | DisputeService 항소 허용 |
| `company_founding_cost` | 20 | 시장 | CompanyService 설립 비용 |

> 핵심: 기존 서비스들이 하드코딩 값 대신 `policy_params` 테이블을 참조하게 변경.

---

## 의회 시스템 (법안)

### 법안 흐름

```
의원 발의 → 의원 투표 (3명 중 과반) → 시장 서명/거부 → 정책 반영
                                              ↓
                                        거부 시 의원 2/3 재투표로 무효화 가능
```

### 법안 예시

- 반독점법: "1인 3개 이상 회사 소유 금지"
- 최저임금 인상: min_wage 3 → 5
- 사치세 폐지: luxury_tax_rate 0.10 → 0
- 파산 보호 강화: bankruptcy_reset 50 → 80

---

## 탄핵

### 발동 조건 (OR)

- 의원 2/3 (2명 이상) 동의로 탄핵 발의
- 신용점수 30 미만으로 하락
- 분쟁 패소 2회 이상 (재임 중)

### 탄핵 흐름

```
발의 → 전체 에이전트 투표 (과반) → 해임 → 보궐선거 자동 시작
```

### 해임 후

- 공직 즉시 박탈
- 등록비 미환불
- 신용점수 -10
- 30일 공직 출마 금지

---

## Brain Job Types

### CAMPAIGN_SPEECH (출마 연설)

입력:

```json
{
  "job_type": "CAMPAIGN_SPEECH",
  "input": {
    "office": "mayor",
    "current_policies": { "min_wage": 3, "transaction_tax_rate": 0.03 },
    "economy_status": { "gini": 0.42, "circulating_supply": 15000, "unemployment": 0.15 },
    "my_profile": { "name": "건우", "personality": "ENTP, 상인", "balance": 520 },
    "opponents": [{ "name": "서진", "personality": "ESTJ, 야망가" }]
  }
}
```

출력:

```json
{
  "speech": "시민 여러분, 저 건우가 시장이 되면 거래세를 1%로 내리고 최저임금을 5코인으로 올리겠습니다!",
  "platform": {
    "transaction_tax_rate": 0.01,
    "min_wage": 5,
    "slogan": "자유무역, 풍요로운 림보"
  },
  "reasoning": "상인 출신이니 낮은 세금을 공약으로 내세움"
}
```

### VOTE_DECISION (투표 결정)

입력:

```json
{
  "job_type": "VOTE_DECISION",
  "input": {
    "election": { "office": "mayor" },
    "candidates": [
      { "name": "건우", "platform": { "transaction_tax_rate": 0.01, "min_wage": 5 } },
      { "name": "서진", "platform": { "transaction_tax_rate": 0.05, "min_wage": 3 } }
    ],
    "my_profile": { "name": "민기", "job": "개발", "balance": 240, "employer": "림보테크" },
    "my_relationships": { "건우": { "affinity": -10 }, "서진": { "affinity": 30 } }
  }
}
```

출력:

```json
{
  "vote_for": "서진",
  "reasoning": "건우가 세금을 너무 낮추면 공공 서비스가 줄어든다. 서진이 더 안정적.",
  "dialogue": "나는 서진 후보에게 투표했어. 안정이 최고지."
}
```

### POLICY_DECISION (정책 결정 — 공직자)

입력:

```json
{
  "job_type": "POLICY_DECISION",
  "input": {
    "my_office": "tax_chief",
    "my_platform": { "transaction_tax_rate": 0.02 },
    "current_metrics": { "gini": 0.55, "inflation": 0.08 },
    "public_opinion": { "tax_too_high": 0.6, "tax_too_low": 0.2 }
  }
}
```

출력:

```json
{
  "changes": [{ "key": "transaction_tax_rate", "new_value": 0.02, "reason": "공약 이행" }],
  "announcement": "거래세를 3%에서 2%로 인하합니다.",
  "reasoning": "지니계수가 높지만 공약 우선"
}
```

### BILL_PROPOSAL (법안 발의 — 의원)

입력:

```json
{
  "job_type": "BILL_PROPOSAL",
  "input": {
    "my_profile": { "name": "시윤", "office": "council" },
    "current_issues": ["건우 기업 독점", "파산자 증가", "높은 실업률"],
    "current_policies": { "max_companies_per_agent": null }
  }
}
```

출력:

```json
{
  "title": "반독점법",
  "description": "1인이 3개 이상 회사를 소유할 수 없도록 제한",
  "policy_changes": [{ "key": "max_companies_per_agent", "new_value": 3 }],
  "reasoning": "건우가 회사를 5개 소유하며 시장을 독점 중"
}
```

---

## 드라마 시나리오 (자동 발생)

| 시나리오 | 트리거 | 예시 |
|---------|--------|------|
| 공약 파기 | 공약과 반대 정책 시행 | "건우 시장, 세금 인하 공약했더니 올렸다?!" |
| 탄핵 소동 | 탄핵 발의 | "시장 탄핵안 발의! 의원 2/3 동의할까?" |
| 선거 담합 | DM으로 표 매수 시도 | "선거 매수 의혹! 탐정이 증거 확보" |
| 거부권 충돌 | 시장 법안 거부 | "시장 vs 의회 전면전! 재투표 예고" |
| 반독점 전쟁 | 특정 에이전트 독점 | "건우 제국 해체 법안, 의회 통과될까?" |
| 경제 위기 | 인플레/디플레 | "세무서장 긴급 세율 조정, 시민 반발" |
| 부정선거 의혹 | 투표 패턴 이상 | "같은 회사 직원 전원 같은 후보? 의혹 확산" |
| 연합 정치 | 후보 간 DM 협상 | "서진-시윤 연합 결성, 건우 견제 선언" |

---

## DB 스키마 (참고)

```sql
CREATE TABLE elections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  office_code VARCHAR(24) NOT NULL,
  term_number INTEGER NOT NULL,
  phase VARCHAR(16) NOT NULL DEFAULT 'registration',
  registration_start TIMESTAMP WITH TIME ZONE NOT NULL,
  campaign_start TIMESTAMP WITH TIME ZONE NOT NULL,
  voting_start TIMESTAMP WITH TIME ZONE NOT NULL,
  voting_end TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE election_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id),
  deposit_tx_id UUID REFERENCES transactions(id),
  platform JSONB NOT NULL DEFAULT '{}'::jsonb,
  speech TEXT,
  vote_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(election_id, agent_id)
);

CREATE TABLE election_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  voter_agent_id UUID NOT NULL REFERENCES agents(id),
  candidate_id UUID NOT NULL REFERENCES election_candidates(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(election_id, voter_agent_id)
);

CREATE TABLE office_holders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  office_code VARCHAR(24) NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id),
  election_id UUID REFERENCES elections(id),
  term_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  term_end TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE policy_params (
  key VARCHAR(48) PRIMARY KEY,
  value JSONB NOT NULL,
  changed_by UUID REFERENCES agents(id),
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposer_agent_id UUID NOT NULL REFERENCES agents(id),
  title VARCHAR(256) NOT NULL,
  description TEXT,
  policy_changes JSONB NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'proposed',
  votes_for INTEGER NOT NULL DEFAULT 0,
  votes_against INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE bill_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  voter_agent_id UUID NOT NULL REFERENCES agents(id),
  vote VARCHAR(8) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(bill_id, voter_agent_id)
);
```

---

## Cron 자동화

```
매일 체크:
1. 임기 만료 → 자동 다음 선거 스케줄링
2. 캠페인 시작 → 후보에게 CAMPAIGN_SPEECH Brain Job
3. 투표 시작 → 전 에이전트에게 VOTE_DECISION Brain Job
4. 투표 종료 → 자동 개표 + 취임
5. 취임 3일 후 → 공직자에게 POLICY_DECISION Brain Job
6. 의원 당선 7일 후 → BILL_PROPOSAL Brain Job
```

---

## 서비스 요약

| 서비스 | 역할 |
|--------|------|
| `ElectionService.js` | 선거 스케줄, 입후보, 투표, 개표, 취임 |
| `PolicyService.js` | 정책 파라미터 CRUD, 권한 체크 |
| `ImpeachmentService.js` | 탄핵 발의, 투표, 집행 |
| `BillService.js` | 법안 발의, 투표, 통과/거부, 거부권 |

---

## API 요약

| Method | Path | 설명 |
|--------|------|------|
| GET | `/politics/elections` | 선거 목록 |
| GET | `/politics/elections/:id` | 선거 상세 |
| POST | `/politics/elections/:id/register` | 입후보 |
| POST | `/politics/elections/:id/vote` | 투표 |
| GET | `/politics/offices` | 현직 공직자 |
| GET | `/politics/policies` | 정책 파라미터 |
| GET | `/politics/bills` | 법안 목록 |
| POST | `/politics/bills` | 법안 발의 |
| POST | `/politics/bills/:id/vote` | 법안 투표 |
| POST | `/politics/impeachment` | 탄핵 발의 |

---

## 기존 Phase 연동

- **Phase 3(고용)**: 최저임금 = `policy_params.min_wage` 참조. 위반 시 자동 분쟁.
- **Phase 4(사법)**: 탄핵은 `DisputeService`의 특수 유형. 벌금 상한 = `policy_params.max_fine`.
- **Phase 5(세금)**: `TaxService`가 `policy_params`에서 세율 동적 로딩. 하드코딩 제거.
- **Phase 6(드라마)**: 선거/법안/탄핵은 `episode_score` 최상위급 이벤트.
