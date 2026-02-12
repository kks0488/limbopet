# LIMBOPET "살아있는 사회" — 오케스트레이션/워커(구현 노트)

> 상태: **구현 완료(2026-02-04 기준)** — dev simulate 오케스트레이션 + `WorldTickWorker`(서버 상주)

---

## 1. 문제 정의

`/dev/simulate` 엔드포인트가 `ShowrunnerService.ensureDailyEpisode`만 호출하고 있어서,
선거 · 연구소 · 비밀결사 · 경제 시스템이 시뮬레이션에 포함되지 않았음.

**코드는 각 서비스에 구현되어 있지만, 오케스트레이션이 없어 실제로 동작하지 않는 상태.**

---

## 2. 변경 대상 (핵심 파일)

| # | 파일 | 유형 | 핵심 변경 |
|---|------|------|-----------|
| 1 | `apps/api/src/services/EconomyTickService.js` | 신규 | 회사 매출/급여 순환 서비스 |
| 2 | `apps/api/src/services/PlazaAmbientService.js` | 신규 | “광장 자유 글(공기 유지)” Brain Job 생성 |
| 3 | `apps/api/src/services/WorldTickWorker.js` | 신규 | 로그인 없이 월드 틱(방송/광장/선거/경제/연구/결사) |
| 4 | `apps/api/src/index.js` | 수정 | world worker bootstrap |
| 5 | `apps/api/src/config/index.js` | 수정 | `LIMBOPET_WORLD_WORKER*` + plaza ambient env |
| 6 | `apps/api/src/routes/users.js` | 수정 | simulate 루프에 월드 틱 오케스트레이션 + worldState 응답 |
| 7 | `apps/api/src/services/SocialSimService.js` | 수정 | 시나리오 가중치, trust 밸런스, 에이전트 선택 개선 |
| 8 | `apps/api/src/services/ShowrunnerService.js` | 수정 | 방송에 월드 이벤트 컨텍스트 삽입 |

**의존 파일** (변경 없음, 사용만):
- `apps/api/src/utils/savepoint.js` — `bestEffortInTransaction` 유틸
- `apps/api/src/services/ElectionService.js`
- `apps/api/src/services/TransactionService.js`
- `apps/api/src/services/ResearchLabService.js`
- `apps/api/src/services/SecretSocietyService.js`
- `apps/api/src/services/WorldContextService.js`
- `apps/api/src/services/DevSeedService.js`

---

## 3. 상세 구현 계획

### 3.1 EconomyTickService.js (신규 생성)

**목적**: 회사 잔고가 항상 0이던 문제 해결. 매 시뮬레이션 틱마다 경제 사이클 실행.

**API**: `EconomyTickService.tickWithClient(client, { day })`

**로직**:
```
1. 멱등성 체크: 같은 day에 REVENUE 트랜잭션이 이미 있으면 skip
2. active 회사 전체 조회 (wallet_agent_id + 직원 수)
3. 회사별 매출 생성: 직원 수 × random(10~30) 코인 → REVENUE 트랜잭션 (mint)
4. 직원별 급여 지급: employee.wage 기준 → SALARY 트랜잭션 (transfer)
5. 회사 balance 캐시 갱신
```

**설계 결정**:
- 기존 `TransactionService.transfer()` 재사용 (SSOT 유지)
- 잔고 부족 시 해당 직원 급여만 skip (회사 전체 실패 아님)
- `day:YYYY-MM-DD` 문자열로 REVENUE 트랜잭션 중복 체크 (멱등)
- wage=0인 직원(CEO 등)은 급여 지급 건너뜀

---

### 3.2 routes/users.js — simulate 엔드포인트 오케스트레이션

**목적**: 시뮬레이션 루프에서 모든 월드 시스템을 순차 호출.

**추가 import**:
- `ElectionService`
- `EconomyTickService`
- `bestEffortInTransaction` from `../utils/savepoint`

**루프 구조** (매 스텝마다):
```
transaction {
  1) EconomyTickService.tickWithClient     — 경제 순환
  2) ResearchLabService.ensureOneActive...  — 연구 프로젝트 시드
  3) SecretSocietyService.ensureSeeded...   — 비밀결사 시드
}
2) ElectionService.tickDay                  — 선거 진행/투표 (별도 트랜잭션 경계)
3) ShowrunnerService.ensureDailyEpisode      — 소셜 에피소드
```

**실패 격리**: 모든 월드 틱은 `bestEffortInTransaction`으로 감싸서 개별 실패가 전체 트랜잭션을 롤백하지 않음.

**주의(데드락 방지)**:
- `ElectionService.tickDay()`는 내부에서 자체 `transaction()`을 여므로,
  outer tx(특히 SpendingTickService의 `SELECT ... FOR UPDATE`) 안에서 호출하면 락 대기가 발생할 수 있음.
- 따라서 simulate 루프에서는 **election tick을 outer transaction 밖**에서 실행합니다.

**옵션(멀티-day 시뮬레이션)**:
- `advance_days=true`: `day`를 시작일로 보고, 스텝마다 날짜를 `+step_days(기본 1)`만큼 진행
- `force_episode`(boolean): `advance_days=true`일 때 기본 `false` (하루 1회 멱등), 아니면 기본 `true` (빠른 에피소드 누적)
- `episodes_per_step`(number): 스텝(하루)당 방송을 여러 편 생성(1..10). `>1`이면 day cap을 우회하기 위해 showrunner를 `force` 모드로 호출

**주의(응답 번들)**:
- simulate 완료 후 `bundle`을 만들 때 `WorldContextService.getBundle()`이 암묵적으로 방송을 추가 생성하지 않도록
  `ensureEpisode=false` 옵션을 사용합니다. (generated 카운트 정확성)

---

### 3.2b WorldTickWorker — 로그인 없이 “세상이 돌아가게”

**목적**: 유저가 앱을 안 열어도(요청이 없어도) “사회가 굴러가고 콘텐츠가 쌓이는 상태”를 유지.

- `setInterval` 기반의 경량 워커가 주기적으로 월드 틱을 수행
- `_busy` 가드로 **단일 프로세스 내 중복 실행 방지**
- 트랜잭션 내부는 `bestEffortInTransaction`으로 실패 격리

**하는 일(틱 1회)**:
- 방송 생성: `ShowrunnerService.ensureDailyEpisode({ day, now })`
- 광장 공기: `PlazaAmbientService.tick({ day })`
- 선거 진행: `ElectionService.tickDay({ day, fast: false })`
- 경제/연구/결사: DB 트랜잭션 안에서 best-effort로 실행

**설정(env → config)**:
- `LIMBOPET_WORLD_WORKER=1` (기본: non-prod에서는 on)
- `LIMBOPET_WORLD_WORKER_POLL_MS=15000` (1~60초 범위로 clamp)
- `LIMBOPET_PLAZA_AMBIENT_POSTS_PER_DAY=6`
- `LIMBOPET_PLAZA_AMBIENT_MIN_SECONDS=90`

**운영 안정화(✅ 적용됨)**:
- 멀티 인스턴스(서버 2대 이상)에서 **DB 락 기반 단일 실행 보장**: `WorldTickWorker`가 Postgres advisory lock을 잡고 tick 수행
- 관측 지표: `facts(kind='world_worker', key='last_tick')`에 성공/실패/소요시간/에러를 upsert (대시보드/알림에 사용 가능)

**worldState 응답 추가** (시뮬레이션 완료 후):
```json
{
  "generated": 10,
  "worldState": {
    "companies": { "count": 5, "totalBalance": 12500 },
    "elections": { "active": 2, "phase": "campaign" },
    "research": { "active": 1, "stage": "analyze" },
    "societies": { "count": 1, "members": 5 },
    "economy": { "circulating": 45000, "todayRevenue": 1200 }
  },
  "bundle": { ... }
}
```

---

### 3.3 SocialSimService.js — 사회 다양성 개선

#### 3.3a 시나리오 기본 가중치 재조정

| 시나리오 | Before | After | 의도 |
|----------|--------|-------|------|
| MEET | 1 | 1 | 유지 |
| OFFICE | 1 | **1.5** | 일상 시나리오 ↑ |
| CREDIT | 1 | 1 | 유지 |
| DEAL | 1 | **1.5** | 일상 시나리오 ↑ |
| ROMANCE | 2 | **1.5** | 편중 완화 |
| TRIANGLE | 1.5 | **1** | 편중 완화 |
| BEEF | 1.5 | **1** | 편중 완화 |

#### 3.3b Trust 델타 밸런스 (긍정:부정 ≈ 4:3)

| 시나리오 | trust Before | trust After | affinity 변경 |
|----------|-------------|-------------|---------------|
| MEET | +1 | **+2** | +1 → **+2** |
| OFFICE | 0 | **+2** | 0 → **+1** |
| DEAL | +1 | **+3** | +1 → **+2** |
| ROMANCE | +2 | +2 | 유지 |
| RECONCILE | +5 | +5 | 유지 |
| CREDIT | -6 | -6 | 유지 |
| TRIANGLE | -2 | -2 | 유지 |
| BEEF | -3 | -3 | 유지 |

**의도**: 기존에 7개 시나리오 중 5개가 trust 감소/중립 → 사회가 불신만 쌓이는 문제 해결.

#### 3.3c 에이전트 선택 랜덤화

**Before**: `ORDER BY last_active DESC NULLS LAST LIMIT 450` (항상 같은 에이전트 선택)
**After**: `ORDER BY RANDOM() LIMIT 500`

#### 3.3d preferUserPet 빈도

**Before**: 75% 확률로 유저 펫끼리 매칭
**After**: **50%** 로 하향 → NPC 상호작용 증가

---

#### 3.3e 관계 기반 캐스팅 고도화 (파트너 리캐스팅)

**문제**: 에이전트 수가 많아질수록 “처음 보는 둘” 매칭이 과도해져 관계가 깊어지기 어려움.

**해결**: 1차로 A/B를 뽑은 뒤, **일정 확률로 B를 관계 강도 기반으로 재선정**해서 연재감/연속성을 강화.

- 기본값: 65% 확률로 리캐스트 (`config.limbopet.socialPartnerRecastChance`, 미설정 시 0.65)
- 탐색 유지: 리캐스트 중 35%는 관계 무시(신규 만남 유도)
- 가중치: 최근 등장 페널티 × (1 + 관계 강도 점수)
  - 관계 강도 점수: `abs(affinity) + trust + jealousy + rivalry + |debt|` 기반 (양/음 모두 “서사 강도”로 취급)

---

#### 3.3f TRIANGLE 3인칭(제3자) 도입

기존 TRIANGLE은 “질투”만 있었고 **누구 때문에 질투하는지**가 없어서 맥락이 약했음.

- TRIANGLE 시: B가 친한(affinity/trust 높은) 상대를 우선으로 1명을 뽑아 `third_*`로 payload에 포함
- 내러티브 템플릿에 `{c}` 플레이스홀더 추가 → “{c} 얘기”로 질투가 구체화

이벤트 필드:
- `third_agent_id`, `third_name`

---

#### 3.3g DEAL 시나리오 ↔ 경제(코인) 연결

DEAL이 “텍스트만 딜”인 상태라 경제 체감이 약했음.

- DEAL 발생 시: buyer→seller로 **실제 TRANSFER** 트랜잭션(5~40 코인) 시도
- `reference_type = 'social_deal'`, `memo`에 `day:` 태그 포함
- 결과는 SOCIAL payload에 `deal`로 기록:
  - 성공: `{ ok:true, tx_id, amount, buyer_id, seller_id }`
  - 실패(잔고 부족 등): `{ ok:false, amount, buyer_id, seller_id, error:'insufficient_funds' }`
- 관계 debt는 중복 증가 방지:
  - 실제 코인이 움직였으면 debt 증가 0
  - 실패한 딜은 기존처럼 debt로 “외상/약속”이 쌓일 수 있음

---

### 3.4 ShowrunnerService.js — 방송 다양화

**목적**: 방송 내러티브에 월드 시스템 컨텍스트를 삽입하여 "살아있는 세계" 느낌 강화.

**추가 import**: `ElectionService`, `bestEffortInTransaction`

**buildBroadcastPost 변경**:
- `worldContext` 파라미터 추가
- 방송 본문 끝에 삽입:
  - `civicLine`: "🗳️ 시장 선거: 캠페인 중 (D-3)"
- `researchLine`: "🔬 연구소: \"펫 두뇌 연결 가이드\" (analyze 단계)"
  - `societyRumor`: "🕵️ 소문: ..." (3가지 변형 중 랜덤)

**ensureDailyEpisode에서 worldContext 수집**:
1. `ElectionService.getCivicLine(today)` — 선거 상황
2. `research_projects` 테이블 직접 조회 — 연구소
3. `secret_societies` 테이블 직접 조회 — 비밀결사 소문

모두 try/catch로 감싸서 실패해도 에피소드 생성에 영향 없음.

---

## 4. 주의사항

1. **ElectionService.tickDay**: 내부에서 자체 `transaction()` 호출 → outer tx(특히 `FOR UPDATE`) 안에서 호출하지 말고 **별도 트랜잭션 경계(outer tx 밖)**에서 실행
2. **EconomyTickService 멱등성**: `day:YYYY-MM-DD` 문자열로 REVENUE 중복 체크 → 같은 day에 여러 번 호출해도 1회만 실행
3. **wage=0인 직원**: 급여 지급 건너뜀 (CEO는 기본 wage=0)
4. **비밀결사/연구소**: 이미 active 상태가 있으면 새로 생성하지 않음 (멱등)

---

## 5. 검증 방법

```bash
# 1. dev 로그인
TOKEN=$(curl -sS -X POST http://localhost:3001/api/v1/auth/dev \
  -H 'Content-Type: application/json' \
  -d '{"email":"sim@limbopet.dev"}' | jq -r '.token')

# 2. 시뮬레이션 (10스텝, 50명)
curl -sS -X POST http://localhost:3001/api/v1/users/me/world/dev/simulate \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"steps":10,"extras":50}'

# 3. DB 검증
psql -p 5433 -U postgres -d limbopet -c "
  SELECT 'companies' as sys, count(*) as cnt FROM companies WHERE status='active'
  UNION ALL
  SELECT 'elections', count(*) FROM elections WHERE phase != 'closed'
  UNION ALL
  SELECT 'research', count(*) FROM research_projects WHERE status='in_progress'
  UNION ALL
  SELECT 'societies', count(*) FROM secret_societies WHERE status='active'
  UNION ALL
  SELECT 'transactions', count(*) FROM transactions WHERE created_at > now() - interval '1 hour';
"
```

**통과 기준**:
- [ ] companies: balance > 0인 회사 존재
- [ ] elections: active 상태 선거 존재
- [ ] research: in_progress 프로젝트 존재
- [ ] societies: active 결사 존재
- [ ] transactions: REVENUE/SALARY 트랜잭션 생성됨
- [ ] 에피소드 내러티브: 10개 중 중복 < 3개
- [ ] 응답 JSON에 `worldState` 객체 포함

---

## 6. 구현 상태

> **2026-02-04 기준:** dev simulate 오케스트레이션 + `WorldTickWorker` 기반 “살아있는 사회”가 동작.

| 파일 | 상태 |
|------|------|
| `EconomyTickService.js` | ✅ 생성 완료 (127줄) |
| `PlazaAmbientService.js` | ✅ 생성 완료 |
| `WorldTickWorker.js` | ✅ 생성 완료 |
| `src/index.js` world worker | ✅ bootstrap 반영 |
| `src/config/index.js` | ✅ world worker/plaza env 반영 |
| `routes/users.js` simulate | ✅ 오케스트레이션 + worldState 응답 반영 |
| `SocialSimService.js` | ✅ 가중치/trust/랜덤화/preferUserPet 모두 반영 |
| `ShowrunnerService.js` | ✅ worldContext 수집 + buildBroadcastPost 반영 |
| `utils/savepoint.js` | ✅ bestEffortInTransaction 유틸 존재 |
