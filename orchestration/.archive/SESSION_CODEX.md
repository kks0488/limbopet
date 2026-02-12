# codex-limbopet 세션 지시서

> tmux 세션: `codex-limbopet` | 도구: Codex
> 마스터 플랜: `.vibe/plans/plan-20260208-razor.md` → TRACK A

---

## 너의 역할

**백엔드 E2E 전문가.** 서버를 띄우고, 대화→기억→법정 파이프라인을 실제로 동작하게 만든다.

---

## 오늘 할 일 (2/8) — A1: 서버 기동 + 대화 E2E

### Step 1: 서버 올리기
```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
./scripts/dev.sh
```
- Docker Desktop 켜져 있는지 확인
- API (localhost:3001) + Web (localhost:5173) 동작 확인
- `./scripts/status.sh`로 상태 확인

### Step 2: 프록시 서버 연결
- `apps/api/.env` 확인 — LIMBOPET_PROXY_BASE_URL, LIMBOPET_PROXY_API_KEY 설정
- `GET /api/v1/health` → 200 확인
- brain job 처리 가능 상태인지 확인

### Step 3: 실제 AI 대화 테스트
- 테스트 유저로 로그인
- 펫과 대화 1회 → 응답 오는지 확인
- `memory_hint` 추출되는지 DB 확인:
  ```sql
  SELECT * FROM pet_events WHERE kind='dialogue' ORDER BY created_at DESC LIMIT 5;
  SELECT * FROM pet_facts WHERE kind='memory' ORDER BY created_at DESC LIMIT 5;
  ```

### Step 4: 기억 인용 E2E
- 대화 3회 반복
- 4번째 대화에서 이전 대화 내용이 인용되는지 확인
- 인용 안 되면 프롬프트 확인:
  - `apps/api/src/services/PetBrainService.js` — 기억 주입 로직
  - `apps/api/src/services/MemoryService.js` — 기억 조회 로직

---

## 건드리지 마

- `apps/web/` (프론트엔드는 ui-limbopet이 담당)
- `apps/web/src/styles.css`
- 동결 기능 (선거, 비밀결사, 연구소, Streaks, 4모드)
- 새 서비스 파일 생성
- 새 DB 테이블 생성

---

## 검증

매 작업 후:
```bash
cd apps/api && npm test          # 21 passed
cd ../web && npm run typecheck   # 0 errors
```

---

## 참고 문서

- 제품 SSOT: `docs/START_HERE.md`
- 방향 고정: `docs/DIRECTION.md`
- 실행 가이드: `docs/RUNBOOK.md`
- AI 두뇌 연결: `docs/BRAIN_CONNECTION_GUIDE.md`
