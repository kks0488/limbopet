# LIMBOPET 선거 정책 효과 — PolicyService 활성화(적용 경로 연결)

> 상태: **✅ Phase P1 구현 완료** (2026-02-04)  
> - `PolicyService` + `policy_params` + 선거 결과 반영(쓰기) ✅  
> - Phase P1(초기 지급/창업비/최저임금) **읽기/적용 경로 연결** ✅  
> - Phase P2(세금/수수료/벌금 등)는 추후 확장(선택)

---

## 1) 목표

선거가 “타이틀”이 아니라 **실제 게임 룰을 바꾸는 이벤트**가 되게 한다.

예:
- 의회가 최저임금을 올리면 → 신규 고용/급여가 실제로 올라감
- 시장이 창업비를 올리면 → 회사 설립 비용이 실제로 변함
- (추후) 세무서장이 세율을 올리면 → 거래/선물/구매에 수수료가 붙음

---

## 2) 현재 상태(사실)

### 이미 있음(쓰기)
- `apps/api/src/services/PolicyService.js`: 기본값 시드 + get/set
- `apps/api/src/services/ElectionService.js`: 선거 종료 시 당선자의 platform을 `policy_params`에 반영

### 부족함(읽기/적용)
Phase P1은 완료. 남은 “정치 체감” 확장은 Phase P2 범위:
- 거래/송금 수수료(세무): `transaction_tax_rate` / `burn_ratio`
- 급여 원천징수(세무): `income_tax_rate`
- 벌금/항소(사법): `max_fine` / `appeal_allowed`

---

## 3) 구현 범위(권장: 2단계)

### Phase P1 (체감 즉시, 리스크 낮음)
1. `initial_coins` → 신규 펫 초기 지급에 적용  
2. `company_founding_cost` → 회사 설립 비용에 적용  
3. `min_wage` → 자동 취업 임금 하한에 적용

### Phase P2 (정치/세무 체감, 리스크/복잡도 ↑)
4. `transaction_tax_rate` / `burn_ratio` → “선물/송금” 등 agent→agent 이동에 수수료 부과  
5. `income_tax_rate` → SALARY에 원천징수(선택)  
6. `max_fine` / `appeal_allowed` → 벌금/항소 시스템 도입(사법/분쟁과 결합)

---

## 4) 변경 포인트(Phase P1)

### 4.1 신규 펫 초기 지급
- 변경 대상: `apps/api/src/services/AgentService.js`
- 현재: `amount: 200`
- 변경: `PolicyService.getNumberWithClient(client, 'initial_coins')`를 사용해 지급액 결정 (범위 clamp: 80~500)

### 4.2 회사 설립 비용
- 변경 대상: `apps/api/src/services/CompanyService.js`
- 현재: founding cost 20을 고정 전송
- 변경: `PolicyService.getNumberWithClient(client, 'company_founding_cost')` (범위 clamp: 1~200)

### 4.3 최저임금
- 변경 대상: `apps/api/src/services/JobService.js` (autoEmployWithClient에서 wage 결정)
- 현재: 직업별 기본 wage(하드코딩)
- 변경: `min_wage`를 읽어 `wage = max(defaultWageByJob, minWage)`
- 즉시 체감 포인트:
  - 신규 유저의 “다음날부터 급여” 숫자가 정책에 따라 달라짐

---

## 5) 수용 기준(Acceptance)

1. 선거로 `min_wage` 변경 → 다음에 생성되는 유저 펫의 wage가 변경된 값 이상으로 설정됨  
2. 선거로 `company_founding_cost` 변경 → 회사 설립 시 실제로 지출되는 금액이 바뀜  
3. 선거로 `initial_coins` 변경 → 신규 펫 생성 시 지급액이 바뀜  
4. 정책 기본값이 DB에 없더라도 `ensureDefaultsWithClient()`로 안전하게 동작

---

## 6) 관련 문서

- `docs/IMPLEMENTATION_PLAN_missing_systems.md` (트래커)
- `docs/MASTER_ROADMAP.md` (정치/정책 SSOT)
