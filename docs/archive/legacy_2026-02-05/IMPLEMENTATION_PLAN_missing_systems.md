# LIMBOPET 누락 시스템 — 트래커

> 상태: **📌 트래커**
> 최종 업데이트: 2026-02-04
> 목적: “누락 시스템 4개”의 **상태/링크/남은 작업만** 관리합니다. 상세 스펙은 각 문서로 이동합니다.

---

## 요약

| # | 시스템 | 상태 | 사용자 체감 | 문서 |
|---|--------|------|-------------|------|
| 1 | 당부 → 행동 연결 | ✅ | 당부가 소비/자동돌봄/사회상호작용에 반영 | `docs/IMPLEMENTATION_PLAN_nudge_behavior.md` |
| 2 | 관계 가시성 | ✅ | 펫 탭에서 친한/안좋은 관계를 한눈에 | `docs/IMPLEMENTATION_PLAN_relationship_visibility.md` |
| 3 | 선거 정책 효과 | ✅ | 선거가 초기 지급/창업비/임금 등 “룰”에 실제로 반영 | `docs/IMPLEMENTATION_PLAN_policy_effects.md` |
| 4 | 비밀결사/연구소 참여 | ✅ | 소식 탭에서 결사 초대 수락/거절 + 연구 참여 가능 | `docs/IMPLEMENTATION_PLAN_participation.md` |

---

## 1) 당부 → 행동 연결 (✅ 구현 완료)

- 적용 지점
  - 소비: `apps/api/src/services/SpendingTickService.js` (facts → spending policy, `SPENDING` 이벤트에 `policyHints` 기록)
  - 자동 돌봄: `apps/api/src/services/PetStateService.js` (facts → autopilot threshold 조절)
  - 사회 시뮬: `apps/api/src/services/SocialSimService.js` (facts → 시나리오 가중치)
- QA 포인트
  - 당부 “돈 아껴 써” 입력 → `dev simulate` 실행 → 굿즈/2회 소비 빈도 감소 + `events.SPENDING.payload.policyHints.budget=true` 확인

---

## 2) 관계 가시성 (✅ 구현 완료)

- API: `GET /api/v1/users/me/pet/relationships?limit=20`
- UI: `apps/web/src/App.tsx`의 🐾 펫 탭 `🤝 관계` 카드 (친한/안좋은)

---

## 3) 선거 정책 효과 (✅ Phase P1 구현 완료)

- 이미 구현됨(쓰기)
  - `apps/api/src/services/PolicyService.js`
  - `apps/api/src/services/ElectionService.js` (선거 종료 시 `policy_params` 업데이트)
- 구현됨(읽기/적용)
  - `initial_coins` → 신규 펫 초기 지급 (`apps/api/src/services/AgentService.js`)
  - `company_founding_cost` → 회사 설립 비용 (`apps/api/src/services/CompanyService.js`)
  - `min_wage` → 자동 취업 임금 하한 (`apps/api/src/services/JobService.js`)

상세: `docs/IMPLEMENTATION_PLAN_policy_effects.md`

---

## 4) 비밀결사/연구소 유저 참여 (✅ Phase P1 구현 완료)

- 구현됨:
  - 소식 탭: 결사 초대 **가입/거절** 버튼 + 연구 프로젝트 **참여하기** 버튼
  - API: `GET /users/me/world/participation`, `POST /users/me/world/society/:societyId/respond`, `POST /users/me/world/research/:projectId/join`

상세: `docs/IMPLEMENTATION_PLAN_participation.md`
