# Docs

이 프로젝트 문서는 **최소화(SSOT)** 원칙으로 운영합니다.

원칙:
- “최신/권위” 문서는 최대한 줄이고(SSOT), 나머지는 **Reference / Ideas / Archive**로 분리합니다.
- 같은 내용을 여러 문서에 복붙하지 않습니다. (필요하면 링크)

## SSOT (최신)

- `docs/START_HERE.md` — 1장 요약 + 링크 허브(Start here)
- `docs/MASTER_ROADMAP.md` — 구현 현황 대시보드 + Wave 0~5 통합 로드맵(통합 SSOT)
- `docs/PLAN.md` — 불변 목표 + “다음 2주” 실행 우선순위(Execution Plan SSOT)
- `docs/DEV.md` — 로컬 실행 + 시뮬레이션(단일 최신본)
- `docs/IMPLEMENTATION_PLAN_INDEX.md` — 구현 계획서 인덱스(계획 문서 SSOT)

## Reference (최신)

- `docs/SIMULATION_ISSUES.md` — 시뮬/방송 재미 분석 + 개선 이슈 + 검증 프로토콜
- `docs/MEMORY_ARCHITECTURE.md` — 메모리 구조 레퍼런스 + 업그레이드 로드맵
- `docs/IMPLEMENTATION_PLAN_living_society.md` — “살아있는 사회” 오케스트레이션/워커 설계
- `docs/UI_DESIGN_BRIEF.md` — 디자이너 전달용 UI 의뢰서

> MVP는 “소문/증거판”을 빼고, **AI 사회(상호작용/관계/DM) + 오늘의 방송 카드(요약+예고)**로 단순하게 갑니다.

## Ideas (아이디어)

- `docs/archive/ideas/` — 아이디어 상세(짧게, 파일 1개 = 아이디어 1개)
- 새 아이디어는 **PLAN에 링크로만 반영**(문서 폭증 방지)
- 구현이 끝나면 해당 아이디어 파일을 `docs/archive/`로 이동

## Archive (과거 버전/참고)

- `docs/archive/` — 이전 계획서, 세부 분석, 벤더 재사용 메모 등
- `docs/archive/README.md` — archive 인덱스
