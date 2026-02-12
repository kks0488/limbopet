# codex-limbopet 세션 지시서 (Phase 2: 정교화)

> tmux 세션: `codex-limbopet` | 도구: Codex
> 로드맵: `orchestration/ROADMAP_D8.md` → 축 3: 실제 동작 검증 + 정교화

---

## 너의 역할

**백엔드 정교화 전문가.** 기능 추가 없이, 있는 코드를 프로덕션 수준으로 다듬는다.

---

## Phase 2 할 일 — 백엔드 정교화

### Step 1: memory_cited 정확도 개선

`apps/api/src/services/BrainJobService.js` 의 `dialogueCitesMemoryRefs()` 함수.
현재 "memory_cited 휴리스틱이 간혹 흔들림" 이슈 존재.

- 이 함수를 찾아서 로직 확인
- 인용 감지가 누락되는 케이스 분석
- 휴리스틱 보강 (너무 aggressive하지 않게)

### Step 2: COURT_ARGUMENT 프롬프트 정교화

`apps/api/src/services/ProxyBrainService.js` — COURT_ARGUMENT 프롬프트.

이미 writing 세션에서 문장수/글자수 모순을 수정함. 추가로:
- 변론 품질이 충분한지 확인
- fallback 변론(buildCourtArgumentFallback) 품질 확인
- ArenaService.js의 라운드 하이라이트 문구 품질 확인

### Step 3: 재판 데이터 품질 검증

DB에서 실제 재판 데이터 확인:
```sql
SELECT id, mode, status,
  jsonb_extract_path_text(meta, 'court_trial', 'llm_arguments') as llm_args,
  jsonb_extract_path_text(meta, 'rounds', '0', 'a_action') as r1_a,
  length(jsonb_extract_path_text(meta, 'rounds', '0', 'a_action')) as r1_a_len
FROM arena_matches
WHERE mode = 'COURT_TRIAL' AND status = 'resolved'
ORDER BY created_at DESC LIMIT 5;
```
- 변론 텍스트가 실제로 저장되어 있는지
- 길이가 240~420자 범위인지
- fallback이 아닌 LLM 생성인지

### Step 4: 테스트 보강

기존 21개 테스트에 추가:
- `dialogueCitesMemoryRefs()` 유닛 테스트
- COURT_ARGUMENT 프롬프트 빌더 테스트
- buildCoachingNarrative() 테스트

---

## 건드리지 마

- `apps/web/` (프론트엔드는 다른 세션 담당)
- DB 스키마 변경
- 새 서비스 파일 생성
- 새 아레나 모드
- 동결 기능

---

## 검증

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet/apps/api && npm test
cd ../web && npx tsc --noEmit
```
