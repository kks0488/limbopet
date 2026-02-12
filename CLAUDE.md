# LIMBOPET -- AI 에이전트 규칙

> 이 파일을 읽는 AI는 아래 규칙을 반드시 따른다.
> **이 파일이 유일한 입구. 여기서 시작해서 필요한 문서로 간다.**

## 제품 한 줄

**"이미 구독 중인 AI를 나만의 펫으로 살린다."**

- 어차피 모든 사람이 AI를 구독한다 -- 그 유휴 자원을 펫으로 만든다
- 한 마리를 깊게 키운다 (수집 게임 아님)
- API 키/OAuth로 유저의 AI를 연결 -- **이게 쉬워야 한다**
- 아레나 = 모의재판(COURT_TRIAL) + 설전(DEBATE_CLASH) **2모드만**

## 핵심 원칙

1. **대전제만 남기고 자유롭게** -- 강제 메카닉(쿨다운, 필수 루틴) 최소화. 자율성 우선
2. **쉬워야 한다** -- 특히 AI 연결이 30초 안에 끝나야 함. 열광 전에 쉬움이 먼저
3. **"와 이거 뭐야"** -- 대한민국 최고의 AI 앱. 사람들이 열광하게 만든다
4. **액기스만** -- 진짜 필요한 것만 남긴다. 기억 인용, 코칭->법정, 재판 재미
5. **코어 루프: 연결 -> 대화 -> 기억 -> 법정** -- 이것만 자연스럽고 매끄럽게
6. **보조 시스템(기분/레벨/쿨다운)은 보조일 뿐** -- 없어도 코어 루프는 동작해야 함

## 동결 기능 (절대 건드리지 마라)

코드가 있어도 **수정, 개선, 참조, 언급 모두 금지:**

- 정치/선거 시스템
- 비밀결사
- 연구소
- Streaks/시즌
- 아레나 4모드: PUZZLE_SPRINT, MATH_RACE, PROMPT_BATTLE, AUCTION_DUEL
- 새 서비스 파일, 새 DB 테이블, 새 아레나 모드

**위반하면 전부 되돌린다.**

## 문서 체계 (SSOT)

| 파일 | 용도 |
|------|------|
| **이 파일 (CLAUDE.md)** | 규칙 + 방향 + 포인터 (유일한 입구) |
| **`.vibe/plans/ACTIVE.md`** | 현재 상태 + 남은 작업 (유일한 계획) |
| `docs/START_HERE.md` | 제품 정의 (레퍼런스) |
| `docs/RUNBOOK.md` | 로컬 실행법 (레퍼런스) |
| `docs/DEMO_SCENARIO.md` | 데모 시나리오 (레퍼런스) |
| `docs/BRAIN_CONNECTION_GUIDE.md` | 두뇌 연결 상세 (레퍼런스) |

**규칙: 뭔가 바뀌면 최대 2파일만 수정 (CLAUDE.md + ACTIVE.md). 3파일 이상이면 구조가 잘못된 것.**

읽지 마라: `docs/.archive_backup/`, `.vibe/plans/.archive/`, `.vibe/.archive/`

## 프로젝트 구조

```
apps/api/    -- Express API 백엔드
apps/web/    -- React 18 + Vite + TypeScript 프론트엔드
apps/brain/  -- LLM Brain Worker
docs/        -- 레퍼런스 문서
scripts/     -- dev/status/simulate 스크립트
```

## 코딩 컨벤션

| 패턴 | 위치 |
|------|------|
| 서비스 | `apps/api/src/services/XxxService.js` (static method) |
| 라우트 | `apps/api/src/routes/*.js` (Express Router) |
| 마이그레이션 | `apps/api/scripts/migrations/0NNN_*.sql` (번호순) |
| 베이스라인 | `apps/api/scripts/schema.sql` (마이그레이션과 동기화) |
| 프론트 API | `apps/web/src/lib/api.ts` |
| 메인 UI | `apps/web/src/App.tsx` (506줄, 탭별 분리됨) |
| 탭 컴포넌트 | `apps/web/src/PetTab.tsx`, `ArenaTab.tsx`, `FeedTab.tsx` |
| 스타일 | `apps/web/src/styles.css` (CSS 변수 기반) |

## 작업 원칙

1. 기존 기능 절대 깨뜨리지 말 것
2. 작업 후 `npm test` (api) + `npm run typecheck` (web) 실행
3. DB 변경 시 마이그레이션 + 베이스라인 동시 반영
4. 한국어 기본
5. Claude Code는 항상 `--dangerously-skip-permissions` 모드로 실행

## 세션 (2개만)

| 세션 | 도구 | 역할 |
|------|------|------|
| `cx-main` | Codex | 백엔드 전부 (프롬프트, API, DB, 로직) |
| `cl-ui` | Claude | 프론트 전부 (UI, 테스트, 문서, 글쓰기) |

**Codex = 백엔드, Claude = 프론트. 각 1개씩만. 같은 파일 동시 수정 금지.**

## tmux 규칙

```bash
# Enter 키 전달: 텍스트와 Enter 분리
tmux send-keys -t <세션> "명령어"
sleep 1
tmux send-keys -t <세션> Enter
```
