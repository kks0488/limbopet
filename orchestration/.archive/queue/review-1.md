# Review 1: 대화 → 기억 인용 코드 경로 감사 및 수정

## 요약
대화(TALK)에서 생성되는 DIALOGUE 잡이 LLM 호출(로컬/서버 워커)로 이어지고, 결과 submit 시 `memory_hint`가 coaching facts로 저장되며, 다음 대화 프롬프트에 `memory_refs`로 재주입되는 흐름이 이미 갖춰져 있었다. 다만 프록시 설정 키 불일치와, DIALOGUE 결과 처리 중 side-effect 실패가 job submit 트랜잭션을 깨뜨릴 수 있는 위험이 있어 이를 보강했다.

## 발견 사항

### 버그/위험
- **Proxy 설정 키 불일치**: 일부 코드는 `config.limbopet.proxy.*`를, 일부는 `proxyBaseUrl`류 키를 기대하는 형태여서 환경변수(`LIMBOPET_PROXY_BASE_URL` vs `CLIPROXY_BASE_URL`) 조합에 따라 프록시 호출/관리 API 호출이 깨질 수 있음.
- **DIALOGUE 결과 side-effect가 submit 트랜잭션을 망가뜨릴 위험**: coaching facts 저장/이벤트 insert 중 하나라도 실패하면 Postgres 트랜잭션이 abort되어 brain_jobs 상태 업데이트까지 롤백될 수 있음.
- **coaching facts key 충돌 가능성**: 동일 ms에 여러 힌트를 저장하면 `${Date.now()}` 기반 key가 충돌해 힌트가 덮이거나 오류가 날 수 있음.

### 영향도
- 프록시 설정 정규화는 기존 환경변수 그대로 두고도 동작 경로를 넓히는 “호환성” 성격이라 리스크가 낮음.
- `memory_saved` 의미를 “추출됨”이 아니라 “실제로 facts 저장 성공”으로 더 정확하게 변경해 UI 배지 표시가 일부 달라질 수 있으나, 오히려 진단에 유리함.

### 개선 제안
- `memory_hint_extracted`(추출 여부) vs `memory_saved`(저장 성공)처럼 분리된 신호를 UI/분석에서 적극 활용하면 “기억이 진짜처럼 보이는지”를 더 명확히 측정 가능.
- 프록시 관련 env naming을 문서/가이드에서 한 세트로 정리(예: `LIMBOPET_PROXY_BASE_URL`를 SSOT로 두고, 관리(base) URL은 코드에서 파생)하면 설정 실수를 더 줄일 수 있음.

## 결론
OK (tests pass)

