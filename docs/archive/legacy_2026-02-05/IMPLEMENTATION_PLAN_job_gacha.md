# LIMBOPET 직업 가챠 + 자동 취업 — 구현 계획서

> 상태: **✅ 구현 완료** (2026-02-04)
> 관련: `IMPLEMENTATION_PLAN_onboarding.md` (온보딩 화면3 탄생 연출에 적용)

---

## 1. 목표

### 문제

1. **직업 배정이 보이지 않음**: 펫 생성 시 자동 배정되지만, 유저가 "뭐가 나왔는지" 보는 순간이 없음
2. **회사 소속 없음**: 유저 펫은 회사에 자동 배치되지 않아서 급여 수입 0
3. **경제 참여 불가**: 회사 소속이 없으면 일일 급여 사이클에서 빠짐 (초기 200코인만 있고 끝)

### 해결

- 온보딩 탄생 화면에서 **가챠 연출**로 직업 공개
- 직업에 맞는 **회사 자동 배치** → 다음 날부터 급여 수입 시작
- 레어도별 **차등 연출** (common~legendary)

---

## 2. 현재 시스템 정리

### 직업 (jobs 테이블 — 6개 고정)

| 코드 | 이름 | 레어도 | 확률 | 존 |
|------|------|--------|------|-----|
| barista | 바리스타 | common | 60% | 카페 |
| merchant | 상인 | common | 60% | 굿즈샵 |
| journalist | 기자 | uncommon | 25% | 광장 |
| engineer | 엔지니어 | uncommon | 25% | 회사 |
| detective | 탐정 | rare | 12% | 골목 |
| janitor | 관리인 | legendary | 3% | 복도 |

※ 확률은 가중치 비율 (common 60 : uncommon 25 : rare 12 : legendary 3)

### 직업 배정 흐름 (현재)

```
AgentService.register()
  → JobService.ensureAssignedWithClient()
    1. 유저 설명 텍스트에서 키워드 매칭 ("기자" → journalist 등)
    2. 매칭 안 되면 → 가중 랜덤
    3. agent_jobs 테이블에 INSERT
    4. facts.profile.job에 저장
  → TransactionService.transfer() 200코인 초기 지급
  → (끝 — 회사 배치 없음)
```

### 회사 시스템 (현재)

- NPC는 시드 데이터로 회사 자동 배치 (`NpcSeedService.js:139~171`)
- 유저 펫은 "회사 창업" (20코인)만 가능, **취직 API 없음**
- 회사별 일일 매출: 직원 수 × random(10~30)코인 민팅
- 직원별 급여: `company_employees.wage` 기준 지급 (wage=0이면 skip)

### 존재하는 NPC 회사 (시드)

시드 데이터에 정의된 회사들이 존재함. 직업→회사 매핑 시 이 회사들을 활용.

---

## 3. 변경 파일

### 백엔드

| 파일 | 변경 |
|------|------|
| `apps/api/src/services/AgentService.js` | register() 안에서 회사 자동 배치 호출 추가 |
| `apps/api/src/services/JobService.js` | `autoEmployWithClient()` 함수 추가 — 직업→회사 매핑 + 배치 |
| `apps/api/src/services/CompanyService.js` | `findOrCreateByZone()` 함수 추가 — 존 기반 회사 찾기/생성 |

### 프론트엔드

| 파일 | 변경 |
|------|------|
| `apps/web/src/App.tsx` | 온보딩 탄생 화면(화면3)에 가챠 연출 추가 |

---

## 4. 상세 구현

### 4.1 직업→회사 자동 배치 (백엔드)

#### 매핑 규칙

직업의 `zone_code`를 기준으로 해당 존에 속하는 활성 회사에 배치:

| 직업 | 존 | 매핑 회사 | 직급 |
|------|-----|-----------|------|
| barista | cafe | 카페 계열 회사 | employee |
| merchant | goods_shop | 상점 계열 회사 | employee |
| journalist | plaza | 미디어 계열 회사 | employee |
| engineer | office | 테크 계열 회사 | employee |
| detective | alley | 소규모 사무소 또는 프리랜서 | employee |
| janitor | hallway | 아무 회사 (관리직) | manager |

#### `JobService.autoEmployWithClient(client, agentId, jobCode, zoneCode)` 추가

```
1. 해당 존에 매핑되는 활성 회사 조회
   SELECT c.id, c.name, employee_count
   FROM companies c
   WHERE c.status = 'active'
   ORDER BY employee_count ASC  -- 가장 적은 인원 회사 우선
   LIMIT 5

2. 회사가 있으면 → 인원 가장 적은 회사에 배치
   CompanyService.ensureEmployeeWithClient(client, {
     companyId, agentId, role: 'employee', wage: defaultWageForJob
   })

3. 회사가 없으면 → 자동 생성
   - 존별 기본 회사 이름 풀에서 랜덤 선택
   - world_core 에이전트를 CEO로 설정 (NPC 회사와 동일)
   - 신규 회사에 해당 펫 employee로 배치
```

#### 존별 기본 회사 이름 풀

```js
const DEFAULT_COMPANIES = {
  cafe: ['새벽카페', '림보로스팅', '구름찻집'],
  goods_shop: ['리본굿즈', '림보마켓', '골목상점'],
  plaza: ['림보타임즈', '광장일보', '소문통신'],
  office: ['림보전자', '안개랩스', '코드공방'],
  alley: ['그림자사무소', '골목탐정단'],
  hallway: ['림보관리공단']
};
```

이미 존재하는 이름은 건너뛰고 (ON CONFLICT), 없는 이름 중 하나를 생성.

#### 기본 급여 (wage)

직업별 기본 wage 설정 (회사 배치 시):

| 직업 | 기본 wage | 이유 |
|------|-----------|------|
| barista | 8 | 서비스직 기본급 |
| merchant | 10 | 영업직 |
| journalist | 12 | 전문직 |
| engineer | 15 | 기술직 |
| detective | 12 | 전문직 |
| janitor | 20 | 레전더리 (관리직) |

※ 회사 일일 매출이 직원 수 × 10~30이므로, wage가 매출 per head 범위 안에 있어야 회사가 파산하지 않음.

### 4.2 AgentService.register() 변경

**현재** (`AgentService.js:133~146`):
```
1. facts.profile.job_role 저장
2. JobService.ensureAssignedWithClient() ← 직업 배정
3. TransactionService.transfer() ← 200코인 초기 지급
4. return
```

**변경**:
```
1. facts.profile.job_role 저장
2. JobService.ensureAssignedWithClient() ← 직업 배정
3. JobService.autoEmployWithClient()     ← 회사 자동 배치 (신규)
4. TransactionService.transfer() ← 200코인 초기 지급
5. return (직업 + 회사 정보 포함)
```

**register() 리턴값 확장**:
```js
return {
  pet: { id, name, ... },
  job: { code: 'barista', displayName: '바리스타', rarity: 'common', zone: 'cafe' },
  company: { id, name: '새벽카페' }  // 신규
};
```

프론트엔드가 탄생 연출에서 바로 사용.

### 4.3 온보딩 탄생 화면 — 가챠 연출 (프론트엔드)

**현재 탄생 화면** (온보딩 `born` 스텝):
```
🎉
모찌가 림보에 태어났어요!
모찌가 눈을 뜨고 주변을 두리번거린다…
[다음]
```

**변경**:
```
🎉
모찌가 림보에 태어났어요!

모찌의 운명이 결정되고 있어요…

(가챠 연출 애니메이션)

💼 바리스타 ☕  [common]
🏢 새벽카페 소속

모찌가 눈을 뜨고 주변을 두리번거린다…

[다음]
```

#### 가챠 연출 방식

**간단한 CSS 애니메이션** (라이브러리 미사용):

```
Phase 1 (0~1.5s): "모찌의 운명이 결정되고 있어요…"
  → 텍스트 깜빡임 (opacity pulse)

Phase 2 (1.5~2.5s): 직업 카드 등장
  → scale(0) → scale(1) + fade-in

Phase 3 (2.5~3s): 회사 텍스트 등장
  → slide-up + fade-in
```

#### 레어도별 연출 차이

| 레어도 | 카드 스타일 | 텍스트 |
|--------|-----------|--------|
| common | 기본 카드 (회색 테두리) | 💼 바리스타 ☕ |
| uncommon | 파란 테두리 + 약한 빛 | 💼 기자 📰 ✨ |
| rare | 보라 테두리 + 빛 펄스 | 💼 탐정 🔍 ⭐ |
| legendary | 금색 테두리 + 강한 빛 + 파티클(?) | 💼 관리인 🔑 🌟🌟🌟 |

CSS로 구현 가능한 범위:
- 테두리 색상: `border-color` 변경
- 빛 효과: `box-shadow` 애니메이션
- 파티클: legendary만 pseudo-element로 간단하게 (또는 생략)

#### 데이터 소스

`createPet` API 응답에서 `job`과 `company` 정보를 받아 바로 렌더:

```ts
// api.ts
const result = await createPet(token, name, desc);
// result.job = { code: 'barista', displayName: '바리스타', rarity: 'common' }
// result.company = { name: '새벽카페' }
```

`onCreatePet()` 성공 시 이 데이터를 state에 저장 → `born` 스텝에서 사용.

---

## 5. 경제 영향 분석

### 변경 전 (유저 펫)
```
수입: 0 (회사 소속 없음)
지출: 회사 창업 20코인, 선거 출마 15코인
결과: 200코인 서서히 감소 → 경제 참여 불가
```

### 변경 후 (유저 펫)
```
수입: wage × 1/day (예: 바리스타 8코인/일)
지출: 동일
결과: 매일 수입 발생 → 선거 출마, 회사 창업 등 가능
```

### 인플레이션 영향

- 유저 펫 1명 추가 시 회사 매출 민팅 증가: ~10~30코인/일
- 유저 펫 급여: ~8~20코인/일
- 현재도 인플레이션 구조이므로 큰 차이 없음

---

## 6. 하위호환

1. **기존 유저 펫** (이미 생성됨, 회사 소속 없음):
   - 자동 마이그레이션은 하지 않음 (복잡도 증가)
   - 설정 탭이나 소식 탭에서 "회사 배치받기" 버튼 추가 (별도 작업)
   - 또는 WorldTickWorker에서 미배치 펫 주기적 체크 → 자동 배치

2. **createPet API 응답 확장**:
   - 기존: `{ pet: {...} }`
   - 변경: `{ pet: {...}, job: {...}, company: {...} }`
   - 기존 필드 유지, 신규 필드 추가만이므로 breaking change 없음

3. **NPC 시드**: 기존 로직 그대로 유지. `autoEmployWithClient`는 유저 펫 전용.

---

## 7. 구현 순서 (권장)

| 단계 | 작업 | 범위 |
|------|------|------|
| **1** | 존별 기본 회사 이름 풀 정의 + `CompanyService.findOrCreateByZone()` | 백엔드 |
| **2** | `JobService.autoEmployWithClient()` — 직업→회사 매핑 로직 | 백엔드 |
| **3** | `AgentService.register()`에서 자동 취업 호출 + 응답 확장 | 백엔드 |
| **4** | 온보딩 탄생 화면에 가챠 연출 UI 추가 | 프론트 |
| **5** | 레어도별 CSS 스타일 | 프론트 |

---

## 8. 주의사항

1. **wage vs 매출 밸런스**: 직원 wage 합계가 회사 일일 매출(직원수×10~30)을 초과하면 회사 잔고 부족 → 급여 skip. 기본 wage를 보수적으로 설정 (per-head 매출 하한인 10 이하).
2. **회사 인원 분배**: 모든 유저가 같은 회사에 몰리지 않도록 `employee_count ASC` 정렬로 최소 인원 회사 우선 배치.
3. **CEO 없는 자동 생성 회사**: world_core 에이전트를 CEO로 설정. world_core가 없으면 `NpcSeedService.ensureSeeded()` 선행 필요.
4. **가챠 연출 스킵**: 이미 펫이 있는 기존 유저는 탄생 화면을 거치지 않으므로 영향 없음.
5. **직업 6개 한정**: 현재 jobs 테이블에 6개만 있음. 추후 직업 추가 시 회사 이름 풀과 wage 테이블도 같이 확장 필요.
