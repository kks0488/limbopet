# LIMBOPET 구현 계획서 인덱스 (SSOT)

> 최종 업데이트: 2026-02-05  
> 목적: 구현 계획 문서들을 **중복 없이** 찾을 수 있게 하는 단일 인덱스.

---

## 범례

- ✅ 구현 완료
- 🟡 부분 구현 (일부만 실제 시스템에 연결됨)
- ⏳ 계획 단계 (문서만 존재)
- 📌 트래커 (상태/링크만 관리)

---

## UX / 온보딩 / 용어

| 문서 | 상태 | 범위 | 핵심 결과 | 주 엔트리포인트 |
|---|---|---|---|---|
| `docs/IMPLEMENTATION_PLAN_onboarding.md` | ✅ | web | 6단계 온보딩(welcome→create→born→peek→brain→done) | `apps/web/src/App.tsx` |
| `docs/IMPLEMENTATION_PLAN_ux_restructure.md` | ✅ | web+api | 탭 재구성 + 당부 UX 단순화 + 광장 게시판(검색/상세/댓글) + 방송 sticky 제거(뉴스 탭 한정) | `apps/web/src/App.tsx`, `apps/api/src/services/PetMemoryService.js` |

---

## 경제 / 직업 / 회사

| 문서 | 상태 | 범위 | 핵심 결과 | 주 엔트리포인트 |
|---|---|---|---|---|
| `docs/IMPLEMENTATION_PLAN_job_gacha.md` | ✅ | web+api | 탄생 직업 가챠 + 자동 취업/급여 시작 | `apps/web/src/App.tsx`, `apps/api/src/services/JobService.js` |
| `docs/IMPLEMENTATION_PLAN_economy.md` | ✅ | api+web | 자동 소비 + events 반영 + 소식탭 오늘 소비 | `apps/api/src/services/SpendingTickService.js`, `apps/api/src/services/EconomyTickService.js`, `apps/api/src/services/WorldContextService.js` |

---

## 사회 / 관계 / 당부(행동)

| 문서 | 상태 | 범위 | 핵심 결과 | 주 엔트리포인트 |
|---|---|---|---|---|
| `docs/IMPLEMENTATION_PLAN_nudge_behavior.md` | ✅ | api | 당부(facts) → 소비/자동돌봄/사회시뮬에 반영 | `apps/api/src/services/SpendingTickService.js`, `apps/api/src/services/PetStateService.js`, `apps/api/src/services/SocialSimService.js` |
| `docs/IMPLEMENTATION_PLAN_relationship_visibility.md` | ✅ | api+web | 관계 API + 펫 탭 관계 카드(친한/안좋은) | `apps/api/src/routes/users.js`, `apps/web/src/App.tsx` |

---

## 경쟁 / 아레나

| 문서 | 상태 | 범위 | 핵심 결과 | 주 엔트리포인트 |
|---|---|---|---|---|
| `docs/IMPLEMENTATION_PLAN_arena.md` | ✅ | api+web | 일일 아레나(6모드) + ELO + 소액 스테이크 + 라이벌리 이벤트 + 관전 상세 + 리캡 게시글(Plaza) | `apps/api/src/services/ArenaService.js`, `apps/web/src/App.tsx` |

---

## 월드 오케스트레이션

| 문서 | 상태 | 범위 | 핵심 결과 | 주 엔트리포인트 |
|---|---|---|---|---|
| `docs/IMPLEMENTATION_PLAN_living_society.md` | ✅ | api | 월드 워커/시뮬레이션 오케스트레이션 | `apps/api/src/services/WorldTickWorker.js`, `apps/api/src/routes/users.js` |

---

## 누락 시스템 트래킹 (남은 2개 포함)

| 문서 | 상태 | 범위 | 설명 |
|---|---|---|---|
| `docs/IMPLEMENTATION_PLAN_missing_systems.md` | 📌 | docs | 4개 누락 시스템 트래커(1~4 구현 완료, 추후 확장만 남음) |
| `docs/IMPLEMENTATION_PLAN_policy_effects.md` | ✅ | api | 선거 정책이 실제 룰(초기 지급/창업비/임금)에 적용되도록 연결(P1) |
| `docs/IMPLEMENTATION_PLAN_participation.md` | ✅ | api+web | 비밀결사/연구소 “참여 수락/거절/합류” 경로 |

---

## 배포 / Web-only

| 문서 | 상태 | 범위 | 설명 |
|---|---|---|---|
| `docs/CHECKLIST_web_only.md` | 📌 | web+api | Unity 없이 Web-only로 갈 때 남는 작업(배포/PWA/푸시/성능/UX/Remotion 옵션) |

---

## QA / 시뮬 (Fast-forward)

| 문서 | 상태 | 범위 | 설명 |
|---|---|---|---|
| `docs/IMPROVEMENT_PLAN_simulation.md` | 📌 | api+scripts | 30 AI 유저 “사회 시뮬” 개선 플랜/백로그(빠른감기, 한글 닉네임, 상호작용, 무결성 체크) |
| `docs/WORKLOG_arena_plaza_20260205.md` | ✅ | docs | Arena/Plaza 구현 + 30유저 시뮬 QA 실행 로그/증빙 |

---

## 클라이언트 연동(레퍼런스)

| 문서 | 상태 | 범위 | 설명 |
|---|---|---|---|
| `docs/UNITY_INTEGRATION.md` | 📌 | unity+api | Unity ↔ Backend 연동 레퍼런스(CORS/WebGL). 현재 사이클은 Web-only로 진행 |
