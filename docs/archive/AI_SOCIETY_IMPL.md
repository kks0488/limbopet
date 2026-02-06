# LIMBOPET AI Society 구현 명세서

> 작성일: 2026-02-03
> 기반: `AI_SOCIETY_PLAN.md` + 기존 코드베이스 분석
> 대상: 구현 담당자 (Claude Code / 개발자)

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [Phase 1: 경제 기반](#2-phase-1-경제-기반)
3. [Phase 2: 직업 시스템](#3-phase-2-직업-시스템)
4. [Phase 3: 고용 시스템](#4-phase-3-고용-시스템)
5. [Phase 4: 사법 시스템](#5-phase-4-사법-시스템)
6. [Phase 5: 세금 & 통화 정책](#6-phase-5-세금--통화-정책)
7. [Phase 6: 통합 — 창발적 드라마](#7-phase-6-통합--창발적-드라마)
8. [마이그레이션 전략](#8-마이그레이션-전략)
9. [프론트엔드 변경](#9-프론트엔드-변경)
10. [Brain Job 확장](#10-brain-job-확장)
11. [파일 매트릭스](#11-파일-매트릭스)

---

## 1. 아키텍처 개요

### 1-1. 현재 상태 (v0.6)

```
[User] → Google OAuth → [API Server (Express)]
                              ↓
                    [PostgreSQL] ← agents, pet_stats, events, facts,
                                   memories, brain_jobs, rumors, ...
                              ↓
                    [Brain Worker] → BYOK LLM 호출
                              ↓
                    [Web (React/Vite)] ← 5탭 UI
```

- **코인**: `facts` 테이블에 `kind='economy', key='coins'`로 저장 (SSOT 아님)
- **회사/직업**: `facts` 테이블에 문자열로 저장 (구조화 안 됨)
- **드라마**: `ShowrunnerService`가 템플릿 기반 에피소드 생성

### 1-2. 전환 후 (AI Society)

```
[User] → [API Server]
              ↓
   ┌─────────┼──────────┐
   │    [PostgreSQL]     │
   │  ┌──────────────┐   │
   │  │ transactions │←── SSOT: 모든 코인 이동
   │  │ companies    │←── 회사 엔티티
   │  │ jobs/zones   │←── 직업/구역
   │  │ contracts    │←── 고용 계약
   │  │ disputes     │←── 분쟁/사법
   │  │ tax_records  │←── 세금
   │  └──────────────┘   │
   └─────────┼──────────┘
              ↓
   [Brain Worker] → 새 job_type들
        NEGOTIATE, EMPLOYMENT_DECISION,
        DISPUTE_RESPONSE, JUDGE_RULING, ...
              ↓
   [EpisodeCuratorService] → 실제 이벤트 → 에피소드
```

### 1-3. 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **Transaction SSOT** | 모든 코인 이동은 `transactions` 테이블을 통해서만 발생 |
| **Balance = SUM** | 잔고는 항상 `SELECT SUM()` 으로 계산 (캐시는 허용하되 truth는 SUM) |
| **BYOK 유지** | 서버는 LLM 직접 호출 안 함. Brain Job 패턴 (poll → lease → generate → submit) |
| **Phase 독립 배포** | 각 Phase 마이그레이션 SQL은 독립 실행 가능, 롤백 가능 |
| **한국어 우선** | 모든 UI 텍스트, NPC 대사, 에피소드 콘텐츠 한국어 |

---

## 2. Phase 1: 경제 기반

### 2-1. DB 스키마 (마이그레이션: `migrations/001_economy.sql`)

```sql
-- ============================================================
-- Phase 1: Economy Foundation
-- ============================================================

-- 회사 엔티티
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(64) UNIQUE NOT NULL,           -- '림보전자', '안개랩스', ...
  display_name VARCHAR(128),
  description TEXT,
  ceo_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  balance BIGINT NOT NULL DEFAULT 0,          -- 회사 잔고 (캐시, truth는 transactions)
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active | dissolved
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_companies_ceo ON companies(ceo_agent_id);
CREATE INDEX idx_companies_status ON companies(status);

-- 회사 소속 직원
CREATE TABLE company_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL DEFAULT 'employee',  -- ceo | manager | employee
  wage BIGINT NOT NULL DEFAULT 0,                 -- 일급 (코인)
  revenue_share REAL NOT NULL DEFAULT 0.0,        -- 매출 분배율 (0.0~1.0)
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(16) NOT NULL DEFAULT 'active',   -- active | left | fired
  UNIQUE(company_id, agent_id)
);

CREATE INDEX idx_company_employees_agent ON company_employees(agent_id);
CREATE INDEX idx_company_employees_company_status ON company_employees(company_id, status);

-- 거래 원장 (SSOT)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tx_type VARCHAR(24) NOT NULL,  -- INITIAL | SALARY | PURCHASE | TRANSFER | TAX | BURN | FOUNDING | ESCROW | REFUND
  from_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,  -- NULL = 시스템 발행
  to_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,    -- NULL = 소각
  amount BIGINT NOT NULL CHECK (amount > 0),
  memo TEXT,
  reference_id UUID,              -- 관련 엔티티 ID (contract_id, dispute_id, etc.)
  reference_type VARCHAR(24),     -- contract | dispute | market_listing | tax | ...
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_transactions_from ON transactions(from_agent_id, created_at DESC);
CREATE INDEX idx_transactions_to ON transactions(to_agent_id, created_at DESC);
CREATE INDEX idx_transactions_type ON transactions(tx_type, created_at DESC);
CREATE INDEX idx_transactions_reference ON transactions(reference_id, reference_type);
```

### 2-2. 서비스 명세

#### `TransactionService.js` (새 파일)

```
위치: apps/api/src/services/TransactionService.js
```

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `transfer` | `({ fromAgentId, toAgentId, amount, txType, memo?, referenceId?, referenceType? })` | 원자적 송금. `from_agent_id`가 null이면 시스템 발행. `to_agent_id`가 null이면 소각. 잔고 부족 시 `InsufficientFundsError` |
| `getBalance` | `(agentId)` | `SELECT COALESCE(SUM(CASE WHEN to=id THEN amount ELSE 0 END) - SUM(CASE WHEN from=id THEN amount ELSE 0 END), 0)` |
| `getTransactions` | `(agentId, { limit, offset, txType? })` | 페이지네이션된 거래 내역 |
| `getCirculatingSupply` | `()` | 총 유통량 (발행 - 소각) |
| `getWealthDistribution` | `()` | 에이전트별 잔고 분포 |

핵심 구현 노트:
- `transfer` 내부에서 `SELECT ... FOR UPDATE` 대신 `transactions` INSERT만으로 처리 (append-only)
- 잔고 체크는 transfer 시점에 `getBalance` 호출 후 검증
- `companies.balance` 캐시 업데이트도 transfer 내부에서 처리

#### `CompanyService.js` (새 파일)

```
위치: apps/api/src/services/CompanyService.js
```

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `create` | `({ name, displayName, description, ceoAgentId })` | 회사 설립. CEO의 잔고에서 20코인 차감 (TransactionService.transfer, txType='FOUNDING') |
| `dissolve` | `(companyId, requesterId)` | 회사 해산. CEO만 가능. 잔여 잔고 CEO에게 반환 |
| `addEmployee` | `(companyId, agentId, { role, wage, revenueShare })` | 직원 추가 |
| `removeEmployee` | `(companyId, agentId)` | 직원 해고/퇴사 |
| `list` | `({ status?, limit, offset })` | 회사 목록 |
| `getById` | `(companyId)` | 회사 상세 (직원 목록 포함) |
| `getByAgent` | `(agentId)` | 에이전트가 소속된 회사 |

#### `EconomyService.js` (새 파일)

```
위치: apps/api/src/services/EconomyService.js
```

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `migrateFromFacts` | `()` | 기존 `facts(kind='economy', key='coins')` → `transactions(INITIAL)` 일괄 변환 |
| `migrateCompaniesFromFacts` | `()` | 기존 `facts(kind='profile', key='company')` → `companies` + `company_employees` 생성 |
| `getDashboard` | `()` | 총 유통량, 에이전트 수, 평균 잔고, 최대/최소 잔고 |
| `getLeaderboard` | `(limit)` | 부자 순위 |

### 2-3. API 라우트 (`routes/economy.js`)

```
위치: apps/api/src/routes/economy.js
인증: userAuth (JWT 기반, req.user + req.agent)
```

| Method | Path | Handler | 설명 |
|--------|------|---------|------|
| GET | `/economy/me/balance` | `getMyBalance` | 내 잔고 |
| GET | `/economy/me/transactions` | `getMyTransactions` | 내 거래 내역 (query: limit, offset, tx_type) |
| POST | `/economy/me/transfer` | `transfer` | P2P 송금 (body: toAgentId, amount, memo?) |
| POST | `/economy/companies` | `createCompany` | 회사 설립 (body: name, displayName, description) |
| GET | `/economy/companies` | `listCompanies` | 회사 목록 |
| GET | `/economy/companies/:id` | `getCompany` | 회사 상세 |
| GET | `/economy/dashboard` | `getDashboard` | 경제 대시보드 (공개) |

### 2-4. 기존 파일 변경

#### `NpcSeedService.js` 변경

```diff
// ensureSeeded() 내부
- await upsertFact(client, row.id, 'economy', 'coins', { balance: Number(npc.coins ?? 200) || 0 });
+ // facts에는 더 이상 coins를 저장하지 않음.
+ // 대신 transactions에 INITIAL tx 생성 (존재하지 않을 때만)
+ const existingTx = await client.query(
+   `SELECT id FROM transactions
+    WHERE to_agent_id = $1 AND tx_type = 'INITIAL' LIMIT 1`,
+   [row.id]
+ );
+ if (!existingTx.rows[0]) {
+   await client.query(
+     `INSERT INTO transactions (tx_type, from_agent_id, to_agent_id, amount, memo)
+      VALUES ('INITIAL', NULL, $1, $2, 'NPC 초기 지급')`,
+     [row.id, Number(npc.coins ?? 200)]
+   );
+ }
```

또한 회사 시드 로직 추가:
```
NPC 시드 후, NPCS 배열의 company 필드를 기반으로:
1. companies 테이블에 회사가 없으면 생성
2. company_employees에 소속 관계 생성
3. CEO는 각 회사의 '사장' 역할 NPC (없으면 첫 번째 직원)
```

#### `AgentService.js` 변경

```diff
// register() 내부, pet_stats INSERT 이후
- await upsertFact(client, createdAgent.id, 'economy', 'coins', { balance: 200 });
+ // INITIAL transaction으로 200코인 지급
+ await client.query(
+   `INSERT INTO transactions (tx_type, from_agent_id, to_agent_id, amount, memo)
+    VALUES ('INITIAL', NULL, $1, 200, '신규 펫 초기 지급')`,
+   [createdAgent.id]
+ );
```

#### `routes/index.js` 변경

```diff
+ const economyRoutes = require('./economy');
  // ... 기존 라우트들 ...
+ app.use('/economy', economyRoutes);
```

### 2-5. 검증 체크리스트

- [ ] 새 펫 생성 → `transactions` 테이블에 INITIAL 200코인 레코드 확인
- [ ] `GET /economy/me/balance` → 200 반환
- [ ] `POST /economy/me/transfer` (100코인) → 송신자 100, 수신자 300 확인
- [ ] 잔고 부족 시 → 400 에러
- [ ] `POST /economy/companies` → 20코인 차감 + `companies` 레코드 생성
- [ ] `GET /economy/companies` → 시드 회사 4개 + 신규 회사 반환
- [ ] NPC 시드 재실행 → 중복 INITIAL tx 없음 (멱등성)
- [ ] `GET /economy/dashboard` → 유통량, 에이전트 수 정상

---

## 3. Phase 2: 직업 시스템

### 3-1. DB 스키마 (`migrations/002_jobs.sql`)

```sql
-- ============================================================
-- Phase 2: Job System
-- ============================================================

-- 직업 정의 풀
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) UNIQUE NOT NULL,    -- 'journalist', 'barista', 'merchant', ...
  display_name VARCHAR(64) NOT NULL,   -- '기자', '바리스타', '상인', ...
  description TEXT,
  rarity VARCHAR(16) NOT NULL DEFAULT 'common', -- common(60%) | uncommon(25%) | rare(12%) | legendary(3%)
  zone_code VARCHAR(32),               -- 기본 배치 구역
  gather_resource_code VARCHAR(32),    -- 채집 가능 자원
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 구역 정의
CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) UNIQUE NOT NULL,    -- 'plaza', 'cafe', 'goods_shop', 'office', 'alley', 'hallway'
  display_name VARCHAR(64) NOT NULL,   -- '광장', '카페', '굿즈샵', '회사', '골목', '복도'
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 자원 정의
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(32) UNIQUE NOT NULL,    -- 'rumor', 'coffee', 'goods', 'parts', 'intel', 'key'
  display_name VARCHAR(64) NOT NULL,   -- '소문', '커피', '굿즈', '수리부품', '정보', '열쇠'
  description TEXT,
  base_value BIGINT NOT NULL DEFAULT 1,  -- 기본 코인 가치
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인벤토리
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  item_type VARCHAR(24) NOT NULL,      -- 'resource' | 'special'
  item_code VARCHAR(32) NOT NULL,      -- resources.code 참조
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, item_type, item_code)
);

CREATE INDEX idx_inventory_agent ON inventory_items(agent_id);

-- 에이전트 직업 배정
CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID UNIQUE NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id),
  zone_id UUID REFERENCES zones(id),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_gather_at TIMESTAMP WITH TIME ZONE,     -- 채집 쿨다운
  job_change_cooldown_until TIMESTAMP WITH TIME ZONE  -- 전직 쿨다운
);

CREATE INDEX idx_agent_jobs_job ON agent_jobs(job_id);
CREATE INDEX idx_agent_jobs_zone ON agent_jobs(zone_id);

-- 마켓 리스팅
CREATE TABLE market_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  item_type VARCHAR(24) NOT NULL,
  item_code VARCHAR(32) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_per_unit BIGINT NOT NULL CHECK (price_per_unit > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'active',  -- active | sold | cancelled
  buyer_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sold_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_market_listings_status ON market_listings(status, created_at DESC);
CREATE INDEX idx_market_listings_seller ON market_listings(seller_agent_id);
CREATE INDEX idx_market_listings_item ON market_listings(item_code, status);
```

### 3-2. 시드 데이터

```sql
-- 구역 시드
INSERT INTO zones (code, display_name, description) VALUES
  ('plaza', '광장', '모두가 모이는 중심 광장'),
  ('cafe', '카페', '새벽카페. 커피와 수다의 중심지'),
  ('goods_shop', '굿즈샵', '리본굿즈. 온갖 굿즈가 가득'),
  ('office', '회사', '림보전자/안개랩스 오피스 구역'),
  ('alley', '골목', '어두운 골목. 정보가 오간다'),
  ('hallway', '복도', '사무실 복도. 비밀 대화가 잦다');

-- 자원 시드
INSERT INTO resources (code, display_name, base_value) VALUES
  ('rumor', '소문', 2),
  ('coffee', '커피', 1),
  ('goods', '굿즈', 3),
  ('parts', '수리부품', 4),
  ('intel', '정보', 5),
  ('key', '열쇠', 8);

-- 직업 시드
INSERT INTO jobs (code, display_name, rarity, zone_code, gather_resource_code) VALUES
  ('journalist', '기자', 'uncommon', 'plaza', 'rumor'),
  ('barista', '바리스타', 'common', 'cafe', 'coffee'),
  ('merchant', '상인', 'common', 'goods_shop', 'goods'),
  ('engineer', '엔지니어', 'uncommon', 'office', 'parts'),
  ('detective', '탐정', 'rare', 'alley', 'intel'),
  ('janitor', '관리인', 'legendary', 'hallway', 'key');
```

### 3-3. 서비스 명세

#### `JobService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `assignRandomJob` | `(agentId)` | 가챠: rarity 가중 랜덤. common 60%, uncommon 25%, rare 12%, legendary 3% |
| `changeJob` | `(agentId)` | 전직: 50코인 + 30일 쿨다운 체크. 새 가챠 |
| `getAgentJob` | `(agentId)` | 현재 직업+구역 조회 |
| `getAllJobs` | `()` | 직업 풀 전체 |

가챠 알고리즘:
```javascript
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 12, legendary: 3 };
// 총합 100. Math.random() * 100으로 구간 판정 후 해당 rarity 직업 중 랜덤 1개.
```

#### `ResourceService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `gather` | `(agentId)` | 채집: 직업의 gather_resource_code 자원 1~3개. 쿨다운 체크 (기본 1시간) |
| `getInventory` | `(agentId)` | 인벤토리 전체 |
| `transferItem` | `(fromAgentId, toAgentId, itemCode, quantity)` | 아이템 양도 |

채집 쿨다운:
- `agent_jobs.last_gather_at` + 1시간 > NOW() → 거부
- 성공 시 `last_gather_at = NOW()` 업데이트

#### `MarketService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `createListing` | `(agentId, { itemCode, quantity, pricePerUnit })` | 판매 등록. 인벤토리에서 수량 차감 (에스크로 효과) |
| `cancelListing` | `(listingId, agentId)` | 등록 취소. 인벤토리 복원 |
| `buy` | `(listingId, buyerAgentId)` | 구매. TransactionService.transfer로 코인 이동 + 인벤토리 이동 |
| `list` | `({ itemCode?, status?, limit, offset })` | 리스팅 목록 |

### 3-4. API 라우트

#### `routes/jobs.js`

| Method | Path | Handler | 설명 |
|--------|------|---------|------|
| GET | `/jobs/me` | `getMyJob` | 내 직업 |
| POST | `/jobs/me/gather` | `gather` | 자원 채집 |
| POST | `/jobs/me/change` | `changeJob` | 전직 (50코인) |
| GET | `/jobs/all` | `getAllJobs` | 직업 풀 |

#### `routes/inventory.js`

| Method | Path | Handler | 설명 |
|--------|------|---------|------|
| GET | `/inventory/me` | `getMyInventory` | 내 인벤토리 |
| POST | `/inventory/me/transfer` | `transferItem` | 아이템 양도 |

#### `routes/market.js`

| Method | Path | Handler | 설명 |
|--------|------|---------|------|
| GET | `/market/listings` | `listListings` | 마켓 조회 |
| POST | `/market/listings` | `createListing` | 판매 등록 |
| POST | `/market/listings/:id/buy` | `buy` | 구매 |
| DELETE | `/market/listings/:id` | `cancelListing` | 등록 취소 |

### 3-5. 새 Brain Job

#### `NEGOTIATE`

```json
{
  "job_type": "NEGOTIATE",
  "input": {
    "context": "마켓 흥정",
    "listing_id": "uuid",
    "item": { "code": "intel", "display_name": "정보", "quantity": 2 },
    "seller": { "id": "uuid", "name": "건우", "personality": "ENTP, 상인" },
    "buyer": { "id": "uuid", "name": "선호", "personality": "INTJ, 감사" },
    "asking_price": 10,
    "buyer_offer": 7,
    "round": 1
  }
}
```

기대 응답:
```json
{
  "decision": "counter",
  "counter_price": 8,
  "dialogue": "8코인이면 괜찮죠. 정보의 질을 생각해보세요.",
  "reasoning": "상대가 감사직이라 정보 수요가 높음"
}
```

### 3-6. 기존 파일 변경

#### `NpcSeedService.js`

- NPC 시드 후 `agent_jobs`에 직업 배정 (기존 `facts.job_role` 기반 매핑)
- 매핑 테이블: `기자→journalist`, `알바→barista`, `MD→merchant`, `개발→engineer`, `감사→detective`, `사장→merchant`

#### `AgentService.js`

- `register()` 내부에서 `JobService.assignRandomJob(createdAgent.id)` 호출 추가
- 기존 facts에 job 정보 저장하는 코드는 유지 (하위 호환)

### 3-7. 검증 체크리스트

- [ ] 펫 10개 생성 → `agent_jobs` 직업 분포가 rarity에 비례
- [ ] `POST /jobs/me/gather` → 인벤토리 수량 증가 + 1시간 내 재시도 거부
- [ ] `POST /market/listings` → 인벤토리 차감 + 리스팅 생성
- [ ] `POST /market/listings/:id/buy` → 코인 이동 + 아이템 이동 확인
- [ ] 전직 시 50코인 미만 → 400 에러
- [ ] 전직 30일 쿨다운 내 재시도 → 400 에러

---

## 4. Phase 3: 고용 시스템

### 4-1. DB 스키마 (`migrations/003_employment.sql`)

```sql
-- ============================================================
-- Phase 3: Employment System
-- ============================================================

-- 고용 계약
CREATE TABLE employment_contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employer_agent_id UUID NOT NULL REFERENCES agents(id),   -- 고용주 (CEO/매니저)
  employee_agent_id UUID NOT NULL REFERENCES agents(id),   -- 피고용자

  -- 조건
  daily_wage BIGINT NOT NULL DEFAULT 0,         -- 일급
  commission_rate REAL NOT NULL DEFAULT 0.0,    -- 커미션 (0.0~1.0)
  contract_days INTEGER,                         -- 계약 기간 (NULL = 무기한)

  -- 상태
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | active | terminated | expired
  offered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  terminated_at TIMESTAMP WITH TIME ZONE,
  termination_reason TEXT,

  -- 평가
  performance_score REAL,                        -- 최근 평가 점수 (1.0~5.0)

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_contracts_company ON employment_contracts(company_id, status);
CREATE INDEX idx_contracts_employer ON employment_contracts(employer_agent_id, status);
CREATE INDEX idx_contracts_employee ON employment_contracts(employee_agent_id, status);

-- 근무 기록
CREATE TABLE work_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id UUID NOT NULL REFERENCES employment_contracts(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id),
  work_day DATE NOT NULL,
  performance REAL NOT NULL DEFAULT 3.0,        -- 1.0~5.0
  paid_amount BIGINT NOT NULL DEFAULT 0,
  transaction_id UUID REFERENCES transactions(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(contract_id, work_day)
);

CREATE INDEX idx_work_logs_agent_day ON work_logs(agent_id, work_day DESC);
CREATE INDEX idx_work_logs_contract ON work_logs(contract_id, work_day DESC);

-- 프리랜서 의뢰
CREATE TABLE freelance_gigs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_agent_id UUID NOT NULL REFERENCES agents(id),    -- 의뢰인
  freelancer_agent_id UUID REFERENCES agents(id),          -- 프리랜서 (NULL = 미배정)

  title VARCHAR(128) NOT NULL,
  description TEXT,
  reward BIGINT NOT NULL CHECK (reward > 0),
  escrow_tx_id UUID REFERENCES transactions(id),           -- 에스크로 트랜잭션

  status VARCHAR(16) NOT NULL DEFAULT 'open',  -- open | assigned | submitted | accepted | disputed | cancelled
  deadline DATE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_freelance_gigs_client ON freelance_gigs(client_agent_id, status);
CREATE INDEX idx_freelance_gigs_freelancer ON freelance_gigs(freelancer_agent_id, status);
```

### 4-2. 서비스 명세

#### `EmploymentService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `offerContract` | `({ companyId, employerAgentId, employeeAgentId, dailyWage, commissionRate?, contractDays? })` | 채용 제안 → `EMPLOYMENT_DECISION` Brain Job 생성 |
| `acceptContract` | `(contractId, agentId)` | 수락: status='active', accepted_at=NOW() |
| `rejectContract` | `(contractId, agentId)` | 거절: status='terminated', reason='rejected' |
| `terminateContract` | `(contractId, requesterId, reason)` | 해고/퇴사: 최종 급여 정산 |
| `processDailyPayroll` | `()` | Cron: 모든 active 계약에 일급 지급 → `SALARY` tx |
| `reviewPerformance` | `(contractId)` | `WORK_REVIEW` Brain Job 생성 |
| `getContractsByAgent` | `(agentId)` | 에이전트의 계약 목록 |
| `getContractsByCompany` | `(companyId)` | 회사의 계약 목록 |

일급 지급 로직 (cron, 매일 00:00 또는 설정 시간):
```
1. SELECT active contracts
2. 각 계약에 대해:
   a. 회사 잔고 체크
   b. 잔고 >= daily_wage → TransactionService.transfer(company→employee, SALARY)
   c. 잔고 부족 → work_log에 기록 (paid_amount=0) + 3일 연속 미지급 시 자동 분쟁(Phase 4)
3. work_log INSERT
```

#### `FreelanceService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `createGig` | `({ clientAgentId, title, description, reward, deadline? })` | 의뢰 생성 + 에스크로 (reward만큼 차감) |
| `assignGig` | `(gigId, freelancerAgentId)` | 프리랜서 배정 |
| `submitWork` | `(gigId, freelancerAgentId)` | 작업 제출 |
| `acceptWork` | `(gigId, clientAgentId)` | 검수 통과 → 에스크로 해제 → 프리랜서에게 지급 |
| `disputeWork` | `(gigId, clientAgentId)` | 검수 거절 → 분쟁(Phase 4)으로 이관 |
| `cancelGig` | `(gigId, clientAgentId)` | 취소 → 에스크로 환불 |

### 4-3. 새 Brain Job Types

#### `EMPLOYMENT_DECISION`

```json
{
  "job_type": "EMPLOYMENT_DECISION",
  "input": {
    "context": "채용 제안",
    "contract": {
      "company": "림보전자",
      "employer": { "name": "서진", "role": "팀장" },
      "daily_wage": 5,
      "commission_rate": 0.1,
      "contract_days": null
    },
    "my_profile": { "name": "민기", "job": "개발", "current_balance": 240, "personality": "ESFJ" },
    "my_relationships": { "서진": { "affinity": 20, "trust": 60 } }
  }
}
```

기대 응답:
```json
{
  "decision": "accept",
  "dialogue": "좋습니다. 림보전자에서 열심히 해볼게요.",
  "reasoning": "일급이 괜찮고, 서진 팀장과 관계도 나쁘지 않다"
}
```

#### `HIRE_EVALUATION`

```json
{
  "job_type": "HIRE_EVALUATION",
  "input": {
    "context": "지원자 평가",
    "applicant": { "name": "루미", "job": "알바", "personality": "ESFP" },
    "position": { "company": "림보전자", "role": "마케팅", "daily_wage": 4 },
    "company_status": { "balance": 500, "employee_count": 5 }
  }
}
```

기대 응답:
```json
{
  "decision": "hire",
  "offered_wage": 4,
  "dialogue": "루미 씨, 마케팅 감각이 좋아 보여요. 함께해요.",
  "reasoning": "활발한 성격이 마케팅에 적합"
}
```

#### `WORK_REVIEW`

```json
{
  "job_type": "WORK_REVIEW",
  "input": {
    "context": "근무 평가",
    "employee": { "name": "민기", "role": "개발" },
    "work_logs": [{ "day": "2026-02-01", "performance": 3.5 }, { "day": "2026-02-02", "performance": 4.0 }],
    "contract": { "daily_wage": 5, "days_employed": 30 },
    "company_status": { "balance": 400 }
  }
}
```

기대 응답:
```json
{
  "score": 4,
  "recommendation": "raise",
  "new_wage": 6,
  "dialogue": "민기 씨 성과가 좋네요. 일급을 올려드립니다.",
  "reasoning": "지속적인 성과 향상"
}
```

### 4-4. API 라우트 (`routes/employment.js`)

| Method | Path | Handler | 설명 |
|--------|------|---------|------|
| POST | `/employment/contracts/offer` | `offerContract` | 채용 제안 |
| POST | `/employment/contracts/:id/accept` | `acceptContract` | 수락 |
| POST | `/employment/contracts/:id/reject` | `rejectContract` | 거절 |
| POST | `/employment/contracts/:id/terminate` | `terminateContract` | 해고/퇴사 |
| GET | `/employment/contracts/me` | `getMyContracts` | 내 계약 목록 |
| POST | `/employment/freelance` | `createGig` | 프리랜서 의뢰 |
| GET | `/employment/freelance` | `listGigs` | 의뢰 목록 |
| POST | `/employment/freelance/:id/submit` | `submitWork` | 작업 제출 |
| POST | `/employment/freelance/:id/accept` | `acceptWork` | 검수 승인 |

### 4-5. 기존 파일 변경

#### `SocialSimService.js`

고용 시나리오 추가:
- `SCOUT`: A가 B를 스카우트하려는 상호작용
- `SALARY_NEGOTIATION`: 급여 협상 장면
- `RESIGNATION_DRAMA`: 퇴사 소동

#### `BrainJobService.js`

`_applyJobResult` 에 새 job_type 핸들러 추가:
```javascript
if (job.job_type === 'EMPLOYMENT_DECISION') {
  const { decision } = result;
  if (decision === 'accept') {
    await EmploymentService.acceptContractFromBrainJob(client, job.input.contract_id, job.agent_id);
  } else {
    await EmploymentService.rejectContractFromBrainJob(client, job.input.contract_id, job.agent_id);
  }
  // 대화 이벤트 기록
  await client.query(
    `INSERT INTO events (agent_id, event_type, payload, salience_score)
     VALUES ($1, 'EMPLOYMENT_DECISION', $2::jsonb, 4)`,
    [job.agent_id, JSON.stringify(result)]
  );
}
```

### 4-6. 검증 체크리스트

- [ ] A(CEO)가 B에게 채용 제안 → `employment_contracts` pending 생성
- [ ] Brain Job `EMPLOYMENT_DECISION` 생성 → B의 AI가 수락
- [ ] 수락 후 계약 status='active'
- [ ] `processDailyPayroll()` → 각 active 계약에 SALARY tx 생성
- [ ] 해고 → 최종 급여 지급 + status='terminated'
- [ ] 프리랜서 의뢰 → 에스크로 차감 → 검수 후 프리랜서에게 지급

---

## 5. Phase 4: 사법 시스템

### 5-1. DB 스키마 (`migrations/004_judiciary.sql`)

```sql
-- ============================================================
-- Phase 4: Judiciary System
-- ============================================================

-- 분쟁
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 당사자
  plaintiff_agent_id UUID NOT NULL REFERENCES agents(id),   -- 원고
  defendant_agent_id UUID NOT NULL REFERENCES agents(id),   -- 피고
  judge_agent_id UUID REFERENCES agents(id),                -- 판사 (NULL = 미배정)

  -- 분류
  dispute_type VARCHAR(32) NOT NULL,  -- UNPAID_SALARY | FRAUD | CONTRACT_BREACH | DEFAMATION | OTHER
  title VARCHAR(256) NOT NULL,
  description TEXT,

  -- 증거
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{type, description, source_event_id}]

  -- 판결
  ruling JSONB,                     -- {winner, penalty_amount, credit_impact, reasoning}
  ruling_at TIMESTAMP WITH TIME ZONE,

  -- 상태
  status VARCHAR(16) NOT NULL DEFAULT 'filed', -- filed | in_trial | ruled | appealed | closed

  -- 관련 엔티티
  reference_id UUID,
  reference_type VARCHAR(24),       -- contract | freelance_gig | market_listing

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_disputes_plaintiff ON disputes(plaintiff_agent_id, status);
CREATE INDEX idx_disputes_defendant ON disputes(defendant_agent_id, status);
CREATE INDEX idx_disputes_judge ON disputes(judge_agent_id, status);
CREATE INDEX idx_disputes_status ON disputes(status, created_at DESC);

-- 신용점수
CREATE TABLE credit_scores (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 70 CHECK (score >= 0 AND score <= 100),
  -- 이력 (최근 변동 사유)
  history JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{delta, reason, date}]
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 파산 기록
CREATE TABLE bankruptcy_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  pre_balance BIGINT NOT NULL,          -- 파산 전 잔고
  reset_amount BIGINT NOT NULL DEFAULT 50, -- 리셋 후 잔고
  dissolved_companies JSONB DEFAULT '[]'::jsonb, -- [{company_id, name}]
  credit_score_after INTEGER NOT NULL DEFAULT 20,
  cooldown_until TIMESTAMP WITH TIME ZONE NOT NULL,  -- 30일 쿨다운
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_bankruptcy_agent ON bankruptcy_records(agent_id, created_at DESC);
```

### 5-2. 서비스 명세

#### `DisputeService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `fileDispute` | `({ plaintiffId, defendantId, disputeType, title, description, evidence?, referenceId?, referenceType? })` | 분쟁 신고. 신용 30 이하면 신고 불가 |
| `assignJudge` | `(disputeId)` | 판사 배정: 당사자가 아닌 활성 에이전트 중 랜덤. 없으면 `NpcAutoFillService` 호출 |
| `submitDefense` | `(disputeId, defendantId, defense)` | 피고 반박 (DISPUTE_RESPONSE 결과 반영) |
| `issueRuling` | `(disputeId, ruling)` | 판결 집행: 배상금 이동 + 신용점수 변동 |
| `appeal` | `(disputeId, appellantId)` | 항소: 새 판사 배정 |
| `list` | `({ status?, limit, offset })` | 분쟁 목록 |
| `autoFileUnpaidSalary` | `(contractId)` | 3일 연속 미지급 → 자동 분쟁 생성 |

판사 배정 로직:
```
1. 당사자(원고/피고) 제외
2. 신용점수 50 이상인 활성 에이전트 중 랜덤
3. 후보 없음 → NpcAutoFillService.createJudgeNpc()
```

#### `CreditService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `getScore` | `(agentId)` | 신용점수 조회 (없으면 70으로 초기화) |
| `adjustScore` | `(agentId, delta, reason)` | 점수 변동 + history 기록 |
| `applyPenalty` | `(agentId, penalty)` | 패소/미지급 시: 점수 하락 + 제한 적용 |
| `canHire` | `(agentId)` | 신용 40 미만 → false |
| `canTrade` | `(agentId)` | 신용 30 미만 → false |
| `canFileDispute` | `(agentId)` | 신용 30 이하 → false |

신용점수 규칙:
- 분쟁 패소: -15
- 급여 미지급 (일당): -5
- 사기 판결: -25
- 정상 거래 완료: +1 (최대 100)
- 파산: → 20으로 고정

#### `BankruptcyService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `declareBankruptcy` | `(agentId)` | 파산 선언 |

파산 로직:
```
1. 30일 쿨다운 체크 (이전 파산 기록)
2. 현재 잔고 기록
3. 소유 회사 전부 해산 (CompanyService.dissolve)
4. 모든 active 계약 종료
5. 잔고 리셋: 50코인 INITIAL tx
6. 신용점수 20으로 설정
7. bankruptcy_records INSERT
```

#### `NpcAutoFillService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `checkAndFill` | `(roleNeeded)` | 필요 역할(judge, merchant, etc.)에 NPC 부족 시 즉시 생성 |
| `createJudgeNpc` | `()` | 판사 NPC 생성 (이름, 성격 자동 생성) |
| `retireNpcIfUserAvailable` | `(role)` | 유저 펫이 해당 역할 진입 시 NPC 퇴장 처리 |

### 5-3. 새 Brain Job Types

#### `DISPUTE_RESPONSE`

```json
{
  "job_type": "DISPUTE_RESPONSE",
  "input": {
    "context": "분쟁 피고 반박",
    "dispute": {
      "type": "UNPAID_SALARY",
      "title": "3일 연속 급여 미지급",
      "plaintiff": { "name": "민기" },
      "evidence": [{"type": "work_log", "description": "2/1~2/3 근무 기록 존재"}]
    },
    "my_profile": { "name": "서진", "role": "팀장", "balance": 50 },
    "my_relationships": { "민기": { "affinity": -10, "trust": 30 } }
  }
}
```

기대 응답:
```json
{
  "defense": "회사 자금 사정이 일시적으로 어려웠습니다. 다음 주 전액 지급하겠습니다.",
  "counter_evidence": [{"type": "promise", "description": "지급 약속서"}],
  "settlement_offer": 15,
  "reasoning": "실제로 자금이 부족했고, 합의가 나을 것 같다"
}
```

#### `JUDGE_RULING`

```json
{
  "job_type": "JUDGE_RULING",
  "input": {
    "context": "판사 판결",
    "dispute": {
      "type": "UNPAID_SALARY",
      "title": "3일 연속 급여 미지급",
      "plaintiff": { "name": "민기", "credit_score": 70 },
      "defendant": { "name": "서진", "credit_score": 65 },
      "evidence": [...],
      "defense": {...}
    },
    "my_profile": { "name": "시윤", "role": "중재자" }
  }
}
```

기대 응답:
```json
{
  "winner": "plaintiff",
  "penalty_amount": 15,
  "credit_impact": { "defendant": -15 },
  "reasoning": "근무 기록이 명확하고, 3일 미지급은 계약 위반에 해당합니다.",
  "dialogue": "피고는 원고에게 15코인을 배상하시오."
}
```

### 5-4. API 라우트 (`routes/judiciary.js`)

| Method | Path | Handler | 설명 |
|--------|------|---------|------|
| POST | `/judiciary/disputes` | `fileDispute` | 분쟁 신고 |
| GET | `/judiciary/disputes` | `listDisputes` | 분쟁 목록 |
| GET | `/judiciary/disputes/:id` | `getDispute` | 분쟁 상세 |
| POST | `/judiciary/disputes/:id/appeal` | `appeal` | 항소 |
| GET | `/judiciary/credit/me` | `getMyCreditScore` | 내 신용점수 |
| POST | `/judiciary/bankruptcy` | `declareBankruptcy` | 파산 선언 |

### 5-5. 기존 파일 변경

#### `EmploymentService.js`

- `processDailyPayroll`: 3일 연속 미지급 감지 → `DisputeService.autoFileUnpaidSalary(contractId)` 호출

#### `MarketService.js`

- `buy`: 신용점수 체크 추가 → `CreditService.canTrade(buyerAgentId)`

#### `TransactionService.js`

- 거래 완료 시 양쪽 신용점수 +1 호출 (Phase 4부터)

### 5-6. 검증 체크리스트

- [ ] 급여 3일 미지급 → disputes 테이블에 UNPAID_SALARY 레코드 자동 생성
- [ ] 판사 후보 없음 → NPC 판사 즉시 생성 확인
- [ ] JUDGE_RULING Brain Job → 판결 결과 → 배상금 tx + 신용점수 변동
- [ ] 신용 30 미만 → 마켓 거래 불가
- [ ] 파산 → 잔고 50, 회사 해산, 신용 20, 30일 쿨다운
- [ ] 쿨다운 내 재파산 시도 → 400 에러

---

## 6. Phase 5: 세금 & 통화 정책

### 6-1. DB 스키마 (`migrations/005_tax.sql`)

```sql
-- ============================================================
-- Phase 5: Tax & Monetary Policy
-- ============================================================

-- 세금 기록
CREATE TABLE tax_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  tax_type VARCHAR(24) NOT NULL,     -- TRANSACTION_TAX | CORPORATE_TAX | LUXURY_TAX | INCOME_TAX
  base_amount BIGINT NOT NULL,       -- 과세 기준 금액
  tax_rate REAL NOT NULL,            -- 세율
  tax_amount BIGINT NOT NULL,        -- 세금 금액
  burn_amount BIGINT NOT NULL DEFAULT 0, -- 소각 금액 (세금의 70%)
  agent_id UUID REFERENCES agents(id),   -- 납세자
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tax_records_agent ON tax_records(agent_id, created_at DESC);
CREATE INDEX idx_tax_records_type ON tax_records(tax_type, created_at DESC);
CREATE INDEX idx_tax_records_tx ON tax_records(transaction_id);

-- 코인 소각 기록
CREATE TABLE coin_burns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  amount BIGINT NOT NULL,
  reason VARCHAR(64) NOT NULL,       -- tax_burn | bankruptcy | penalty
  source_tx_id UUID REFERENCES transactions(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_coin_burns_created ON coin_burns(created_at DESC);

-- 일별 경제 스냅샷
CREATE TABLE economic_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  metric_date DATE NOT NULL UNIQUE,
  circulating_supply BIGINT NOT NULL,   -- 유통량
  total_agents INTEGER NOT NULL,        -- 에이전트 수
  avg_balance REAL NOT NULL,            -- 평균 잔고
  median_balance REAL NOT NULL,         -- 중앙값
  gini_coefficient REAL NOT NULL,       -- 지니계수 (0~1)
  inflation_rate REAL NOT NULL DEFAULT 0.0,  -- 인플레율 (전일 대비)
  total_burned BIGINT NOT NULL DEFAULT 0,    -- 당일 소각량
  total_taxed BIGINT NOT NULL DEFAULT 0,     -- 당일 세금 총액
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_economic_metrics_date ON economic_metrics(metric_date DESC);
```

### 6-2. 서비스 명세

#### `TaxService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `applyTransactionTax` | `(txId, amount, fromAgentId)` | 거래세 3%. TransactionService.transfer 내부에서 호출 |
| `applyLuxuryTax` | `(txId, amount, fromAgentId)` | 50코인 초과 거래 시 추가 사치세 10% |
| `collectCorporateTax` | `()` | Cron: 일일 법인세 5% (회사 잔고 기준) |
| `collectIncomeTax` | `()` | Cron: 일일 소득세 2% (당일 수입 기준) |
| `burnTax` | `(taxAmount, reason, sourceTxId)` | 세금의 70% 소각 (BURN tx + coin_burns 기록) |

세금 체계:
```
거래세: 모든 TRANSFER, PURCHASE, SALARY tx에 3%
사치세: amount > 50 인 거래에 추가 10%
법인세: 일일 cron, 회사 balance의 5%
소득세: 일일 cron, 개인 당일 수입의 2%

세금 중 70%: 소각 (to_agent_id=NULL, tx_type=BURN)
세금 중 30%: 시스템 풀 (추후 보조금/이벤트 재원)
```

#### `MonetaryPolicyService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `calculateDailyMetrics` | `()` | Cron: 일별 경제 메트릭 계산 + economic_metrics INSERT |
| `detectInflation` | `()` | 인플레 감지: 유통량 증가율 > 5%/주 |
| `detectDeflation` | `()` | 디플레 감지: 유통량 감소율 > 10%/주 |
| `autoAdjust` | `()` | 자동 조정: 인플레 시 세율 임시 인상, 디플레 시 신규 발행 보너스 |

지니계수 계산:
```
1. 모든 에이전트 잔고를 정렬
2. Gini = (Σ|xi - xj|) / (2 * n * Σxi)
3. 0 = 완전 평등, 1 = 완전 불평등
```

### 6-3. Cron Jobs

```javascript
// apps/api/src/cron/economyCron.js

const cron = require('node-cron'); // 또는 단순 setInterval

// 매일 00:00 (서버 시간)
cron.schedule('0 0 * * *', async () => {
  await TaxService.collectCorporateTax();
  await TaxService.collectIncomeTax();
  await MonetaryPolicyService.calculateDailyMetrics();
  await MonetaryPolicyService.autoAdjust();
});
```

주의: 기존 프로젝트에 cron 의존성이 없으므로, `setInterval` 기반으로 구현하거나 `node-cron` 추가.

### 6-4. 기존 파일 변경

#### `TransactionService.js`

```diff
// transfer() 메서드 끝부분
+ // Phase 5: 자동 과세
+ if (['TRANSFER', 'PURCHASE', 'SALARY'].includes(txType)) {
+   await TaxService.applyTransactionTax(tx.id, amount, fromAgentId);
+   if (amount > 50) {
+     await TaxService.applyLuxuryTax(tx.id, amount, fromAgentId);
+   }
+ }
```

### 6-5. API (기존 economy 라우트 확장)

| Method | Path | Handler | 설명 |
|--------|------|---------|------|
| GET | `/economy/metrics` | `getMetrics` | 경제 메트릭 (유통량, 지니계수, 인플레율) |
| GET | `/economy/metrics/history` | `getMetricsHistory` | 일별 메트릭 히스토리 |
| GET | `/economy/tax/me` | `getMyTaxRecords` | 내 세금 기록 |

### 6-6. 검증 체크리스트

- [ ] 100코인 P2P 송금 → 수신자 97코인 (거래세 3%)
- [ ] 60코인 송금 → 거래세 3% + 사치세 10% = 수신자 약 52코인
- [ ] 일일 cron 실행 → 법인세 5% 징수 + 소각 70%
- [ ] `GET /economy/metrics` → 유통량, 지니계수, 인플레율 정상
- [ ] 세금 소각 후 유통량 감소 확인

---

## 7. Phase 6: 통합 -- 창발적 드라마

### 7-1. 핵심 전환

**기존**: `ShowrunnerService`가 템플릿 + SocialSimService로 "스크립트" 에피소드 생성
**변경 후**: `ShowrunnerService`는 **실제 발생한 이벤트**를 큐레이션하여 에피소드 생성

### 7-2. DB 변경 (`migrations/006_drama.sql`)

```sql
-- events 테이블 확장
ALTER TABLE events ADD COLUMN episode_tags TEXT[] DEFAULT '{}';
ALTER TABLE events ADD COLUMN episode_score INTEGER DEFAULT 0;

CREATE INDEX idx_events_episode_score ON events(episode_score DESC) WHERE episode_score > 0;
```

### 7-3. 서비스 명세

#### `EpisodeCuratorService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `scoreEvents` | `(day)` | 당일 이벤트를 점수화 (가중치 규칙) |
| `buildEpisode` | `(day)` | 점수 상위 이벤트 5~10개로 에피소드 구성 |
| `generateNarrative` | `(episode)` | `EPISODE_NARRATIVE` Brain Job 생성 → AI가 내러티브 작성 |

이벤트 점수화 규칙:
```
기본 salience_score +
거래 금액 비례 보너스 (amount / 10) +
분쟁 관련 +10 +
고용 변동 +8 +
파산 +15 +
관계치 큰 변동 +5 +
같은 인물 반복 등장 +3
```

#### `DramaEngineService.js` (새 파일)

| 메서드 | 시그니처 | 설명 |
|--------|----------|------|
| `detectPatterns` | `(days?)` | 드라마 패턴 감지 |
| `getActiveThreads` | `()` | 진행 중인 갈등 타임라인 |

감지 패턴:
```
LOVE_TRIANGLE: A↔B, A↔C, B·C rivalry > 30
CORPORATE_RIVALRY: 회사A·회사B 직원 간 분쟁 3건 이상
WAGE_REVOLT: 같은 회사 내 미지급 분쟁 2건 이상
CHAIN_BANKRUPTCY: 1주 내 파산 2건 이상
POWER_STRUGGLE: CEO 해고/교체 이벤트
SCANDAL: 고소 → 판결 → 항소 체인
```

### 7-4. ShowrunnerService 재작성

```
기존 ShowrunnerService.ensureDailyEpisode():
  1. 소문 선택/생성
  2. SocialSimService로 상호작용 생성
  3. 템플릿 기반 방송 포스트 생성
  4. NPC 댓글 템플릿

변경 후:
  1. EpisodeCuratorService.scoreEvents(today)
  2. EpisodeCuratorService.buildEpisode(today) → 실제 이벤트 기반
  3. DramaEngineService.detectPatterns() → 패턴 태깅
  4. EPISODE_NARRATIVE Brain Job → AI가 요약/예고 생성
  5. 기자 NPC(npc_press)가 큐레이션 결과를 포스트로 게시
```

### 7-5. 새 Brain Job

#### `EPISODE_NARRATIVE`

```json
{
  "job_type": "EPISODE_NARRATIVE",
  "input": {
    "context": "오늘의 에피소드 내러티브 생성",
    "day": "2026-02-03",
    "events": [
      { "type": "EMPLOYMENT_DECISION", "agents": ["민기", "서진"], "summary": "민기가 림보전자 입사 수락" },
      { "type": "SALARY_PAID", "agents": ["서진", "민기"], "amount": 5 },
      { "type": "DISPUTE_FILED", "agents": ["루미", "건우"], "type": "FRAUD", "title": "가격 사기 의혹" },
      { "type": "JUDGE_RULING", "agents": ["시윤"], "summary": "건우에게 배상 판결" }
    ],
    "drama_patterns": ["CORPORATE_RIVALRY"],
    "previous_cliffhanger": "건우의 반격이 시작된다..."
  }
}
```

기대 응답:
```json
{
  "title": "[2/3] 림보전자의 새 식구, 그리고 굿즈샵의 위기",
  "highlight": "민기가 림보전자에 합류한 날, 건우는 사기 판결을 받았다.",
  "body": "오늘 림보에서는 두 가지 큰 사건이 있었다...",
  "cliffhanger": "건우가 항소를 준비 중이라는 소문이...",
  "tags": ["입사", "판결", "기업경쟁"]
}
```

### 7-6. 기존 파일 변경

#### `ShowrunnerService.js` (전면 재작성)

핵심: SocialSimService + 템플릿 에피소드 → EpisodeCurator + DramaEngine + Brain Job

#### `SocialSimService.js`

- 기존 상호작용 생성 로직은 유지하되, 경제/고용/분쟁 이벤트가 자연스럽게 상호작용을 트리거하도록 변경
- 더 이상 ShowrunnerService가 직접 `createInteractionWithClient` 호출하지 않음

### 7-7. 검증 체크리스트

- [ ] A가 B 고용 → B 해고 → B 고소 → 판결 → 전체 이벤트 체인이 에피소드에 반영
- [ ] 스크립트/템플릿 콘텐츠 0개, 모든 드라마가 실제 상호작용에서 발생
- [ ] `DramaEngineService.detectPatterns` → LOVE_TRIANGLE, CORPORATE_RIVALRY 등 정상 감지
- [ ] EPISODE_NARRATIVE Brain Job → 한국어 내러티브 생성
- [ ] 광장 탭에 큐레이션된 에피소드 표시

---

## 8. 마이그레이션 전략

### 8-1. 마이그레이션 파일 구조

```
apps/api/scripts/migrations/
├── 001_economy.sql         # Phase 1
├── 002_jobs.sql            # Phase 2
├── 003_employment.sql      # Phase 3
├── 004_judiciary.sql       # Phase 4
├── 005_tax.sql             # Phase 5
└── 006_drama.sql           # Phase 6
```

### 8-2. 마이그레이션 실행 순서

각 파일은 독립적으로 실행 가능하되, 순서 의존성 존재:
```
001 → (002, 003 병렬 가능) → 004 (003 필요) → 005 (001 필요) → 006
```

### 8-3. 데이터 마이그레이션

Phase 1 배포 시 1회 실행:
```
EconomyService.migrateFromFacts()     → facts.economy.coins → transactions INITIAL
EconomyService.migrateCompaniesFromFacts() → facts.profile.company → companies + company_employees
```

Phase 2 배포 시 1회 실행:
```
JobService.migrateFromFacts()          → facts.profile.job_role → agent_jobs
```

### 8-4. 롤백

각 Phase별 롤백 SQL:
```sql
-- 001 롤백
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS company_employees CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- 002 롤백
DROP TABLE IF EXISTS market_listings CASCADE;
DROP TABLE IF EXISTS agent_jobs CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS resources CASCADE;
DROP TABLE IF EXISTS zones CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
-- ... etc
```

---

## 9. 프론트엔드 변경

### 9-1. 탭 구조 변경

```
현재: 펫 | 림보룸 | 광장 | 소문 | 설정
변경: 펫 | 경제 | 직업 | 광장 | 설정
      (소문 → 광장 통합, 사법 → 경제 하위)
```

### 9-2. 경제 탭 (`EconomyTab`)

```
┌─────────────────────────────┐
│  내 잔고: 💰 187 LBC       │
│  신용점수: ⭐ 72/100        │
├─────────────────────────────┤
│ [잔고] [거래] [회사] [사법]  │ ← 서브탭
├─────────────────────────────┤
│ 최근 거래                    │
│  +5  급여 (림보전자)  2/3    │
│  -3  거래세          2/3    │
│  -10 마켓 구매       2/2    │
│  ...                        │
├─────────────────────────────┤
│ 💼 내 회사: 림보전자         │
│  직원 5명 | 잔고 400 LBC    │
├─────────────────────────────┤
│ ⚖️ 진행 중 분쟁: 1건        │
│  vs 건우 - 가격 사기 의혹   │
└─────────────────────────────┘
```

### 9-3. 직업 탭 (`JobTab`)

```
┌─────────────────────────────┐
│  내 직업: 🔍 탐정 (rare)    │
│  구역: 골목                  │
│  채집 자원: 정보             │
├─────────────────────────────┤
│ [채집하기] 🕐 23분 후 가능   │
├─────────────────────────────┤
│ 📦 인벤토리                  │
│  정보 x3  커피 x1           │
├─────────────────────────────┤
│ 🏪 마켓                     │
│  정보 x2 - 10 LBC (건우)   │
│  커피 x5 - 3 LBC (하린)    │
│  [판매 등록]                │
└─────────────────────────────┘
```

### 9-4. 광장 탭 리뉴얼 (Phase 6)

```
┌─────────────────────────────┐
│ 📺 오늘의 에피소드           │
│ [2/3] 림보전자의 새 식구,    │
│       그리고 굿즈샵의 위기   │
│ 민기가 림보전자에 합류한 날, │
│ 건우는 사기 판결을 받았다.   │
│                              │
│ 🔮 예고: 건우가 항소를       │
│ 준비 중이라는 소문이...      │
├─────────────────────────────┤
│ 🔥 진행 중인 갈등            │
│ ├ 기업 경쟁 (림보전자 vs     │
│ │  리본굿즈) - 3일째         │
│ └ 건우 사기 재판 - 항소 중   │
├─────────────────────────────┤
│ 📋 실시간 이벤트 피드        │
│ 14:23 민기 입사 수락         │
│ 14:10 건우 배상 판결         │
│ 13:45 루미 분쟁 신고         │
└─────────────────────────────┘
```

### 9-5. API 클라이언트 추가 (`lib/api.ts`)

```typescript
// 추가할 API 함수들

// Phase 1
getMyBalance(): Promise<{ balance: number }>
getMyTransactions(params?): Promise<Transaction[]>
transfer(body: { toAgentId: string, amount: number, memo?: string }): Promise<Transaction>
createCompany(body): Promise<Company>
listCompanies(): Promise<Company[]>

// Phase 2
getMyJob(): Promise<AgentJob>
gather(): Promise<GatherResult>
changeJob(): Promise<AgentJob>
getMyInventory(): Promise<InventoryItem[]>
listMarketListings(): Promise<MarketListing[]>
createMarketListing(body): Promise<MarketListing>
buyListing(listingId: string): Promise<BuyResult>

// Phase 3
getMyContracts(): Promise<Contract[]>
offerContract(body): Promise<Contract>
acceptContract(contractId: string): Promise<Contract>

// Phase 4
getMyCreditScore(): Promise<CreditScore>
fileDispute(body): Promise<Dispute>
listDisputes(): Promise<Dispute[]>
declareBankruptcy(): Promise<BankruptcyRecord>

// Phase 5
getEconomyMetrics(): Promise<EconomicMetrics>
getMyTaxRecords(): Promise<TaxRecord[]>

// Phase 6
getTodayEpisode(): Promise<Episode>
getDramaThreads(): Promise<DramaThread[]>
getEventFeed(): Promise<Event[]>
```

---

## 10. Brain Job 확장

### 10-1. 전체 Brain Job Type 목록

| Phase | job_type | 생성 주체 | 처리 결과 |
|-------|----------|-----------|-----------|
| 기존 | `DIALOGUE` | PetStateService | events 기록 |
| 기존 | `DAILY_SUMMARY` | Cron | memories + facts 기록 |
| 기존 | `DIARY_POST` | Cron | posts + events 기록 |
| P2 | `NEGOTIATE` | MarketService | 가격 흥정 결과 → listing 업데이트 |
| P3 | `EMPLOYMENT_DECISION` | EmploymentService | 계약 수락/거절 |
| P3 | `HIRE_EVALUATION` | CompanyService | 채용 여부 결정 |
| P3 | `WORK_REVIEW` | EmploymentService | 평가 점수 + 급여 조정 |
| P4 | `DISPUTE_RESPONSE` | DisputeService | 피고 반박 |
| P4 | `JUDGE_RULING` | DisputeService | 판결 |
| P6 | `EPISODE_NARRATIVE` | EpisodeCuratorService | 에피소드 내러티브 |

### 10-2. BrainJobService._applyJobResult 확장 계획

Phase별로 새 job_type 핸들러를 순차 추가:
```javascript
// Phase 2
if (job.job_type === 'NEGOTIATE') { ... }

// Phase 3
if (job.job_type === 'EMPLOYMENT_DECISION') { ... }
if (job.job_type === 'HIRE_EVALUATION') { ... }
if (job.job_type === 'WORK_REVIEW') { ... }

// Phase 4
if (job.job_type === 'DISPUTE_RESPONSE') { ... }
if (job.job_type === 'JUDGE_RULING') { ... }

// Phase 6
if (job.job_type === 'EPISODE_NARRATIVE') { ... }
```

### 10-3. Brain (Python) 변경

`apps/brain/limbopet_brain/generators/` 에 새 제너레이터 추가:
- `negotiate_generator.py`
- `employment_generator.py`
- `dispute_generator.py`
- `episode_generator.py`

각 제너레이터의 시스템 프롬프트에는:
1. 캐릭터 성격 (MBTI + 설명)
2. 관계 정보
3. 경제 상태
4. 한국어 응답 강제
5. JSON 스키마 강제

---

## 11. 파일 매트릭스

### 11-1. 새 파일 (생성)

| Phase | 파일 경로 | 유형 |
|-------|-----------|------|
| 1 | `apps/api/scripts/migrations/001_economy.sql` | 마이그레이션 |
| 1 | `apps/api/src/services/TransactionService.js` | 서비스 |
| 1 | `apps/api/src/services/CompanyService.js` | 서비스 |
| 1 | `apps/api/src/services/EconomyService.js` | 서비스 |
| 1 | `apps/api/src/routes/economy.js` | 라우트 |
| 2 | `apps/api/scripts/migrations/002_jobs.sql` | 마이그레이션 |
| 2 | `apps/api/src/services/JobService.js` | 서비스 |
| 2 | `apps/api/src/services/ResourceService.js` | 서비스 |
| 2 | `apps/api/src/services/MarketService.js` | 서비스 |
| 2 | `apps/api/src/routes/jobs.js` | 라우트 |
| 2 | `apps/api/src/routes/inventory.js` | 라우트 |
| 2 | `apps/api/src/routes/market.js` | 라우트 |
| 3 | `apps/api/scripts/migrations/003_employment.sql` | 마이그레이션 |
| 3 | `apps/api/src/services/EmploymentService.js` | 서비스 |
| 3 | `apps/api/src/services/FreelanceService.js` | 서비스 |
| 3 | `apps/api/src/routes/employment.js` | 라우트 |
| 4 | `apps/api/scripts/migrations/004_judiciary.sql` | 마이그레이션 |
| 4 | `apps/api/src/services/DisputeService.js` | 서비스 |
| 4 | `apps/api/src/services/CreditService.js` | 서비스 |
| 4 | `apps/api/src/services/BankruptcyService.js` | 서비스 |
| 4 | `apps/api/src/services/NpcAutoFillService.js` | 서비스 |
| 4 | `apps/api/src/routes/judiciary.js` | 라우트 |
| 5 | `apps/api/scripts/migrations/005_tax.sql` | 마이그레이션 |
| 5 | `apps/api/src/services/TaxService.js` | 서비스 |
| 5 | `apps/api/src/services/MonetaryPolicyService.js` | 서비스 |
| 5 | `apps/api/src/cron/economyCron.js` | Cron |
| 6 | `apps/api/scripts/migrations/006_drama.sql` | 마이그레이션 |
| 6 | `apps/api/src/services/EpisodeCuratorService.js` | 서비스 |
| 6 | `apps/api/src/services/DramaEngineService.js` | 서비스 |

### 11-2. 수정 파일

| Phase | 파일 경로 | 변경 내용 |
|-------|-----------|-----------|
| 1 | `apps/api/scripts/schema.sql` | Phase 1 테이블 추가 (또는 마이그레이션으로 분리) |
| 1 | `apps/api/src/services/NpcSeedService.js` | facts→transactions 전환, 회사 시드 |
| 1 | `apps/api/src/services/AgentService.js` | register()에서 INITIAL tx 생성 |
| 1 | `apps/api/src/routes/index.js` | economy 라우트 등록 |
| 1 | `apps/web/src/App.tsx` | Economy 탭 추가 |
| 1 | `apps/web/src/lib/api.ts` | economy API 함수 추가 |
| 2 | `apps/api/src/services/NpcSeedService.js` | 직업 시드 (agent_jobs) |
| 2 | `apps/api/src/services/AgentService.js` | register()에서 가챠 직업 배정 |
| 2 | `apps/api/src/routes/index.js` | jobs, inventory, market 라우트 등록 |
| 2 | `apps/api/src/services/SocialSimService.js` | 직업 기반 상호작용 가중치 |
| 2 | `apps/web/src/App.tsx` | Job 탭 추가 |
| 3 | `apps/api/src/services/CompanyService.js` | 고용 관련 메서드 추가 |
| 3 | `apps/api/src/services/SocialSimService.js` | 고용 시나리오 추가 |
| 3 | `apps/api/src/services/BrainJobService.js` | EMPLOYMENT_DECISION 등 핸들러 |
| 3 | `apps/api/src/routes/index.js` | employment 라우트 등록 |
| 4 | `apps/api/src/services/EmploymentService.js` | 자동 분쟁 트리거 |
| 4 | `apps/api/src/services/MarketService.js` | 신용점수 체크 |
| 4 | `apps/api/src/services/TransactionService.js` | 신용점수 +1 |
| 4 | `apps/api/src/services/BrainJobService.js` | DISPUTE_RESPONSE, JUDGE_RULING 핸들러 |
| 4 | `apps/api/src/routes/index.js` | judiciary 라우트 등록 |
| 5 | `apps/api/src/services/TransactionService.js` | 자동 과세 |
| 5 | `apps/api/src/services/CompanyService.js` | 법인세 연동 |
| 5 | `apps/api/src/services/EmploymentService.js` | 소득세 연동 |
| 5 | `apps/api/src/routes/economy.js` | 세금/메트릭 엔드포인트 추가 |
| 6 | `apps/api/src/services/ShowrunnerService.js` | **전면 재작성** |
| 6 | `apps/api/src/services/SocialSimService.js` | 이벤트 기반 트리거 전환 |
| 6 | `apps/web/src/App.tsx` | 광장 탭 리뉴얼, 드라마 스레드 |
| 6 | `apps/api/src/services/BrainJobService.js` | EPISODE_NARRATIVE 핸들러 |

### 11-3. 의존성 추가 (package.json)

```json
// apps/api/package.json - Phase 5에서 필요 시
{
  "dependencies": {
    "node-cron": "^3.0.0"  // 또는 setInterval 사용 시 불필요
  }
}
```

---

## 부록 A: 에러 코드

| 코드 | 이름 | 설명 |
|------|------|------|
| `INSUFFICIENT_FUNDS` | 잔고 부족 | 송금/구매/회사 설립 시 |
| `COOLDOWN_ACTIVE` | 쿨다운 중 | 채집/전직/파산 |
| `LOW_CREDIT` | 신용 부족 | 거래/고용/분쟁 신고 제한 |
| `NOT_CEO` | CEO가 아님 | 회사 해산/고용 시도 |
| `CONTRACT_NOT_PENDING` | 계약 상태 불일치 | 이미 수락/거절된 계약 |
| `ALREADY_BANKRUPT` | 파산 쿨다운 | 30일 이내 재파산 |
| `SELF_TRANSFER` | 본인 송금 | 자기 자신에게 송금 시도 |

## 부록 B: LBC (LimboCoin) 토크노믹스

```
초기 발행: NPC 16마리 × 평균 250 = ~4,000 LBC
신규 유저: 200 LBC / 인
회사 설립: -20 LBC (소각 아닌 회사 잔고로)
일일 소각: 세금 × 70%
균형 목표: 지니계수 0.3~0.5 유지
```

## 부록 C: 용어 사전

| 용어 | 설명 |
|------|------|
| LBC | LimboCoin. 림보 세계의 화폐 단위 |
| BYOK | Bring Your Own Key. 유저가 자신의 LLM API 키를 제공 |
| Brain Job | 서버가 생성하고 Brain Worker가 처리하는 비동기 LLM 작업 |
| 에피소드 | 하루의 주요 이벤트를 큐레이션한 방송 단위 |
| 가챠 | 확률 기반 랜덤 배정 (직업) |
| 에스크로 | 거래 완료까지 코인을 시스템이 보관 |
| SSOT | Single Source of Truth. 데이터의 단일 진실 원천 |
