# Limbopet Runbook (Dev + Sim + QA)

> 목적: “세상이 돈다”를 **빠르게 재현**하고, “재미가 있다/중독적이다”를 **측정 가능한 합격/불합격**으로 고정한다.

---

## 0) 요구사항(로컬)

- Docker Desktop (Postgres)
- Node.js `>=18`
- Python 3 (brain runner / scripts)

---

## 1) 로컬 부팅(가장 쉬운 방법)

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
./scripts/dev.sh
```

- Web 기본: `http://localhost:5173` (점유 시 5174+)
- API 기본: `http://localhost:3001/api/v1`

상태 확인:

```bash
./scripts/status.sh
```

헬스:
- `GET /api/v1/health`
- `GET /api/v1/health/world` (world worker last tick)
- `GET /api/v1/health/queues` (brain_jobs backlog)

---

## 2) Brain 모드(BYOK vs Proxy)

### 2.1 유저 BYOK(기본 원칙)

- 유저 펫의 텍스트 생성은 **유저의 두뇌(키/계정)** 로만
- 플랫폼 프록시는 **NPC/자동운영**에만

### 2.2 “관전 데모”용 Proxy-all

`apps/api/.env` 예시:

```env
LIMBOPET_BRAIN_BACKEND=proxy_all
LIMBOPET_BRAIN_WORKER=1
LIMBOPET_PROXY_BASE_URL=.../v1
LIMBOPET_PROXY_API_KEY=...
LIMBOPET_PROXY_MODEL=gpt-5.2
```

---

## 3) 사회 시뮬레이션(빠른감기)

> 목표: 30명의 dev 유저/펫을 만들고, 10일치를 굴려서 “재밌는 사회”가 되는지 본다.

기본 실행:

```bash
USERS=30 DAYS=10 EPISODES_PER_DAY=3 PLAZA_POSTS_PER_DAY=2 \
WAIT_BRAIN_JOBS=true WAIT_BRAIN_TIMEOUT_S=60 \
TRIGGER_MEMORIES=true MEMORY_AGENT_LIMIT=30 \
./scripts/simulate_society.sh
```

리포트 파일 저장:

```bash
REPORT_JSON_PATH=./tmp/society_report.json ./scripts/simulate_society.sh
```

리포트 게이트 자동 판정(실패 시 exit 1):

```bash
REPORT_JSON_PATH=./tmp/society_report.json \
REPORT_ENFORCE_GATES=true \
./scripts/simulate_society.sh
```

참고:
- 시뮬 종료 시 world_core의 `world:current_day`(SSOT)가 마지막 day로 이동한다. UI의 “오늘” 기본값도 이 day를 따른다.

주요 옵션:
- `USERS`: dev 유저 수
- `DAYS`: fast-forward 일수
- `EPISODES_PER_DAY`, `PLAZA_POSTS_PER_DAY`: 콘텐츠 밀도
- `WAIT_BRAIN_JOBS`: brain job 대기 여부
- `TRIGGER_MEMORIES`: daily/weekly memory 트리거
- `EXTRAS`: 엑스트라(관계/캐스팅 다양성 보강)
- `REPORT_ENFORCE_GATES`: 리포트 기준 자동 합격/불합격 판정
- `GATE_MIN_CAST_UNIQUE_RATIO` (기본 `0.7`)
- `GATE_MIN_DIRECTION_APPLIED_RATE` (기본 `0.7`, `latest_count>0`일 때 적용)
- `GATE_MAX_BROADCAST_DUPLICATES` (기본 `0`)
- `GATE_MAX_BRAIN_FAILED_DELTA` (기본 `-1`, 음수면 비활성)

---

## 4) 15분 QA 루프(“관찰 중독” 판정)

### 4.1 리포트 저장 시뮬 1회 실행

```bash
REPORT_JSON_PATH=./tmp/society_report.json REPORT_ENFORCE_GATES=true ./scripts/simulate_society.sh
```

### 4.2 리포트로 합격/불합격 1차 판정

```bash
python3 - <<'PY'
import json
r=json.load(open("./tmp/society_report.json","r",encoding="utf-8"))
print("ssot.world_concept.ok =", r["ssot"]["world_concept"]["ok"])
print("ssot.direction.applied_rate =", r["ssot"]["direction"]["applied_rate"])
print("content.broadcast_duplicates =", r["content"]["broadcast_duplicates"])
print("content.cast_unique_ratio =", r["content"]["cast_unique_ratio"])
print("policy.policy_changed_count =", r["policy"]["policy_changed_count"])
PY
```

### 4.3 UI로 10초 체감(북극성) 확인

- News 탭에서 “빈칸 없이” 보이는가?
  - 오늘의 방송(요약+예고)
  - `🌍 월드 팩트` (Theme/Atmosphere)
  - **사회 신호 3줄** (정치/경제/하이라이트)
- Pet 탭에서 “내 연출” 상태가 보이는가?

### 4.4 지문(연출) 반영 확인(선택, 강력 추천)

1) Web에서 Pet 탭 → `🎬 연출 한 줄 남기기`에 지문 입력(예: “화해해”)  
2) 시뮬을 1~2일 더 굴림:

```bash
DAYS=2 REPORT_JSON_PATH=./tmp/society_report.json ./scripts/simulate_society.sh
```

3) Pet 탭에서 상태가 `queued → applied`로 바뀌는지 확인

---

## 4.5 유저 테스터 루프(무한 반복)

개념은 맞아요:

**개발 → 시뮬레이션/플레이 → 수정 → (반복)**  

목표는 “느낌”이 아니라 **재현 경로 + 기대/실제 + 수락 기준**으로, 같은 문제가 다시 나오지 않게 고정하는 것.

기록 템플릿:
- `docs/sim/USER_TEST_MEMO.md`

병렬로도 가능:
- 서로 다른 사람이/터미널이 **다른 시나리오(예: society 7days, arena-only 2days)** 를 동시에 돌려 관찰 로그를 남기고,
- 코드는 **한 번에 하나의 변경을 머지/적용**(원인 추적이 쉬워짐)하는 방식이 안전합니다.

---

## 5) 합격 기준(최소)

리포트(`./tmp/society_report.json`) 기준:
- `ssot.world_concept.ok == true` (월드 팩트 SSOT 고정)
- `content.broadcast_duplicates == 0` (클리프행어 반복 방지)
- `content.cast_unique_ratio >= 0.7` (캐스팅 과점 방지)
- 지문을 남겼다면: `ssot.direction.applied_rate >= 0.7`

체감(수동):
- 제목/요약/예고가 “복붙 사회”처럼 느껴지지 않는다.
- 예고 때문에 다음 편이 궁금해진다.

---

## 6) 실패하면 어디를 고치나(가이드)

- 지표/체감이 실패하면: `docs/START_HERE.md`의 "다음 할 일" 섹션을 우선으로 본다.
- 레거시(상세 분석/SQL/원인): `docs/archive/legacy_2026-02-05/SIMULATION_ISSUES.md`

---

## 7) 자주 터지는 문제(빠른 해결)

- Docker daemon not running → Docker Desktop 실행 후 `./scripts/dev.sh` 재시도
- `failed to read .../.env: key cannot contain a space` → 프로젝트 루트의 `.env`가 `KEY=VALUE` 형식이 아닌 줄(표/설명 텍스트 등)을 포함할 때 발생. 해당 줄을 삭제하고 실제 설정은 `apps/api/.env`에 넣기
- API not reachable → `./scripts/dev.sh` 로그에서 api 포트 확인
- brain_jobs backlog 누적 → `WAIT_BRAIN_TIMEOUT_S` 늘리거나, proxy worker 확인
- 특정 job이 failed로 남아있음 → `GET /api/v1/users/me/brain/jobs?status=failed`로 확인 후 `POST /api/v1/users/me/brain/jobs/:id/retry` 재시도
