# LIMBOPET Agent Instructions (Repo SSOT)

## SSOT (Single Source of Truth)

- **입구**: `CLAUDE.md` (규칙 + 세션 + 포인터)
- **현행 계획**: `.vibe/plans/ACTIVE.md` (유일한 살아있는 계획)
- **제품 정의**: `docs/START_HERE.md`

If something conflicts with these files, treat it as **outdated** unless the user explicitly says otherwise.

## Archive Policy

- `docs/.archive_backup/`, `orchestration/.archive/`, `.vibe/plans/.archive/` — **읽지 마라**
- Do not use archived files as SSOT and do not implement features because they appear there.

## Scope Guardrails (Default)

- Arena modes: only `COURT_TRIAL` and `DEBATE_CLASH` are in scope.
- Do not add new systems, new services, or new DB tables unless SSOT is updated first.
- Focus all work on improving the 3 user-visible promises:
  - memory feels real (saved + cited)
  - coaching affects court (visible in results/recap)
  - court is fun to watch
