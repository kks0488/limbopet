# Result 1: 대화 → 기억 인용 코드 경로 감사 및 수정

## 변경 사항
- `apps/api/src/routes/users.js` — CLIProxyAPI(base) 계산을 `config.limbopet.proxy.baseUrl`(= `LIMBOPET_PROXY_BASE_URL`)와 호환되게 정리하고, `/v1` 포함 여부에 따라 관리(base) URL을 안전하게 파생.
- `apps/api/src/services/ProxyBrainService.js` — 설정 키 불일치(`limbopet.proxy.*` vs `limbopet.proxyBaseUrl`)를 흡수하고, base URL이 `/v1`을 포함하지 않아도 동작하도록 정규화.
- `apps/api/src/services/BrainJobService.js` — `memory_hint` 저장(facts insert) 키 충돌 가능성을 제거하고, 저장/이벤트 기록을 `bestEffortInTransaction`으로 감싸 job submit 트랜잭션이 side-effect 실패로 깨지지 않도록 개선.

## Commit
- hash: (no commit in this run)
- message: (n/a)

## 검증
- `cd apps/api && npm test` (21 passed, 0 failed)

## 코드 경로 문서화 (대화 → LLM → 기억 저장/인용)

### 1) 대화 요청 → brain_jobs 생성
- 엔드포인트: `POST /api/v1/users/me/pet/actions`
- 호출: `PetStateService.performAction(petId, action, payload)`
- `action === 'talk'`이면 `brain_jobs`에 `job_type='DIALOGUE'` 잡을 생성 (중복 방지: 최근 25초 내 pending/leased가 있으면 재사용)
- job input에 포함:
  - `user_message` (payload.message/text)
  - `facts` (최근/상위 confidence facts)
  - `memory_refs` (facts + weekly_memory에서 텍스트化)
  - `weekly_memory`, `world_context`, `prompt_profile` 등

### 2) brain_jobs → 실제 LLM 호출 라우팅
- 서버 워커(선택): `apps/api/src/services/ServerBrainWorker.js`
  - `backend=router`: NPC job → `ProxyBrainService.generate()`, 유저 job → `UserByokLlmService.generate()`(BYOK 프로필 필요)
  - fallback(옵션): 연결된 두뇌가 없으면 설정된 job type만 local 처리 가능
- 로컬 러너(선택): 별도 brain runner가 `BrainJobService.pull*`로 lease 후 결과 submit

### 3) LLM 결과 submit → 기억 힌트 추출/저장
- 결과 제출: `BrainJobService.submitJob(agentId, jobId, { status, result, error })`
  - `brain_jobs` 상태: pending → leased → done/failed
  - failed 시 error 분류/코드(last_error_code) 기록
- side-effect: `BrainJobService._applyJobResult()` (job_type='DIALOGUE')
  - `result.memory_hint` 우선 사용, 없으면 user_message/lines에서 규칙 기반 힌트 추출
  - coaching 힌트는 `facts(kind='coaching')`로 저장
  - `events(event_type='DIALOGUE')`에 payload 저장:
    - `dialogue`(lines/mood/safe_level/memory_hint)
    - `memory_saved`(facts 저장 성공 시), `memory_hint_extracted`, `memory_cited`(텍스트 매칭 기반)

### 4) 다음 대화에서 기억 인용
- 다음 TALK job 생성 시 `PetStateService`가 facts/weekly_memory를 `memory_refs`로 구성해 job input에 포함
- 프롬프트: `UserByokLlmService` / `ProxyBrainService` 시스템 지시에서 `memory_refs`를 “지난번에 ~했잖아”처럼 자연스럽게 섞어 인용하도록 유도
- 인용 여부는 submit 단계에서 `dialogueCitesMemoryRefs()`로 best-effort 판별되어 이벤트 payload에 기록됨

