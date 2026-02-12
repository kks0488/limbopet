# LIMBOPET 실행 계획 v0.2 (초보자 온보딩 + “펫=비서”까지)

## 목표 (사용자 관점)

1) **회원가입 → 내 펫 1마리 생성(고유)**  
2) 브레인 연결(내 OpenAI/Claude/Gemini/Grok 등)  
3) 앱에서 **다마고치 루프(행동/상태/이벤트)** + **림보룸(오늘 기억 방)**이 바로 보임  
4) 점진적으로 “펫=비서” 기능(툴/스킬/자동화) 확장

## 핵심 원칙 (불변)

- **State is truth**: 서버가 상태/쿨다운/경제/관계를 강제한다.
- **LLM writes words**: 서버는 LLM 호출을 하지 않는다. 브레인이 텍스트를 만든다.
- **BYOK-first**: 유저의 모델/계정 자격증명은 가능한 로컬(또는 유저 프록시)에 둔다.
- **Beginner-first**: “설치/설정”을 앱이 이끈다(원클릭/마법사/에러 복구).

## 아키텍처 결론 (지금 기준)

### 1) 계정/권한 모델 (2-Token)

- **User JWT (웹앱)**: 유저 로그인 상태/펫 소유권, 유저 액션용
- **Pet API Key (브레인)**: 로컬 브레인이 서버에 Job을 pull/submit 하기 위한 키

브라우저는 원칙적으로 **Pet API Key를 몰라도** 게임 플레이가 가능해야 한다(유저 JWT로만).
Pet API Key는 “브레인 연결” 단계에서만 발급/리셋해서 로컬에 넣는다.

### 2) 모델/프로바이더 연결 (브레인 측)

- `limbopet-brain`은 **providers + auth profiles**를 가진다(OpenClaw 패턴).
- 지원 모드:
  - API key (즉시 지원)
  - token (즉시/부분 지원)
  - OAuth (OpenClaw 패턴 참고, 단계적 도입)

## 단계별 실행 (완성 조건 중심)

### Phase A — “초보자가 당장 쓸 수 있다” (지금부터 1순위)

**완성 조건**
- 웹에서 로그인(Dev + Google) → 펫 생성(유저당 1마리) → 대시보드에서 행동/상태/이벤트/림보룸 확인
- 브레인 연결 페이지에서:
  - (1) 로컬 브레인 설치/실행 안내
  - (2) Pet API Key 발급/리셋
  - (3) “연결됨” 상태 확인

**필요 작업**
- `apps/web` 추가(간단한 React/Vite 등)
- API에 유저 JWT 기반 펫 액션 엔드포인트 추가:
  - `GET /users/me/pet`
  - `POST /users/me/pet/actions`
  - `GET /users/me/pet/timeline`
  - `GET /users/me/pet/limbo/today`
  - `POST /users/me/pet/memory-nudges`
  - `POST /users/me/pet/brain-key/rotate` (Pet API Key 재발급)
- 로컬 dev 스크립트에서 web/dev 함께 구동 (선택)

### Phase B — “모델을 진짜 쉽게 붙인다 (OpenClaw 방식)” (2순위)

**완성 조건**
- `limbopet-brain onboard`가:
  - 유저 로그인(웹/로컬 선택)
  - 펫 생성/선택
  - 모델 provider 선택(OpenAI/Claude/Gemini/Grok)
  - 인증 방식 선택(api_key/token/oauth/import)
  - 검증(간단 ping/job 1개 처리)
- 자격증명은 로컬에 안전하게 저장(최소 권한/파일 권한)

**OpenClaw에서 가져올 것**
- auth profile store 구조 + 우선순위: `vendor/openclaw/src/agents/auth-profiles/*`
- provider key 해석/폴백 로직: `vendor/openclaw/src/agents/model-auth.ts`
- 온보딩 UX 흐름/문구: `vendor/openclaw/apps/macos/.../Onboarding*`

### Phase C — “펫=비서”로 확장 (3순위)

**완성 조건**
- 툴/스킬 기반 작업(알림, 일정, 웹리서치, 요약 등)을 “Job”으로 내리고 결과가 이벤트/기억으로 쌓임
- 안전장치(화이트리스트, 프롬프트 인젝션 방어, 호출량 제한)가 기본으로 작동

**OpenClaw에서 가져올 것(후반)**
- Skills/Tool 플랫폼 구조(install gating, tool streaming) 패턴

## 리스크 & 대응

- Docker/DB 설치 장벽 → `scripts/dev.sh` 같은 원클릭 + 에러 메시지 강화
- OAuth 연동 복잡성 → “ID token 검증(웹)”부터, “브레인 OAuth”는 import/token/api-key 우선
- Pet API Key 분실 → 유저 JWT로 **재발급(rotate)** 제공
- 비용 폭주 → 서버 쿨다운/일일 생성량 제한 + 브레인 측 프로바이더별 rate limit

## 다음 커밋(구현) 순서

1) `apps/web` 최소 UI + 유저 JWT 기반 펫 플레이 엔드포인트
2) 브레인 키 재발급(rotate) + “연결 상태” 확인(최근 job pull timestamp 같은 지표)
3) 브레인 온보딩 마법사(프로바이더 선택/키 입력/검증)

