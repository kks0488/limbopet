# LIMBOPET — AI 규칙

## tmux 세션 제어 규칙

### Claude Code 실행 방법
항상 bypass(YOLO) 모드로 실행:
```bash
claude --dangerously-skip-permissions
```

### Enter 키 전달 (중요!)
tmux send-keys로 명령 전달 시 **반드시 텍스트와 Enter를 분리**할 것:

```bash
# ❌ 이렇게 하지 마라 (Enter 안 먹힘)
tmux send-keys -t limbopet "명령어" Enter

# ✅ 이렇게 해라 (텍스트 → 대기 → Enter 별도)
tmux send-keys -t limbopet "명령어"
sleep 1
tmux send-keys -t limbopet Enter
```

Claude Code 세션은 Enter를 **두 번** 보내야 할 수 있음:
```bash
tmux send-keys -t limbopet-ui "프롬프트"
sleep 1
tmux send-keys -t limbopet-ui Enter
sleep 1
tmux send-keys -t limbopet-ui Enter
```

### 활성 세션 목록

| 세션 | 도구 | 역할 |
|------|------|------|
| `limbopet` | Codex (GPT-5.3) | 백엔드/서비스 코드 수정 |
| `limbopet-ui` | Claude Code (Opus 4.6) | 프론트엔드 UI/그래픽 |
| `limbopet-text` | Claude Code (Opus 4.6) | 텍스트/대사/메시지 다듬기 전문 |
| `simulation` | Codex (GPT-5.3) | 시뮬레이션/테스트 |

---

## 프로젝트 구조

- `apps/api/` — Express API 백엔드
- `apps/web/` — React 18 + Vite 프론트엔드
- `apps/brain/` — LLM Brain Worker
- `docs/` — SSOT 문서
- `scripts/` — dev/status/simulate 스크립트

## SSOT 문서

- `docs/START_HERE.md` — 제품 SSOT (세계관 + 기능 + 현황 + 백로그 + 비전) — **이것만 보면 됨**
- `docs/RUNBOOK.md` — 로컬 실행 + 시뮬 + QA
- `docs/BRAIN_CONNECTION_GUIDE.md` — AI 두뇌 연결 가이드
- `docs/archive/` — 과거 문서 (필요할 때만)

## 코딩 컨벤션

- 서비스: `apps/api/src/services/XxxService.js` (static method 패턴)
- 라우트: `apps/api/src/routes/*.js` (Express Router)
- 마이그레이션: `apps/api/scripts/migrations/0NNN_*.sql` (번호순)
- 베이스라인: `apps/api/scripts/schema.sql` (마이그레이션과 동기화)
- 프론트 API: `apps/web/src/lib/api.ts`
- 메인 UI: `apps/web/src/App.tsx` (모놀리스 — 컴포넌트 분리 진행 중)
- 스타일: `apps/web/src/styles.css`

## 작업 원칙

- 기존 기능 절대 깨뜨리지 말 것
- 작업 후 반드시 `npm test` (api) + `npm run typecheck` (web) 실행
- DB 변경 시 마이그레이션 + 베이스라인 동시 반영
- 한국어 기본
- **컨텍스트/세션 관리는 신경 쓰지 마라** — 세션 정리, /compress, /clear 등은 운영자가 알아서 한다. 작업에만 집중할 것.
