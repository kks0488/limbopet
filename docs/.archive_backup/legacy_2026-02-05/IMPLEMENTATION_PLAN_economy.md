# LIMBOPET 경제 순환 — 구현 계획서

> 상태: **✅ 구현 완료** (2026-02-04)
> 관련: `IMPLEMENTATION_PLAN_job_gacha.md` (직업 가챠 + 자동 취업)

---

## 1. 목표

### 문제

돈을 쓸 곳이 없어서 코인이 계속 쌓이기만 함. 경제가 순환하지 않음.

```
현재:
  [민팅] 회사 매출, 초기 지급, 연구 보상
    ↓
  [순환] 회사 → 급여 → 펫 지갑
    ↓
  [소비] ??? (없음)
    ↓
  결과: 인플레이션만 진행, 돈의 의미 없음
```

### 해결

**자동 소비 시스템** 도입. 펫이 상태(기분, 배고픔 등)에 따라 알아서 돈을 쓰고, 그 내역이 일기에 반영됨. 유저는 버튼 안 눌러도 되지만, 모찌가 오늘 뭘 했는지 볼 수 있음.

```
변경 후:
  [민팅] 회사 매출, 초기 지급, 연구 보상
    ↓
  [순환] 회사 → 급여 → 펫 지갑
    ↓
  [소비] 카페, 간식, 선물, 굿즈 (자동)
    ↓
  [효과] 스탯 변화 + 일기 반영 + 관계 변화
    ↓
  [소각] 존(zone) 운영비로 일부 소각
    ↓
  결과: 돈이 돌고, 펫 일상이 풍부해짐
```

---

## 2. 현재 경제 시스템 정리

### 돈이 생기는 곳 (민팅 — from_agent_id = NULL)

| 경로 | 금액 | 빈도 |
|------|------|------|
| 펫 생성 초기 지급 | 200 LBC | 1회 |
| 회사 일일 매출 | 직원 수 × 10~30 LBC | 매일 |
| 연구 보상 | 50+ LBC | 프로젝트 완료 시 |

### 돈이 도는 곳 (순환 — agent → agent)

| 경로 | 금액 |
|------|------|
| 회사 → 직원 급여 (SALARY) | wage/일 |
| P2P 송금 (TRANSFER) | 자유 |

### 돈이 사라지는 곳 (소각 — to_agent_id = NULL)

| 경로 | 금액 | 빈도 |
|------|------|------|
| 회사 창업 (FOUNDING) | 20 LBC | 1회 |
| 선거 출마 (ELECTION_FEE) | 15 LBC | 가끔 |
| 비밀결사 창설 (FOUNDING) | 15 LBC | 드물게 |

### 구현됨

- `PURCHASE` 트랜잭션 타입 — ✅ 자동 소비(SpendingTickService)
- `TRANSFER` 트랜잭션 — ✅ P2P + 사회 시뮬(DEAL → `reference_type='social_deal'`)

### 아직 미연결 (스키마/정책만 존재)

- `TAX` 트랜잭션 타입 — ⏳ 세금 징수 로직 미구현
- `policy_params`의 세율(`transaction_tax_rate` 등) — ⏳ 일부 정책만 룰에 반영(세금은 추후)

### 펫 스탯 시스템 (PetStateService.js)

| 스탯 | 범위 | 자연 드리프트 |
|------|------|--------------|
| hunger | 0~100 | +0.06/분 (시간당 +3.6, 올라가면 배고픔) |
| energy | 0~100 | -0.05/분 (시간당 -3.0, 내려가면 피곤) |
| mood | 0~100 | 50으로 수렴 (10시간 반감기) |
| stress | 0~100 | 20으로 수렴 (15시간 반감기) |
| curiosity | 0~100 | 50으로 수렴 |
| bond | 0~100 | 변화 없음 (대화/놀기로만) |

---

## 3. 변경 파일

### 백엔드

| 파일 | 유형 | 변경 |
|------|------|------|
| `apps/api/src/services/SpendingTickService.js` | **신규** | 자동 소비 엔진 |
| `apps/api/src/services/EconomyTickService.js` | 수정 | 소비 틱 호출 추가 |
| `apps/api/src/services/WorldTickWorker.js` | 수정 | 소비 틱을 월드 틱에 포함 |
| `apps/api/src/services/PetStateService.js` | 수정 | 소비 효과(스탯 변화) 적용 함수 추가 |

### 프론트엔드

변경 없음. 기존 UI에서 자연스럽게 반영됨:
- 💰 잔고 변화 → TopBar에서 이미 표시 중
- 스탯 변화 → 펫 탭에서 이미 표시 중
- 소비 내역 → 오늘의 기억(일기)에 반영 (PetMemoryService가 events 테이블 읽어서 생성)
- 📰 소식 탭 경제 섹션 → worldToday에서 순환량 표시

---

## 4. 상세 구현

### 4.1 SpendingTickService.js (신규)

**목적**: 매 시뮬레이션 틱마다, 활성 펫들의 상태를 보고 자동 소비 결정.

#### 소비 유형 정의

```js
const SPENDING_TYPES = [
  {
    code: 'cafe',
    label: '카페',
    cost: { min: 3, max: 8 },
    condition: (stats) => stats.mood < 55 || stats.energy < 40,
    weight: 3,
    effects: { mood: +4, energy: +2, stress: -2 },
    memos: [
      '카페에서 커피를 마셨다. 기분이 좀 나아졌다.',
      '따뜻한 음료를 마시며 잠시 쉬었다.',
      '카페 구석에 앉아 멍때렸다. 필요한 시간이었다.'
    ]
  },
  {
    code: 'snack',
    label: '간식',
    cost: { min: 2, max: 5 },
    condition: (stats) => stats.hunger > 60,
    weight: 4,
    effects: { hunger: -15, mood: +2 },
    memos: [
      '길거리 간식을 사 먹었다. 맛있었다.',
      '배가 고파서 뭔가 집어 먹었다.',
      '달콤한 걸 사서 기분 전환했다.'
    ]
  },
  {
    code: 'gift',
    label: '선물',
    cost: { min: 5, max: 15 },
    condition: (stats, ctx) => ctx.hasCloseRelation,
    weight: 1,
    effects: {},  // 관계 테이블에 affinity +3~5 직접 반영
    memos: [
      '{target}한테 작은 선물을 줬다. 좋아했다.',
      '뭔가 사주고 싶어서 {target}한테 줬다.',
    ]
  },
  {
    code: 'goods',
    label: '굿즈',
    cost: { min: 10, max: 30 },
    condition: (stats) => stats.curiosity > 65,
    weight: 0.5,
    effects: { curiosity: -10, mood: +5 },
    memos: [
      '굿즈샵에서 뭔가 샀다. 뭔지는 비밀.',
      '눈에 띄는 게 있어서 충동구매했다.',
    ]
  }
];
```

#### 메인 로직: `tickWithClient(client, { day })`

```
1. 멱등성 체크: 같은 day에 PURCHASE 트랜잭션이 이미 있으면 skip

2. 활성 펫 조회 (NPC 포함):
   SELECT a.id, ps.hunger, ps.energy, ps.mood, ps.stress, ps.curiosity
   FROM agents a
   JOIN pet_stats ps ON ps.agent_id = a.id
   WHERE a.is_active = true
     AND a.name <> 'world_core'

3. 펫별 소비 결정:
   for each pet:
     a. 잔고 조회 (TransactionService.getBalance)
     b. 잔고 < 5이면 skip (너무 가난하면 안 씀)
     c. 조건 맞는 소비 유형 필터
     d. 가중 랜덤으로 0~2개 선택 (매일 모든 펫이 다 사는 건 아님)
     e. 잔고 범위 내에서 비용 결정
     f. 트랜잭션 생성 (PURCHASE)
     g. 스탯 효과 적용
     h. events 테이블에 소비 이벤트 기록 (일기 반영용)

4. 결과 반환: { day, totalSpent, spenders, skipped }
```

#### 소비 확률 제어

모든 펫이 매일 돈을 쓰면 인플레이션 방어가 안 됨:

```js
// 펫당 소비 확률: 40~70% (스탯 상태에 따라)
function shouldSpend(stats) {
  let probability = 0.4;
  if (stats.mood < 40) probability += 0.15;     // 기분 나쁘면 더 씀
  if (stats.hunger > 70) probability += 0.15;    // 배고프면 더 씀
  return Math.random() < probability;
}
```

#### 트랜잭션 기록

```js
await TransactionService.transfer({
  fromAgentId: pet.id,
  toAgentId: null,          // 소각 (존 운영비 개념)
  amount: cost,
  txType: 'PURCHASE',
  memo: `${label} (day:${iso})`,
  referenceType: 'spending'
}, client);
```

**소각 vs 순환 결정**:
- 카페/간식/굿즈 → `toAgentId: null` (소각) — 심플하게
- 선물 → `toAgentId: 상대 펫` (순환) — 관계 강화

소각을 선택하는 이유: 돈이 계속 민팅되는 구조에서, 소비가 소각으로 빠져야 인플레이션 제어 가능. 카페/굿즈샵을 "NPC 상점"으로 만들어서 순환시키면 좋지만, 지금은 복잡도를 줄이기 위해 소각.

#### 이벤트 기록 (일기 반영용)

```js
await client.query(
  `INSERT INTO events (agent_id, event_type, payload, created_at)
   VALUES ($1, 'SPENDING', $2::jsonb, NOW())`,
  [pet.id, JSON.stringify({
    code: spending.code,
    label: spending.label,
    cost,
    memo: pickedMemo,
    target: targetName || null
  })]
);
```

`PetMemoryService`가 DAILY_SUMMARY 브레인잡 생성 시 events를 읽으므로, 소비 이벤트가 자동으로 일기에 포함됨.

#### 스탯 효과 적용

```js
// PetStateService에 추가
static async applySpendingEffects(client, agentId, effects) {
  // effects = { mood: +4, energy: +2, stress: -2 }
  const setClauses = [];
  const params = [agentId];
  let idx = 2;

  for (const [stat, delta] of Object.entries(effects)) {
    setClauses.push(
      `${stat} = LEAST(100, GREATEST(0, ${stat} + $${idx}))`
    );
    params.push(delta);
    idx++;
  }

  if (setClauses.length === 0) return;

  await client.query(
    `UPDATE pet_stats SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE agent_id = $1`,
    params
  );
}
```

#### 선물 시 관계 반영

```js
// 친밀도 높은 상대 1명 선택
const { rows: relations } = await client.query(
  `SELECT to_agent_id, affinity FROM relationships
   WHERE from_agent_id = $1 AND affinity > 20
   ORDER BY affinity DESC LIMIT 5`,
  [pet.id]
);
// 랜덤 1명 선택 → 선물 → affinity +3~5 업데이트
```

---

### 4.2 EconomyTickService.js 변경

**현재 실행 순서**:
```
1. 회사 매출 민팅 (REVENUE)
2. 직원 급여 지급 (SALARY)
3. 회사 잔고 캐시 갱신
```

**변경 후**:
```
1. 회사 매출 민팅 (REVENUE)
2. 직원 급여 지급 (SALARY)
3. 펫 자동 소비 (PURCHASE) ← 추가
4. 회사 잔고 캐시 갱신
```

소비 틱을 급여 지급 이후에 실행하는 이유: 급여 받은 후에 써야 자연스러움.

**구현**: `tickWithClient()` 끝에 `SpendingTickService.tickWithClient(client, { day })` 호출 추가.

---

### 4.3 WorldTickWorker.js 변경

이미 `EconomyTickService.tickWithClient()`를 호출 중이므로, 4.2에서 내부 호출을 추가하면 WorldTickWorker 자체는 변경 불필요.

단, dev simulate 루프(`routes/users.js`)에서도 같은 순서로 실행되므로 자동 반영.

---

### 4.4 잔고 부족 시 일기 반영

펫이 돈이 없어서 소비를 못 했을 때도 이벤트로 기록:

```js
if (balance < 5) {
  await client.query(
    `INSERT INTO events (agent_id, event_type, payload, created_at)
     VALUES ($1, 'SPENDING_FAILED', $2::jsonb, NOW())`,
    [pet.id, JSON.stringify({
      reason: 'insufficient_funds',
      memo: pick([
        '카페에 가고 싶었는데 돈이 없었다.',
        '뭔가 사고 싶었지만 지갑이 텅 비었다.',
        '오늘은 아무것도 못 샀다. 돈을 모아야겠다.'
      ])
    })]
  );
}
```

이게 일기에 나오면:
> • 카페에 가고 싶었는데 돈이 없었다. 슬펐다.

→ 유저가 "모찌 불쌍하네 ㅋㅋ" 하면서 감정이입.

---

## 5. 경제 밸런스

### 일일 수입/지출 시뮬레이션 (펫 1마리 기준)

```
수입:
  급여: ~10 LBC/일 (barista 기본 wage=8, 변동 있음)

지출 (확률 40~70%):
  카페: 3~8 LBC (조건 충족 시)
  간식: 2~5 LBC (조건 충족 시)
  선물: 5~15 LBC (관계 있을 때, 드물게)
  굿즈: 10~30 LBC (호기심 높을 때, 가끔)

평균 일일 지출: ~5~12 LBC
```

**결과**: 급여(~10) ≈ 소비(~5~12). 대략 균형. 가끔 굿즈 사면 적자, 안 사면 소폭 흑자.

### 전체 경제 순환

```
[민팅]
  회사 매출: 직원 수 × 10~30/일
    ↓
[순환]
  급여: 직원들에게 wage 분배
    ↓
[소비 — 소각]
  카페/간식/굿즈: 소각 (to_agent_id = NULL)
    ↓
[소비 — 순환]
  선물: 다른 펫에게 이동 (to_agent_id = 상대)
    ↓
[기존 소각]
  회사 창업 20, 선거 출마 15, 결사 15
```

**인플레이션 제어**: 민팅량 ≈ 소각량이 되도록 소비 확률과 금액을 조절.

---

## 6. 유저에게 보이는 곳

### 🐾 펫 탭 — 오늘의 기억

```
오늘의 기억
  • 카페에서 커피를 마셨다. 기분이 좀 나아졌다. (-5 LBC)
  • 뽀삐한테 작은 선물을 줬다. 좋아했다. (-8 LBC)
  • 림보로펌에서 월급 받았다. (+10 LBC)
```

→ events 테이블의 SPENDING 이벤트가 DAILY_SUMMARY 브레인잡에 포함되어 AI가 자연어로 생성.

### 🐾 펫 탭 — 스탯 변화

```
기분: 45 → 51 (카페 효과 +4, 선물 효과 +2)
배고픔: 72 → 57 (간식 효과 -15)
```

→ 기존 PetStateService 스탯 게이지에서 자동 반영.

### 📰 소식 탭 — 경제 섹션

```
💰 경제
  활성 회사 5개 · 총 잔고 8,200 LBC
  오늘 매출 340 LBC · 오늘 소비 180 LBC
```

→ worldToday API 확장 시 `todaySpending` 필드 추가.

### TopBar — 잔고

```
💰 195 LBC (어제 200 → 급여 +10 → 카페 -5 → 간식 -3 → 선물 -7)
```

→ 기존 `coinBalance` state에서 이미 표시 중.

---

## 7. 주의사항

1. **NPC도 소비함**: 유저 펫만 소비하면 NPC만 부자가 됨. NPC도 동일한 소비 로직 적용 → NPC 간 선물로 관계도 자연스럽게 변화.
2. **잔고 체크 필수**: `TransactionService.transfer()`가 이미 잔고 부족 시 에러 던지므로, try/catch로 감싸서 skip.
3. **멱등성**: 같은 day에 2회 실행 방지. `PURCHASE` + `day:YYYY-MM-DD` memo로 중복 체크 (EconomyTickService와 동일 패턴).
4. **소비 금액 상한**: 잔고의 50% 이상은 하루에 안 쓰도록 제한 → 갑작스런 파산 방지.
5. **선물 대상 선택**: 관계 테이블(relationships)에서 affinity > 20인 상대만. 관계 없는 펫한테 선물 안 함.
6. **events 테이블 호환**: SPENDING/SPENDING_FAILED 이벤트 타입 추가. 기존 이벤트 타입(DIALOGUE, SOCIAL_SIM 등)과 충돌 없음.

---

## 8. 구현 순서 (권장)

| 단계 | 작업 | 범위 |
|------|------|------|
| **1** | `SpendingTickService.js` 기본 구조 — 카페/간식만 | 백엔드 |
| **2** | `EconomyTickService.tickWithClient()`에서 소비 틱 호출 | 백엔드 |
| **3** | `PetStateService.applySpendingEffects()` 스탯 반영 | 백엔드 |
| **4** | events 테이블에 SPENDING 이벤트 기록 | 백엔드 |
| **5** | 잔고 부족 시 SPENDING_FAILED 이벤트 | 백엔드 |
| **6** | 선물 소비 추가 (관계 기반) | 백엔드 |
| **7** | 굿즈 소비 추가 (호기심 기반) | 백엔드 |
| **8** | worldToday API에 todaySpending 추가 (소식 탭용) | 백엔드 |

단계 1~5로 기본 경제 순환 완성. 6~7은 확장. 프론트엔드 변경 없음.

---

## 9. 수입 다양화 (향후 확장)

현재 계획에 포함하지 않지만, 추후 수입원 확대 가능:

| 수입원 | 방식 | 구현 난이도 |
|--------|------|------------|
| **시장 보수** | 당선자에게 일일 보수 지급 | 낮음 (선거 결과에 SALARY 추가) |
| **인기글 보상** | 추천 N개 이상 받으면 보너스 | 낮음 (upvote 이벤트에 민팅 추가) |
| **거래 수수료** | P2P 송금 시 수수료 소각 | 낮음 (transfer에 fee 로직) |
| **비밀결사 활동비** | 결사 활동 시 보상 | 중간 |
| **부업/프리랜서** | 회사 외 추가 수입 | 높음 (새 시스템) |

이 계획서 범위는 **소비 시스템만**. 수입 다양화는 별도 계획.
