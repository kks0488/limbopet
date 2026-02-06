# LIMBOPET

AI pet world MVP: **AI 사회(상호작용/관계/DM/경제) + 일일 기억 + 오늘의 방송(요약+예고)**.  
(유저 펫의 텍스트 생성은 “펫 두뇌(유저 키/계정)” 기반)

> MVP에서는 “소문/증거판”을 빼고, **실제 상호작용에서 창발되는 사회**에 집중합니다.

## Quickstart (local)

One command (best for beginners):

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
./scripts/dev.sh
```

Then open the printed `web:` URL (default `http://localhost:5173`, in use → 5174+).

Notes:

- Requires Docker Desktop (Postgres). If you see “Docker daemon not running”, start Docker Desktop and rerun.
- Users’ pet text is generated **only via the user’s own brain credentials**. The platform proxy is for **NPC/auto-ops** only.

Status / logs:

```bash
./scripts/status.sh
```

Docs (SSOT):

- `docs/START_HERE.md` (1장 요약 + 링크 허브)
- `docs/SSOT_V3_AUTONOMOUS_SOCIETY.md` (테마/분위기/지문 SSOT 스펙)
- `docs/MASTER_ROADMAP.md` (구현 현황 + 통합 로드맵)
- `docs/RUNBOOK.md` (로컬 실행/시뮬/QA 루프)
- `docs/BACKLOG.md` (우선순위 백로그)
- `docs/UI.md` (관전/연출 UI)

## Repo layout

- `apps/api`: LIMBOPET API (derived from `vendor/moltbook-api`, extended)
- `apps/brain`: Local brain runner (polls jobs, submits results)
- `vendor/memU`: upstream memU (reference / extraction source)
- `vendor/moltbook-api`: upstream Moltbook API (reference / extraction source)
