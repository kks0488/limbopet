# LIMBOPET — 관계 가시성 (펫 탭) 구현 계획/스펙

> 상태: **✅ 구현 완료** (2026-02-04)
> 목표: “펫들의 사회”가 **눈에 보이게**. (친한/안좋은 관계를 한눈에)

---

## 1) 문제

- 일기/이벤트에는 “누구랑 친해졌다/싸웠다”가 나오지만,
  - 유저가 내 펫의 현재 관계를 빠르게 확인할 UI가 없음.

---

## 2) API 추가

### GET `/api/v1/users/me/pet/relationships?limit=20`

- 인증: User JWT
- 응답:

```json
{
  "relationships": [
    {
      "other": { "id": "uuid", "name": "poppy", "displayName": "뽀삐" },
      "out": { "affinity": 32, "trust": 55, "jealousy": 0, "rivalry": 2, "debt": 0, "updated_at": "..." },
      "in":  { "affinity": 28, "trust": 52, "jealousy": 1, "rivalry": 1, "debt": 0, "updated_at": "..." }
    }
  ]
}
```

- `out`: 내 펫 → 상대
- `in`: 상대 → 내 펫 (없으면 null)

정렬/선정:
- outgoing 기준 “관계 강도(intensity)” 큰 순으로 가져와서(최대 limit) 강한 친밀/갈등이 모두 포함되게 함.
  - intensity = `abs(affinity)` + `trust` + `jealousy` + `rivalry` + `abs(debt)` (가중치 포함)
  - 이유: affinity가 0 근처여도 rivalry/jealousy가 큰 관계(갈등/질투)가 UI에서 사라지지 않게.

---

## 3) 프론트 UI (🐾 펫 탭)

- 카드: `🤝 관계`
- 섹션 3개:
  - `친한`: affinity > 0, 내림차순, 최대 5명
  - `안좋은`: affinity < 0 **또는** rivalry/jealousy ≥ 25, 갈등점수 내림차순, 최대 5명
  - `최근 변화`: 타임라인의 `RELATIONSHIP_MILESTONE` 이벤트 요약(친해짐/질투/경쟁/원수), 최대 4개
- 표시:
  - 상대 이름(`displayName` 우선)
  - 배지:
    - 친한: `친밀 N` (+ 필요 시 `질투 N` / `경쟁 N`)
    - 안좋은: `갈등 N` (갈등점수 = `max(rivalry, jealousy, abs(min(0, affinity)))`)
  - 상호 관계가 있으면 `↔` 배지 추가

---

## 4) 변경 파일

- `apps/api/src/services/RelationshipService.js`
- `apps/api/src/routes/users.js`
- `apps/web/src/lib/api.ts`
- `apps/web/src/App.tsx`
