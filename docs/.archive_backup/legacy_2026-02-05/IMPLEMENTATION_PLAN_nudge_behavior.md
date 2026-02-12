# LIMBOPET — 당부(nudge) → 행동 연결 (구현 계획/스펙)

> 상태: **✅ 구현 완료** (2026-02-04)
> 목표: “당부”가 메모장이 아니라 **펫 행동을 실제로 바꾸는** 레버가 되게 하기.

---

## 1) 배경 / 문제

- 현재 당부는 `facts(kind=preference|forbidden|suggestion)`에 저장되지만,
  - 자동 소비(SpendingTickService), 자동 돌봄(PetStateService autopilot)에는 반영되지 않으면 “써도 체감이 없음”.
- (참고) SocialSim은 이미 당부를 읽어서 시나리오 가중치에 반영하는 로직이 존재함.

---

## 2) 데이터 소스

- 테이블: `facts`
- 대상 kind: `preference`, `suggestion`, `forbidden`
- (입력 호환) 클라이언트가 `type: sticker|forbid|suggestion`을 보내도 서버에서 kind로 정규화됨
- 텍스트: `COALESCE(value->>'text', key)`로 읽기 (현 저장은 key 중심이지만 하위호환)
- 최근 N개만 사용: `ORDER BY updated_at DESC LIMIT 6`

---

## 3) 자동 소비에 반영 (SpendingTickService)

### 3.1 정책 변수

- `dailyCapFraction` (기본 0.5)
- `secondPurchaseChance` (기본 0.35)
- `spendProbabilityMultiplier` (기본 1.0)
- `typeWeightMultiplier` (cafe/snack/gift/goods)
- `goodsCuriosityThresholdDelta` (기본 0)
- `disabledTypes` (forbidden 강제 제외)

### 3.2 대표 룰 (체감 중심)

- **절약/돈 아껴 써**
  - daily cap ↓, 굿즈 확률 ↓, 2번째 구매 ↓, 굿즈 조건(호기심) 더 빡세게
- **충동구매 하지마**
  - 굿즈 weight 강하게 ↓, 2번째 구매 확률 ↓
- **forbidden 특정 타입**
  - 카페/굿즈/선물은 disable
  - 간식은 완전 차단 대신 weight 상한만 낮춤(건강/재미 훼손 리스크 방지)

### 3.3 이벤트 payload에 힌트 기록

- `events.event_type='SPENDING'` payload에 `policyHints: { budget, impulse }` 포함
  - QA/시뮬레이션에서 “당부가 반영됐는지” 추적하기 위함

---

## 4) 자동 돌봄에 반영 (PetStateService autopilot)

- 당부(“무리하지마/쉬어/굶지마”)가 있으면 autopilot 트리거를 앞당김:
  - AUTO_FEED: hunger >= 80 (기존 90)
  - AUTO_SLEEP: energy <= 20 (기존 12)
  - AUTO_REST: stress >= 75 (기존 90)
- 적용 kind: `preference|suggestion`만 (forbidden은 MVP에서 미적용)

---

## 5) 변경 파일

- `apps/api/src/services/SpendingTickService.js`
- `apps/api/src/services/PetStateService.js`

---

## 6) 검증 체크리스트

1. 당부: “돈 아껴 써”
2. `dev/simulate`로 동일 day 시뮬레이션 실행
3. 확인:
   - 굿즈 소비/2번째 소비 빈도가 눈에 띄게 감소
   - `events.SPENDING.payload.policyHints.budget === true`가 존재
