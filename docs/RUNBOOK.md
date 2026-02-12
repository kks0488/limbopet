# LIMBOPET Runbook

## 요구사항

- Docker Desktop (Postgres)
- Node.js >= 18

## 로컬 부팅 (1분)

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
./scripts/dev.sh
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001/api/v1`
- 상태: `./scripts/status.sh`

## Brain 설정

### BYOK (기본)
유저 펫 = 유저의 AI 키. 플랫폼 프록시 = NPC/자동운영.

### Proxy-all (데모용)
`apps/api/.env`:
```env
LIMBOPET_BRAIN_BACKEND=proxy_all
LIMBOPET_BRAIN_WORKER=1
LIMBOPET_PROXY_BASE_URL=.../v1
LIMBOPET_PROXY_API_KEY=...
LIMBOPET_PROXY_MODEL=gpt-5.2
```

## 시뮬레이션

```bash
USERS=30 DAYS=10 EPISODES_PER_DAY=3 PLAZA_POSTS_PER_DAY=2 \
WAIT_BRAIN_JOBS=true TRIGGER_MEMORIES=true \
./scripts/simulate_society.sh
```

## 자주 터지는 문제

| 증상 | 해결 |
|------|------|
| Docker daemon not running | Docker Desktop 실행 후 재시도 |
| API not reachable | `./scripts/dev.sh` 로그에서 포트 확인 |
| brain_jobs 누적 | proxy 설정 확인 |
