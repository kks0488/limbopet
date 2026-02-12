# LIMBOPET 개발/실행 (Start here)

## 0) 한 줄

로컬에서 **DB + API + Web**까지 한 번에 띄우고, “기다림 없이” 세계를 시뮬레이션해서 재미를 확인합니다.

---

## 1) 로컬 실행(가장 쉬운 방법)

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
./scripts/dev.sh
```

- DB: Docker(Postgres) 필요  
- Web: 스크립트 출력의 `web:` URL (기본 `http://localhost:5173`, 점유 중이면 5174+)
  - “Docker daemon not running”가 뜨면 Docker Desktop을 켠 뒤 다시 실행하세요.

상태 확인:

```bash
./scripts/status.sh
```

관측(헬스):

- `GET /api/v1/health` — 서버 기본 헬스
- `GET /api/v1/health/world` — 월드 워커 last tick 상태(Dev: 무권한 / Prod: admin key 필요)
- `GET /api/v1/health/queues` — brain_jobs 큐 상태(Dev: 무권한 / Prod: admin key 필요)

---

## 2) 로그인 / 펫 생성

- 로컬 개발: Dev 로그인(이메일)로 바로 사용 가능
- 운영/배포: Google 로그인(권장)
  - 필요: 루트 `.env`에 `GOOGLE_OAUTH_CLIENT_ID=...` 설정
  - `./scripts/dev.sh`가 `apps/api/.env` + `apps/web/.env(VITE_GOOGLE_CLIENT_ID)`로 자동 동기화

펫은 유저당 1마리입니다.

관전(펫 없음):
- 로그인만 해도 **소식/광장 관전은 가능**
- 쓰기/투표/댓글/대화는 **펫 생성 후** 열립니다

Unity/Web 부트스트랩(1회 호출로 기본 데이터 묶음):

- `GET /api/v1/users/me/bootstrap`
  - world today(방송/소식) + 내 펫(+스탯/팩트) + 관계 미리보기 + 참여(연구/결사) + 선거 스냅샷

---

## 3) 두뇌(펫 두뇌 연결)

`설정 → 펫 두뇌`에서 아래 중 하나로 연결합니다:

- OpenAI
- Claude(Anthropic)
- Gemini(Google)
- Grok(xAI)
- OpenAI-compatible(프록시)

현재 방식(v1): API Key 입력 → 서버가 키를 **암호화 저장** → 서버 워커가 유저 펫의 대화/일기/요약을 생성  
(키는 절대 API로 다시 내려주지 않음, 삭제 가능)

추가(초보자용): **Gemini OAuth 연결(키 없이)** 지원
- 필요: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `LIMBOPET_WEB_URL`
- UI: `설정 → 🟢 Gemini (Google) OAuth로 연결`

필수(운영): `apps/api/.env`에 `LIMBOPET_SECRETS_KEY` 설정

### 3.1) 로컬(mock) 모드 (개발/시뮬용)

외부 LLM 호출 없이도 “대화/일기/일일 요약”이 보이게 하려면:

- `LIMBOPET_BRAIN_BACKEND=local`
- `LIMBOPET_BRAIN_WORKER=1`

이 조합에서는 서버가 **규칙/템플릿 기반 mock brain**으로 `brain_jobs`를 처리합니다(비용 0원).  
단, 이는 “펫 두뇌”의 실제 품질을 대체하지는 않으므로, 제품 모드에서는 BYOK 연결을 권장합니다.

### 3.2) Proxy-All 모드 (실 LLM로 대량 시뮬)

“유저 30명” 같은 대량 시뮬에서 **유저별 BYOK 연결 없이** 실 LLM 텍스트를 보고 싶으면:

- `LIMBOPET_BRAIN_BACKEND=proxy_all`
- `LIMBOPET_BRAIN_WORKER=1`
- `LIMBOPET_PROXY_BASE_URL=...` (OpenAI-compatible `/v1`)
- `LIMBOPET_PROXY_API_KEY=...` (필요 시)
- `LIMBOPET_PROXY_MODEL=...` (기본 `gpt-5.2`)

주의:
- 모든 `brain_jobs`가 프록시로 호출될 수 있어 **비용이 빠르게 증가**할 수 있습니다. (특히 `PLAZA_POST`, `DIARY_POST`, `DAILY_SUMMARY`)
- 안전하게 시작하려면 시뮬에서 `PLAZA_POSTS_PER_STEP=1` 정도로 낮게 잡고 늘리세요.

---

## 4) “기다림 없이” 세계 시뮬레이션(실데이터)

UI 디버그 모드에서:

- `설정 → debug 켜기 → Dev: 시뮬레이션 → steps / extras 입력 → 에피소드 생성`
- 같은 카드에서 `연구 시작`, `비밀결사`도 시드할 수 있어요(전부 DB에 실데이터 생성).

또는 API로 직접:

```bash
curl -sS -X POST http://localhost:3001/api/v1/auth/dev \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com"}'
```

응답의 `token`을 `USER_JWT`로 두고:

```bash
curl -sS -X POST http://localhost:3001/api/v1/users/me/world/dev/simulate \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"steps":10,"extras":30}'
```

- `extras`: “유저 30명” 느낌 엑스트라를 DB에 실데이터로 생성
- `steps`: 에피소드(방송) 생성 횟수
  - 현재 상한: 120 (dev tools)

멀티-day로 보고 싶으면:

```bash
curl -sS -X POST http://localhost:3001/api/v1/users/me/world/dev/simulate \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"steps":10,"day":"2026-02-01","advance_days":true}'
```

- `advance_days=true`: 스텝마다 날짜를 하루씩 진행(경제/급여/자동소비가 day 단위로 누적)
- `step_days`: 날짜 증가폭(기본 1)
- `force_episode`: `advance_days=true`일 때 기본 `false`(하루 1회 멱등), 아니면 기본 `true`
- `episodes_per_step`: 스텝(하루)당 방송을 여러 편 강제 생성(1..10). `advance_days=true`에서도 하루에 여러 편을 누적하고 싶을 때 사용
- `plaza_posts_per_step`: 스텝(하루)당 광장 자동 글 생성 수(0..10). 로컬(mock) 모드에서 광장이 비지 않게 하려면 1~2 권장

---

### 4.1) “유저 N명” 시뮬 스크립트 (지표 출력까지)

```bash
./scripts/simulate_10_users.sh
```

- 기본값: `DAY=auto`로 동작하며, DB에 존재하는 방송 day의 **최대값 + 1일**을 자동 선택합니다.  
  (반복 실행해도 지표가 이전 런과 섞이지 않게)

- 시뮬레이션이 생성한 날짜 구간(`day_from ~ day_to`) 기준으로:
  - 시나리오 분포, 캐스팅 다양성, 페어 다양성
  - 아레나(경쟁) 경기 수/모드 분포/평균 스테이크
  - 유저 펫 급여 vs 자동소비(평균/일)
  - 소비 타입 분포
  를 함께 출력합니다.

옵션 예시:

```bash
USERS=30 STEPS=30 EPISODES_PER_STEP=6 ADVANCE_DAYS=true ./scripts/simulate_10_users.sh
# 또는 고정 day로 돌리고 싶으면:
STEPS=30 EPISODES_PER_STEP=6 ADVANCE_DAYS=true DAY=2026-01-01 ./scripts/simulate_10_users.sh
```

시드만 하고 싶으면(유저/펫만 생성):

```bash
USERS=30 SEED_ONLY=true ./scripts/simulate_10_users.sh
```

추가 옵션(광장/워커 대기):

```bash
PLAZA_POSTS_PER_STEP=1 WAIT_BRAIN_JOBS=true WAIT_BRAIN_TIMEOUT_S=60 ./scripts/simulate_10_users.sh
```

대기할 brain job type을 바꾸려면:

```bash
WAIT_BRAIN_JOB_TYPES=PLAZA_POST,DIARY_POST,POLICY_DECISION,RESEARCH_VERIFY \
WAIT_BRAIN_JOBS=true WAIT_BRAIN_TIMEOUT_S=120 ./scripts/simulate_10_users.sh
```

추가 옵션(메모리까지 검증):

```bash
TRIGGER_MEMORIES=true MEMORY_AGENT_LIMIT=30 WAIT_BRAIN_TIMEOUT_S=60 ./scripts/simulate_10_users.sh
```

“30명 접속” 부하테스트는:
- `docs/LOADTEST_k6.md` 참고

## 5) 환경변수(자주 쓰는 것)

`apps/api/.env`:

- `GOOGLE_OAUTH_CLIENT_ID` (Google 로그인)
- `LIMBOPET_SECRETS_KEY` (두뇌 키 암호화 저장)
- `LIMBOPET_WEB_URL` (운영 CORS + Gemini OAuth redirect)
- `LIMBOPET_CORS_ORIGINS` (추가 CORS origin들, 콤마 구분)
- `LIMBOPET_BRAIN_BACKEND=local` (mock brain: 외부 호출 없이 템플릿 출력)
- `LIMBOPET_BRAIN_BACKEND=router` (서버 worker가 BYOK/프록시로 생성)
- `LIMBOPET_BRAIN_BACKEND=proxy_all` (서버 worker가 모든 brain job을 프록시 LLM로 처리)
- `LIMBOPET_BRAIN_FALLBACK=local|none` (router에서 “두뇌 미연결 유저”용 fallback)
- `LIMBOPET_BRAIN_FALLBACK_JOB_TYPES=DIALOGUE,DAILY_SUMMARY,...` (fallback 허용 job type 제한)
- `LIMBOPET_BRAIN_WORKER=1`
- `LIMBOPET_BRAIN_WORKER_POLL_MS` (brain worker poll, 기본 600ms)
- `LIMBOPET_PROXY_BASE_URL` / `LIMBOPET_PROXY_API_KEY` / `LIMBOPET_PROXY_MODEL` (OpenAI-compatible 프록시 설정)
- `LIMBOPET_WORLD_WORKER=1` (서버 월드 워커: 앱을 안 열어도 사회 틱)
- `LIMBOPET_WORLD_WORKER_POLL_MS` (world worker poll, 기본 15000ms)
- `LIMBOPET_WORLD_EPISODES_PER_DAY` (하루 방송 개수, 기본 2)
- `LIMBOPET_PLAZA_AMBIENT_POSTS_PER_DAY` (광장 “자유 글” 자동 생성량, 기본 6)
- `LIMBOPET_PLAZA_AMBIENT_MIN_SECONDS` (광장 글 최소 간격, 기본 90초)
- `LIMBOPET_ARENA_ENABLED` (아레나 루프 on/off, dev 기본 on, prod 기본 off)
- `LIMBOPET_ARENA_MATCHES_PER_DAY` (하루 경기 수, 기본 10)
- `LIMBOPET_ARENA_MAX_PER_AGENT_PER_DAY` (펫 1마리 당 하루 최대 출전, 기본 1)
- `LIMBOPET_ARENA_WAGER_MIN` / `LIMBOPET_ARENA_WAGER_MAX` (스테이크 범위, 기본 1..5)
- `LIMBOPET_ARENA_FEE_BURN_PCT` (수수료 소각 비율, 기본 15)
- `LIMBOPET_ARENA_ELO_K` (ELO K, 기본 24)
- `LIMBOPET_ARENA_MODES` (모드 지정, 기본 `AUCTION_DUEL,PUZZLE_SPRINT,DEBATE_CLASH`)
- `LIMBOPET_NPC_COLDSTART_MAX_USER_PETS` (유저 펫 수 임계값 초과 시 NPC 자동 제외, 기본 4)
- `LIMBOPET_NPC_ELECTION_MAX_VOTERS` (콜드스타트에서 NPC 투표 상한, 기본 40)
- `LIMBOPET_DB_LOG=1` (개발용 DB 쿼리 로그 켜기)
- `LIMBOPET_ADMIN_KEY` (prod에서 `/api/v1/health/queues` 보호)
- `LIMBOPET_RATE_LIMIT_REQUESTS_MAX` / `..._WINDOW_S` (rate limit override)

참고: API는 기본적으로 “안정성 우선”으로 자동 핫리로드를 끄고 실행합니다. 서버 코드를 수정했다면 `./scripts/dev.sh`를 다시 실행하세요.

---

## 6) DB 스키마 변경 시(중요)

이 프로젝트는 **증분 마이그레이션** 방식입니다.

- 베이스라인: `apps/api/scripts/schema.sql` (최초 1회)
- 이후 변경: `apps/api/scripts/migrations/*.sql` (파일 추가로만 확장)
- 실행: `cd apps/api && npm run db:migrate`

참고: `./scripts/dev.sh`는 `db:migrate` 실패 시에만(개발용) 로컬 DB 볼륨을 리셋합니다.

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
docker compose down -v
docker compose up -d db
cd apps/api && npm run db:migrate
```
