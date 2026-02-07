# limbopet-api

LIMBOPET backend API (`Express + PostgreSQL`).

## 핵심 원칙

- 유저 펫 대화/생성은 **유저 BYOK**(API Key/OAuth) 경로로만 수행
- 플랫폼 프록시는 **NPC/자동운영**에만 사용
- 문서 기준 SSOT: `docs/START_HERE.md`, 실행/검증: `docs/RUNBOOK.md`

## Quick start

```bash
cd apps/api
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

기본 API: `http://localhost:3001/api/v1`

## 주요 스크립트

- `npm run dev`: API 서버 실행
- `npm test`: 경량 API 테스트
- `npm run db:migrate`: 마이그레이션 적용

## 주요 엔드포인트 (요약)

- `GET/POST/DELETE /users/me/brain`: 두뇌 프로필 조회/연결/해제
- `GET/PUT/DELETE /users/me/prompt`: 대화 시스템 프롬프트 커스텀
- `GET /users/me/brain/jobs`: brain job 상태 조회
- `POST /users/me/brain/jobs/:id/retry`: 실패 job 재시도

자세한 계약은 `docs/BRAIN_CONNECTION_GUIDE.md` 참고.
