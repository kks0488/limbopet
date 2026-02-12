# LIMBOPET 부하테스트(k6) — “30명 접속” 재현

> 목적: “유저 30명이 동시에 접속해 `worldToday/pet/feed/arena`를 새로고침” 하는 상황을 **실제 HTTP 요청**으로 재현해, 에러율/지연(p95)/5xx를 확인합니다.

---

## 0) 전제

- API가 실행 중이어야 합니다: `./scripts/dev.sh`
- Dev 로그인 유저 30명 + 펫 30마리가 존재해야 합니다

펫 시드(예: 30명 생성만 하고 종료):

```bash
USERS=30 SEED_ONLY=true ./scripts/simulate_10_users.sh
```

---

## 1) k6 설치

macOS(Homebrew):

```bash
brew install k6
```

설치 확인:

```bash
k6 version
```

### 설치 없이 (Docker)

k6를 로컬에 설치하기 싫다면 Docker로도 실행할 수 있습니다:

```bash
API_URL=http://host.docker.internal:3001/api/v1 USERS=30 VUS=30 DURATION=10m \
docker run --rm -i -v "$PWD":/work -w /work \
  -e API_URL -e USERS -e VUS -e DURATION -e SLEEP_MIN_S -e SLEEP_MAX_S \
  grafana/k6 run scripts/load/k6_30_users.js
```

- macOS/Windows: `host.docker.internal` 사용
- Linux: `API_URL=http://localhost:3001/api/v1` + `--network host` 권장

---

## 2) 실행

기본(30 VUs, 10분):

```bash
API_URL=http://localhost:3001/api/v1 USERS=30 VUS=30 DURATION=10m \
k6 run scripts/load/k6_30_users.js
```

### 조절 가능한 환경변수

- `API_URL` (default: `http://localhost:3001/api/v1`)
- `USERS` (default: 30) — dev 로그인 계정 수(`pet01..petNN`)
- `VUS` (default: 30) — 동시 접속 수
- `DURATION` (default: `10m`)
- `SLEEP_MIN_S` / `SLEEP_MAX_S` (default: `0.5` / `1.5`) — 요청 사이 think time

---

## 3) 시나리오(스크립트가 하는 일)

각 VU는 자신의 토큰으로 반복 호출합니다:

- `GET /users/me/world/today`
- `GET /users/me/pet`
- `GET /users/me/feed?sort=new&limit=10...`
- `GET /users/me/world/arena/today?limit=10`

토큰은 `setup()`에서 한 번만 발급합니다:
- `POST /auth/dev` (`pet01@example.com` … `pet30@example.com`)

---

## 4) 통과 기준(로컬 가이드)

스크립트 기본 thresholds:

- `http_req_failed` < 1%
- `p95(http_req_duration)` < 800ms

로컬/도커 환경 편차가 있으니, 상대 비교(개선 전/후) 지표로도 충분합니다.

---

## 5) 자주 발생하는 문제

### 401/403이 많음
- DB를 리셋했거나 유저가 없을 수 있어요 → 다시 시드:
  - `USERS=30 SEED_ONLY=true ./scripts/simulate_10_users.sh`

### `pet`이 null
- 펫을 만들지 않은 계정일 수 있어요 → 시드로 생성하세요.

### 응답이 느림/5xx
- API 로그와 함께 확인:
  - `./scripts/status.sh`
  - DB 컨테이너 리소스 부족(Docker Desktop CPU/RAM) 가능
