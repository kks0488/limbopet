# Limbopet Orchestration Workflow: Claude + Codex

> Claude Code와 Codex CLI가 읽는 공유 규약

---

## 역할 정의

### Claude Code (Opus) — 감독관/두뇌
- **설계**: 아키텍처, 태스크 분해, 구현 스펙 작성
- **시뮬레이션**: 엣지케이스 분석, 영향도 평가
- **판단**: 리뷰 결과 보고 수정 지시 or 다음 태스크 결정
- **문서화**: docs/ 업데이트
- **코드를 직접 작성하지 않음** — 생각하고 지시만 함

### Codex CLI (GPT-5.3) — 실무자/손
- **코딩**: 실제 코드 구현, 수정, 리팩토링
- **리뷰**: 자기가 쓴 코드 셀프리뷰
- **테스트**: 테스트 작성 및 실행
- **결과 보고**: 구현 결과와 리뷰를 문서로 작성

---

## 사이클

```
유저: "OO 만들어"
    │
    ▼
① Claude → 설계 + task-N.md 작성 (queue/)
    ▼
② Codex → task-N.md 읽고 코딩 → git commit → result-N.md 작성
    ▼
③ Codex → 셀프리뷰 → review-N.md 작성 → signal-N.done
    ▼
④ Claude → result + review 읽고 시뮬레이션
         → 수정 필요 시 → fix-task-N.md 작성 → ②로
         → OK면 → 다음 task-(N+1).md 작성 → ②로
    ▼
⑤ 모든 태스크 완료 → Claude가 문서 업데이트
```

---

## 파일 규약

### 큐 디렉토리: `orchestration/queue/`

| 파일 | 작성자 | 내용 |
|------|--------|------|
| `task-N.md` | Claude | 태스크 스펙 (목표, 대상파일, 제약조건) |
| `result-N.md` | Codex | 구현 결과 (변경파일, commit hash, 설명) |
| `review-N.md` | Codex | 셀프리뷰 (버그, 영향도, 개선점) |
| `simulation-N.md` | Claude | 시뮬레이션 결과 (엣지케이스, 판단) |
| `fix-task-N.md` | Claude | 수정 지시 (시뮬레이션 기반) |
| `signal-N.done` | Codex | 완료 신호 (빈 파일) |

---

## 프로젝트 컨텍스트

- **경로**: `/Users/kyoungsookim/Downloads/00_projects/limbopet`
- **프론트**: `apps/web/` (React 18 + Vite + TS)
- **백엔드**: `apps/api/` (Express + PostgreSQL)
- **브레인**: `apps/brain/` (Python LLM Worker)
- **SSOT**: `docs/START_HERE.md`
- **목표**: 2월 16일 내부 데모

---

## tmux 세션

| 세션 | 에이전트 | 역할 |
|------|----------|------|
| 메인 터미널 | Claude Code | 감독관 |
| `codex-limbopet` | Codex CLI | 실무자 (코드) |
| `claude-ui` | Claude Code | UI 작업 |
| `claude-simulation` | Claude Code | 시뮬레이션 |

---

## 통신 프로토콜

1. **Claude -> Codex**: `queue/task-N.md` 작성 후, tmux로 Codex에 전달
2. **Codex -> Claude**: `queue/result-N.md` + `queue/review-N.md` 작성 후 완료 신호
3. **완료 신호**: `queue/signal-N.done` 빈 파일 생성
4. **Claude 감지**: signal 파일 확인 후 시뮬레이션 시작
