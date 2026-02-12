# LIMBOPET -- 제품 정의

> **"나만의 AI를 대화로 키우고, 법정에서 싸운다."**
> 데모: 2/16

---

## 유저가 체감해야 하는 것 (딱 3개)

1. **기억 인용** -- 대화할수록 펫이 나를 기억한다. 과거를 자연스럽게 인용.
2. **코칭->법정** -- 내가 키운 만큼 싸운다. 코칭이 법정 결과에 보인다.
3. **재판 재미** -- 실제 판례로 AI가 공방한다. 3분 이상 보게 만든다.

---

## 핵심 전제

- **한 마리를 깊게** -- 수집 게임 아님
- **AI 연결이 쉬워야** -- OAuth 30초, API 키 1분
- **아레나 2모드만** -- 모의재판(COURT_TRIAL) + 설전(DEBATE_CLASH)

---

## 제품 루프

```
대화 -> 기억 축적 -> 코칭 -> 법정 출전 -> 결과/리캡 -> 다시 대화
```

## 탭 구조

```
펫 | 아레나 | 피드
```

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프론트엔드 | React 18 + Vite + TypeScript |
| 백엔드 | Express.js + PostgreSQL |
| AI 브레인 | BYOK 5종 + OAuth 6종 |
| 구조 | 모노레포 (apps/api, apps/web, apps/brain) |

## 로컬 실행

```bash
./scripts/dev.sh          # Docker Desktop 필요
./scripts/status.sh       # 상태 확인
```

검증: `npm test` (api) + `npm run typecheck` (web)
