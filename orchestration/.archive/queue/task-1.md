# Task 1: 대화 → 기억 인용 코드 경로 감사 및 수정

## 목표

Phase 2 "대화 체감"의 핵심 코드 경로를 감사하고, 실제 LLM 연동 시 깨질 부분을 미리 수정한다.

**유저 시나리오**: 대화 3~5회 → memory_hint 추출 → 다음 대화에서 과거 기억을 자연스럽게 인용

## 대상 파일 (읽고 감사)

1. **대화 엔드포인트**: `apps/api/src/routes/users.js` — 대화 관련 라우트
2. **브레인 서비스**: `apps/api/src/services/PetBrainService.js` — 대화 프롬프트 생성
3. **메모리 서비스**: `apps/api/src/services/MemoryService.js` — 기억 3계층 (events/facts/memories)
4. **메모리 힌트**: `apps/api/src/services/PetMemoryService.js` — memory_hint 추출
5. **브레인 잡**: `apps/api/src/services/BrainJobService.js` — LLM 작업 큐
6. **프록시 브레인**: `apps/api/src/services/ProxyBrainService.js` — 실제 LLM 호출

## 상세 스펙

### 감사 포인트

1. **대화 요청 → LLM 호출 흐름**
   - 유저가 대화를 보내면 어떤 경로로 LLM까지 가는지 추적
   - brain_jobs 테이블에 잡이 제대로 들어가는지
   - 프록시/직접 호출 분기가 올바른지

2. **memory_hint 추출 흐름**
   - LLM 응답에서 memory_hint를 추출하는 로직 확인
   - 추출된 hint가 events → facts로 저장되는 경로 확인
   - 저장 시 kind='coaching' vs 일반 fact 구분이 올바른지

3. **기억 인용 흐름**
   - 다음 대화 시 프롬프트에 기존 memories/facts가 포함되는지 확인
   - "지난번에 네가 ~했잖아" 류의 자연 인용이 가능한 프롬프트 구조인지

4. **에러 핸들링**
   - LLM 타임아웃/실패 시 graceful하게 처리하는지
   - brain_jobs 상태 관리 (pending → processing → done/failed)

### 수정이 필요하면

- 깨진 import, 잘못된 함수 시그니처, 누락된 에러 핸들링 등 발견 시 즉시 수정
- 로직 버그 발견 시 수정
- **새 파일/서비스 만들지 말 것** — 기존 코드만 수정

## 제약조건

- 새 파일 생성 금지
- 새 DB 테이블 금지
- 동결 기능 (정치/비밀결사/4모드) 건드리지 않기
- 기존 테스트 깨뜨리지 않기
- 수정 후 `npm test` 통과 확인

## 완료 기준

- [ ] 대화 → LLM 호출 전체 코드 경로 문서화 (result에 기록)
- [ ] memory_hint 추출 → 저장 경로 확인 및 문제점 기록
- [ ] 기억 인용 프롬프트 포함 여부 확인
- [ ] 발견된 버그/문제 수정 (있으면)
- [ ] `npm test` 통과
- [ ] `result-1.md` + `review-1.md` 작성
- [ ] `signal-1.done` 생성
