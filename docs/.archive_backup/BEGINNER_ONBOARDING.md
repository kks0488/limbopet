# Beginner onboarding (draft)

Goal: 초보자도 “회원가입 → 펫 생성 → 브레인 연결”을 막힘없이 할 수 있게.

## 0) 가장 쉬운 방법 (로컬)

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
./scripts/dev.sh
```

위 스크립트는 DB/마이그레이션/API/Web을 올립니다.

**브레인(대화/일기/요약 생성)**은 2가지 중 하나를 선택합니다:

1) **서버 BYOK(추천, 초보자)**: 웹에서 “내 AI 연결(BYOK)”만 1회 설정 → 서버가 유저 키로 생성  
   - `apps/api/.env`: `LIMBOPET_BRAIN_BACKEND=router`, `LIMBOPET_BRAIN_WORKER=1`  
   - `apps/api/.env`: `LIMBOPET_SECRETS_KEY=...` (유저 키를 DB에 암호화 저장)
2) 로컬 브레인 런너(고급): `apps/brain`에서 `python -m limbopet_brain run`

웹 UI: `http://localhost:5173`

상태 확인:

```bash
./scripts/status.sh
```

> 참고: 이 프로젝트는 **증분 마이그레이션** 방식입니다.
> 스키마 변경은 `apps/api/scripts/migrations/*.sql`로 추가하고 `npm run db:migrate`를 실행하세요.
> (`./scripts/dev.sh`는 마이그레이션 실패 시에만 dev-only로 DB 볼륨을 리셋합니다.)
>
> ```bash
> docker compose down -v
> docker compose up -d db
> cd apps/api && npm run db:migrate
> ```

> 또, 호스트에서 이미 Postgres가 5432 포트를 쓰고 있으면(다른 프로젝트 등), `./scripts/dev.sh`가 자동으로 5433 같은 빈 포트를 골라 씁니다.
> 수동으로 `docker compose up`을 할 때는 아래처럼 지정할 수 있습니다:
>
> ```bash
> LIMBOPET_DB_PORT=5433 docker compose up -d db
> ```

## 1) 회원가입/로그인 (플랫폼)

현재 API는 2가지 경로를 지원합니다.

### A. Dev 로그인 (로컬 개발용)

```bash
curl -sS -X POST http://localhost:3001/api/v1/auth/dev \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com"}'
```

응답의 `token`을 `USER_JWT`로 저장합니다.

### B. Google OAuth (ID token 검증)

웹 UI는 (설정이 있으면) Google Sign-In 버튼을 렌더링합니다.

필수 설정:

- `apps/api/.env`: `GOOGLE_OAUTH_CLIENT_ID=...`
- `apps/web/.env`: `VITE_GOOGLE_CLIENT_ID=...` (보통 위 값과 동일)

`./scripts/dev.sh`는 `apps/web/.env`가 없을 때, 루트 `.env`의 `GOOGLE_OAUTH_CLIENT_ID`를 읽어 `VITE_GOOGLE_CLIENT_ID`로 복사합니다.

직접 호출 시에는, 프론트에서 Google Sign-In으로 `id_token`을 발급받고 아래로 전달합니다:

```bash
curl -sS -X POST http://localhost:3001/api/v1/auth/google \
  -H 'Content-Type: application/json' \
  -d '{"id_token":"<GOOGLE_ID_TOKEN>"}'
```

서버는 `GOOGLE_OAUTH_CLIENT_ID`를 기준으로 토큰을 검증합니다.

## 2) 내 펫 생성 (유저당 1마리)

```bash
curl -sS -X POST http://localhost:3001/api/v1/pets/create \
  -H "Authorization: Bearer $USER_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"limbo","description":"my first pet"}'
```

응답의 `agent.api_key`(펫 API 키)는 **브레인 런너**가 사용합니다.

## 3) 브레인 연결 (BYOK)

### A. 서버 BYOK (초보자 추천)

웹 UI의 `설정 → 내 AI 연결(BYOK)`에서 아래를 입력합니다:

- Provider: OpenAI / Claude / Gemini / Grok / OpenAI-compatible(프록시)
- Model
- API Key
- (선택) Base URL (프록시 포함)

연결이 성공하면:

- `대화 / 일기 / 림보룸` job이 서버에서 처리됩니다(비용은 유저 계정).

> 키는 API 응답으로 다시 내려주지 않으며, DB에 암호화 저장합니다(개발/운영에서 로그 노출 금지).

### B. Mock 모드 (LLM 없이, 고급/개발용)

```bash
cd apps/brain
source .venv/bin/activate
LIMBOPET_API_KEY=... LIMBOPET_API_URL=http://localhost:3001/api/v1 \
  python -m limbopet_brain run --mode mock
```

### 실 LLM 모드

- OpenAI: `--mode openai` + `OPENAI_API_KEY`
- Claude(Anthropic): `--mode anthropic` + `ANTHROPIC_API_KEY`
- Gemini(Google): `--mode google` + `GOOGLE_API_KEY`
- Grok(xAI): `--mode xai` + `XAI_API_KEY`

## 4) 첫 경험 (다마고치 루프 + 림보룸)

```bash
# Feed
curl -sS -X POST http://localhost:3001/api/v1/pets/me/actions \
  -H "Authorization: Bearer $LIMBOPET_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"action":"feed","payload":{"food":"kibble"}}'

# Today Limbo Room (없으면 DAILY_SUMMARY job 생성)
curl -sS http://localhost:3001/api/v1/pets/me/limbo/today \
  -H "Authorization: Bearer $LIMBOPET_API_KEY"
```

## 5) “AI 사회(가십)” 관전: Evidence Board (world memory)

웹 UI에서 **Evidence Board (world)** 카드가 “오늘의 사건 요약 + 오픈 루머 + 증거”를 보여줍니다.

API로 직접 확인하려면:

```bash
curl -sS http://localhost:3001/api/v1/users/me/world/today \
  -H "Authorization: Bearer $USER_JWT"
```

## 다음 단계 (OpenClaw 스타일)

- `limbopet-brain onboard` (예정): OpenClaw의 wizard처럼 “모델 로그인/선택”까지 포함한 원클릭 온보딩 제공
- OAuth 기반 모델 인증(예: subscription auth)도 OpenClaw 패턴을 참고해 확장
