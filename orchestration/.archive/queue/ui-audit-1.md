# UI 감사 보고서 — 대화/기억 UI (Phase 2 준비)

> 일시: 2026-02-07 | typecheck: PASS

---

## 감사 범위

1. App.tsx 대화 전송 함수 (`onSendChat` → `onAction`)
2. api.ts 대화 관련 API 함수들
3. "기억했어요!" 토스트 트리거/표시
4. 기억 인용 뱃지 조건
5. BrainSettings / AiConnectPanel API 키 설정 UI

---

## 수정된 버그 (4건)

### BUG-1: `petArenaVote` URL 불일치 — 404 발생 (심각)

| 항목 | 내용 |
|------|------|
| **파일** | `apps/api/src/routes/users.js:1352` |
| **증상** | 투표 시 항상 404 Not Found |
| **원인** | 프론트엔드: `/users/me/world/arena/matches/:id/vote`, 백엔드: `/users/me/arena/matches/:id/vote` — `world/` 불일치 |
| **수정** | 백엔드 라우트를 `/me/world/arena/matches/:matchId/vote`로 통일 (다른 match 액션들과 일관성) |

### BUG-2: `petArenaVote` 응답 타입 불일치

| 항목 | 내용 |
|------|------|
| **파일** | `apps/web/src/lib/api.ts:1031`, `apps/web/src/components/ArenaWatchModal.tsx:685-687` |
| **증상** | 투표 후 결과 카운트가 undefined로 표시 |
| **원인** | 프론트엔드: `{ fair_count, unfair_count }` 기대, 백엔드 실제: `{ vote_result: { fair, unfair, total } }` |
| **수정** | api.ts 반환 타입을 백엔드 실제 응답에 맞춤, ArenaWatchModal에서 `res.vote_result.fair` / `res.vote_result.unfair` 참조 |

### BUG-3: "기억했어요!" 토스트 stale closure (중요)

| 항목 | 내용 |
|------|------|
| **파일** | `apps/web/src/App.tsx:1807-1812` |
| **증상** | 대화 후 기억 저장돼도 "기억했어요!" 토스트가 표시 안 됨 |
| **원인** | `onAction` 클로저가 캡처한 `events`는 폴링 전 stale 값. 4회 폴링으로 state가 업데이트돼도 클로저의 `events`는 갱신 안 됨 |
| **수정** | 폴링 후 `timeline(userToken, 5)` 직접 호출하여 fresh 데이터로 `memory_saved` 체크 |

### BUG-4: `arenaModeStats` method 미지정 (경미)

| 항목 | 내용 |
|------|------|
| **파일** | `apps/web/src/lib/api.ts:988` |
| **증상** | 동작은 하지만 다른 함수들과 일관성 없음 |
| **수정** | `method: "GET"` 명시 추가 |

---

## 정상 확인된 항목

### 1. 대화 전송 흐름 (App.tsx)

```
onSendChat() → onAction("talk", { message }) → petAction(token, "talk", { message })
→ POST /users/me/pet/actions  body: { action: "talk", payload: { message: "..." } }
→ Brain Worker 비동기 처리 → 폴링 4회 (1.2s, 2.5s, 4.5s, 7s)
```

- 400자 제한 검증: OK (`App.tsx:1830`)
- brainProfile 미연결 가드: OK (`App.tsx:1764-1769`) — 설정 패널 자동 오픈
- 쿨다운: talk은 0ms — 의도적
- 에러 핸들링: try/catch + toast 표시 OK

### 2. api.ts 엔드포인트 매핑

전수 대조 결과 `petArenaVote` 외 **모든 엔드포인트가 백엔드와 정확히 일치**.

주요 대화/기억 관련:
| 함수 | 엔드포인트 | 상태 |
|------|-----------|------|
| `petAction` | POST `/users/me/pet/actions` | OK |
| `timeline` | GET `/users/me/pet/timeline` | OK |
| `brainStatus` | GET `/users/me/pet/brain/status` | OK |
| `setMyBrainProfile` | POST `/users/me/brain` | OK |
| `deleteMyBrainProfile` | DELETE `/users/me/brain` | OK |
| `getMyBrainProfile` | GET `/users/me/brain` | OK |
| `submitNudges` | POST `/users/me/pet/memory-nudges` | OK |

### 3. "기억했어요!" 토스트

- **트리거**: `DIALOGUE` 이벤트의 `payload.memory_saved == truthy`
- **표시**: `kind: "good"` (녹색), 텍스트 "기억했어요!", 3200ms 후 자동 소멸
- **stale closure 수정 완료** → 이제 fresh API 데이터로 체크

### 4. 기억 인용 뱃지

- **데이터**: `chatHistory` 각 항목에서 `payload.memory_cited`를 Boolean 변환 (`App.tsx:1280-1281`)
- **렌더링**: `<span className="memoryCitedBadge">기억</span>` — 인라인 채팅(`App.tsx:2962`)과 디버그 UI(`App.tsx:3199`) 양쪽
- **CSS**: 파란색 소형 배지 (`styles.css:3597-3608`)
- **상태**: 정상 동작

### 5. BrainSettings / AiConnectPanel

| 체크 항목 | 결과 |
|----------|------|
| BYOK API 키 저장 (POST /users/me/brain) | OK — ping 검증 후 암호화 저장 |
| 프론트엔드 검증 (provider/model/apiKey 빈값) | OK |
| 에러 핸들링 (try/catch + toast + busy) | OK |
| API 키 삭제 (DELETE /users/me/brain) | OK |
| Google OAuth 연결 | 동작하나 폴링 ~14초 제한 (개선 여지) |
| CLIProxy OAuth (AiConnectPanel) | 5분 폴링 + 취소 + 에러 처리 — 견고 |
| publicView에서 키 미노출 | OK — 보안 정상 |

---

## 개선 여지 (수정 안 함 — 참고용)

| 항목 | 위치 | 설명 |
|------|------|------|
| Google OAuth 폴링 제한 | `App.tsx:2362` | 고정 4회 ~14초. AiConnectPanel은 5분. 통일 필요 시 별도 작업 |
| `myStreaks`/`petStreaks` 중복 | `api.ts:134-139` | 동일 엔드포인트 동일 로직. 정리 가능 |
| 미사용 백엔드 라우트 | `users.js` 다수 | `bootstrap`, `arena/stats`, `highlight`, `rematch` 등 api.ts에서 호출 안 함 |

---

## 검증

```
$ cd apps/web && npx tsc --noEmit
(no errors)
```
