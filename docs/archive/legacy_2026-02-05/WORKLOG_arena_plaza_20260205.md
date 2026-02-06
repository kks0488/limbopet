# WORKLOG: Arena 관전 + Plaza 게시판 + 30유저 시뮬 QA

- 작업일: 2026-02-05
- 작업자: Codex

## ✅ 작업 범위 / 체크리스트

- [x] dev 환경 기동 + 마이그레이션 적용/검증
- [x] 워커(Brain/World) 헬스 체크 및 local backend 설정
- [x] 백엔드: 아레나 모드 3종 + 리캡 생성 + plaza 게시판 API + 관전 상세 API
- [x] 백엔드: 한글 닉네임 지원(표시명) + 안전한 ASCII 핸들 자동 생성
- [x] 웹: Plaza 탭(검색/필터/정렬/더보기) + 글 상세 모달 + 댓글 작성 + 아레나 관전 모달
- [x] 웹: “소식 탭 먹통(Blank)” 런타임 에러 수정 + ErrorBoundary 추가
- [x] UI 자동 스모크(버튼 클릭/탭 전환) Playwright 추가
- [x] 30유저 시뮬(실DB) 실행 + DB 검증 쿼리 기록
- [x] 30유저 × 10일 fast-forward “사회 시뮬” + 상호작용(좋아요/댓글) + 무결성 체크
- [x] 품질 게이트: `apps/api npm test`, `apps/web npm run build`
- [x] 문서 SSOT 업데이트(Implementation plan)

## ✅ 실행 커맨드 로그

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet

# port check
lsof -n -P -iTCP:3001 -sTCP:LISTEN || true
lsof -n -P -iTCP:5173 -sTCP:LISTEN || true

# dev boot (db up + migrate + api/web)
./scripts/dev.sh

# migration verification
DB_URL='postgresql://postgres:postgres@localhost:5433/limbopet'
psql "$DB_URL" -Atc "SELECT name FROM limbopet_migrations ORDER BY applied_at;"
psql "$DB_URL" -Atc "SELECT column_name FROM information_schema.columns WHERE table_name='posts' AND column_name='meta';"
psql "$DB_URL" -Atc "SELECT indexname FROM pg_indexes WHERE tablename='posts' AND indexname IN ('idx_posts_meta_kind','idx_posts_unique_ref') ORDER BY 1;"

# worker health
curl -sS http://localhost:3001/api/v1/health/queues | python3 -m json.tool | head

# (권장) 외부 LLM 없이 시뮬이 돌도록
# apps/api/.env: LIMBOPET_BRAIN_BACKEND=local, LIMBOPET_BRAIN_WORKER=1, LIMBOPET_WORLD_WORKER=1

# UI smoke (Playwright)
cd apps/web
npm install -D @playwright/test
npx playwright install chromium
npm run test:ui
cd ../..

# 30유저 시뮬(QA)
USERS=30 STEPS=8 EPISODES_PER_STEP=3 PLAZA_POSTS_PER_STEP=2 \
ADVANCE_DAYS=true STEP_DAYS=1 WAIT_BRAIN_JOBS=true WAIT_BRAIN_TIMEOUT_S=120 \
TRIGGER_MEMORIES=true MEMORY_AGENT_LIMIT=30 \
./scripts/simulate_10_users.sh

# 한글 닉네임(표시명) 생성 스모크
API_URL=http://localhost:3001/api/v1
TOKEN=$(curl -sS -X POST "$API_URL/auth/dev" -H 'Content-Type: application/json' -d '{"email":"ko_nick_test@example.com"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
curl -sS -X POST "$API_URL/pets/create" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"하늘고양이","description":"korean nick test"}' | python3 -m json.tool | head

# 30유저 × 10일 fast-forward 사회 시뮬(실DB + 상호작용 + 체크)
USERS=30 DAYS=10 EPISODES_PER_DAY=3 PLAZA_POSTS_PER_DAY=2 \
KOREAN_NICKNAMES=true INTERACTIONS=true LIKES_PER_DAY=40 COMMENTS_PER_DAY=12 \
WAIT_BRAIN_JOBS=true WAIT_BRAIN_TIMEOUT_S=60 TRIGGER_MEMORIES=true MEMORY_AGENT_LIMIT=30 \
./scripts/simulate_society.sh

# DB 검증 쿼리 (window=2029-06-26..2029-07-03, day_to=2029-07-03)
psql "$DB_URL" -Atc "SELECT COUNT(*) FROM posts WHERE post_type='arena';"
psql "$DB_URL" -Atc "SELECT COUNT(*) FROM posts WHERE meta->>'ref_type'='arena_match';"
psql "$DB_URL" -Atc "SELECT COUNT(*) FROM arena_matches WHERE COALESCE(meta->>'recap_post_id','') <> '';"
psql "$DB_URL" -Atc "SELECT mode, COUNT(*) FROM arena_matches WHERE day BETWEEN '2029-06-26' AND '2029-07-03' GROUP BY 1 ORDER BY 2 DESC;"
psql "$DB_URL" -Atc "SELECT COUNT(*) FROM memories WHERE scope='daily' AND day='2029-07-03';"

# window-specific sanity (repro counts)
psql "$DB_URL" -Atc "SELECT COUNT(*) FROM posts WHERE post_type='arena' AND meta->>'day' BETWEEN '2029-06-26' AND '2029-07-03';"
psql "$DB_URL" -Atc "SELECT COUNT(*) FROM arena_matches WHERE day BETWEEN '2029-06-26' AND '2029-07-03' AND COALESCE(meta->>'recap_post_id','') <> '';"

# 품질 게이트
cd apps/api && npm test
cd ../web && npm run typecheck
cd ../web && npm run build
```

## ✅ 에러 / 재시도 로그

```text
- 소식 탭 클릭 시 화면이 비는 현상:
  - 원인: `refreshElections` 함수의 중괄호가 잘못 닫혀 `refreshParticipation`이 함수 내부에 중첩되어 런타임 에러 발생
  - 조치: `apps/web/src/App.tsx`에서 스코프/중괄호 정리 + ErrorBoundary로 전체 화면 먹통 방지

- scripts/simulate_society.sh 초기 실행 실패:
  - 원인1: macOS 기본 bash(3.2)에서 `mapfile` 미지원
  - 조치1: while-read로 배열 로드하도록 수정
  - 원인2: `brain_jobs.payload` 컬럼 참조(실제 컬럼은 `input`)
  - 조치2: `input->>'day'`로 수정

- 30유저 사회 시뮬 “좋아요”가 일부 실패/토글로 흔들림:
  - 원인: VoteService 정책상 자기 글 upvote는 `400 Cannot vote on your own content`
  - 조치: `scripts/simulate_society.sh`가 DB에서 `posts(id, author_id)` 풀을 읽어 self-vote 회피 + HTTP code 분포 출력
  - 결과: likes/day 실패 0으로 안정화(2xx 분포로 확인)

- Web dev 로그인에서 `Load failed`(네트워크 에러) 발생 가능:
  - 원인: (특히 폰/다른 PC에서) Vite dev 서버를 `http://<LAN IP>:5173`로 열면 `VITE_API_URL=http://localhost:3001`은 “접속 기기”의 localhost를 가리켜 API fetch가 실패함
  - 조치: `apps/web/src/lib/api.ts`에서 페이지 hostname이 localhost가 아닐 때 API URL의 localhost를 hostname으로 자동 치환(개발자 친화)
```

## ✅ 완료 증거

- 마이그레이션 적용 확인(2026-02-05):
  - migrations (tail): `... 0003_arena_core.sql / 0004_posts_meta.sql`
  - posts.meta 컬럼: `meta`
  - 인덱스: `idx_posts_meta_kind`, `idx_posts_unique_ref`
- 워커/백엔드 확인(2026-02-05): `/health/queues` → `brain_backend=local`, `brain_worker=true`, `world_worker=true`
- UI 자동 스모크(2026-02-05): `apps/web npm run test:ui` PASS (탭/모달/버튼 클릭, 콘솔 에러 감시)
- 시뮬 결과 지표(30유저, window=2029-06-26..2029-07-03):
  - episodes: `24`
  - plaza posts(events): `16`
  - arena matches(window): `80` (6모드 모두 등장)
  - DAILY_SUMMARY 메모리 생성(day_to=2029-07-03): `30`
- 30유저 × 10일 fast-forward 사회 시뮬(실DB, window=2029-07-16..2029-07-25):
  - episodes: `30` (3/day)
  - arena matches(window): `100` (10/day, recap 무결성 ok)
  - interactions: comments `120` (12/day), likes `요청 400`(일부 중복/토글/재시도 가능)
  - DAILY_SUMMARY 메모리 생성(day_to=2029-07-25): `30`
  - DB 검증 쿼리:
  - totals:
    - `posts post_type='arena'`: `480` *(반복 시뮬로 누적됨)*
    - `posts meta.ref_type='arena_match'`: `480` *(반복 시뮬로 누적됨)*
    - `arena_matches meta.recap_post_id`: `480` *(반복 시뮬로 누적됨)*
  - window sanity(2029-06-26..2029-07-03):
    - `posts(post_type='arena', meta.day in window)`: `80`
    - `arena_matches(recap_post_id in window)`: `80`
  - modes(window): `DEBATE_CLASH(21), AUCTION_DUEL(20), PUZZLE_SPRINT(16), MATH_RACE(8), PROMPT_BATTLE(8), COURT_TRIAL(7)`

- 30유저 × 10일 fast-forward 사회 시뮬(개선 후, window=2029-07-26..2029-08-04):
  - episodes: `30` (3/day)
  - arena matches(window): `100` (10/day, recap 무결성 ok)
  - interactions: likes `400 (HTTP 200)`, comments `120 (HTTP 201)` *(self-vote 회피 + JSON body 안전화)*
  - DAILY_SUMMARY 메모리 생성(day_to=2029-08-04): `30`
- UI 체크리스트(수동):
  - 광장 탭: kind=arena 필터 → 아레나 리캡 글 목록 노출
  - 검색(q) 동작(Enter/검색 버튼) + 초기화 + 더보기(hasMore)
  - 글 클릭 → 상세 모달(본문 pre-wrap, 댓글 트리 들여쓰기)
  - 아레나 리캡 글 상세 → “경기 관전” → 관전 모달(meta 렌더)
  - 소식 탭: 아레나 경기 클릭 → 관전 모달 → “리캡 글 보기” → 글 상세 모달
- 테스트/빌드 PASS:
  - `apps/api npm test`: `15 passed, 0 failed`
  - `apps/web npm run typecheck`: PASS
  - `apps/web npm run build`: PASS
  - `apps/web npm run test:ui`: PASS
