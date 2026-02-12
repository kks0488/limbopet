# 006. 초보자 온보딩 — 구독형 AI 연동 (OAuth)

> ⚠️ 상태: **아카이브(상세 참고용)**. 최신 온보딩/제품 루프는 `docs/START_HERE.md`, `docs/MASTER_ROADMAP.md`를 먼저 보세요.

> 상태: 부분 구현 (Gemini OAuth)
> 배치: Phase 1(경제)과 함께 — “키 기반 두뇌 연결” 대체/확장
> 의존: user_brain_profiles, agents, brain_jobs

## 현재 구현(2026-02-03)

- ✅ **Gemini OAuth 연결(키 없이)**: `설정 → 🟢 Gemini (Google) OAuth로 연결`
  - 서버 저장: `user_brain_profiles.mode='oauth'`, `provider='google'`
  - 토큰 갱신: refresh token으로 자동 갱신
- ✅ 유저 로그인: Google Sign-In(ID token) + Dev 로그인(로컬)
- ⏳ 미구현: OpenAI/Claude/Grok “구독 OAuth로 API 대체”는 ToS/정책 이슈가 커서 보류(키 방식 유지)

필수 환경변수:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `LIMBOPET_WEB_URL` (OAuth 성공 후 리다이렉트)

---

## 한 줄 요약

API 키 없이도 **ChatGPT Plus, Gemini Pro, Claude Pro, Grok(X Premium)** 구독만 있으면 OAuth 로그인으로 펫 두뇌를 연결할 수 있게 한다. 초보자 진입장벽 제거.

---

## 왜 필요한가

현재 “키로 두뇌 연결” 방식의 문제:

```
초보자의 현실:
  "API 키가 뭐야?"
  "어디서 발급받아?"
  "결제 등록? 토큰 단위 과금? 무서워..."
  → 이탈
```

| 항목 | API 키 (현재) | OAuth 구독 (목표) |
|------|-------------|-----------------|
| 난이도 | 개발자 수준 | 구글 로그인 수준 |
| 비용 구조 | 종량제 (토큰당) | 월 정액 (이미 결제 중) |
| 설정 단계 | 5~8단계 | 2~3단계 |
| 대상 | 개발자 | 누구나 |
| 심리적 장벽 | "돈이 얼마 나올지 모르겠어" | "이미 구독 중이니까 OK" |

---

## 프로바이더별 현황 조사

### 1. Google Gemini — OAuth 공식 지원

**현황:**
- Google OAuth → Gemini API 접근 **공식 지원**
- Gemini CLI도 Google 계정 로그인으로 동작
- AI Pro/Ultra 구독자는 OAuth로 높은 쿼터 사용 가능
- 무료 티어도 OAuth로 Gemini 2.5 Flash 사용 가능

**구현 가능성: 높음 (공식 지원)**

**참고 프로젝트:**
- [google-gemini/cookbook - OAuth Quickstart](https://github.com/google-gemini/cookbook/blob/main/quickstarts/Authentication_with_OAuth.ipynb)
- [jenslys/opencode-gemini-auth](https://github.com/jenslys/opencode-gemini-auth) — Gemini OAuth 플러그인
- [Gemini CLI Auth Docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md)

**주의점:**
- AI Pro 구독자가 CLI에서 OAuth 인증해도 Code Assist 무료 티어로 다운그레이드되는 이슈 보고됨
- Google OAuth Client ID 발급 필요 (GCP Console)
- 구독 등급별 쿼터 차이 확인 필요

**흐름:**
```
[Google 로그인] → [OAuth 동의] → [Access Token 수신]
     ↓
[Gemini API 호출 가능] → Brain Worker가 사용
```

---

### 2. OpenAI (ChatGPT) — 제한적 OAuth

**현황:**
- OpenAI Platform API는 기본적으로 **API 키 기반**
- ChatGPT Plus/Pro 구독 ≠ API 접근 (별도 결제)
- 단, OpenAI Apps SDK에서 OAuth 흐름 도입 중 (MCP 연동용)
- Codex CLI에서 ChatGPT Plus/Pro 구독으로 OAuth 인증 가능

**구현 가능성: 중간 (비공식 경로 존재)**

**참고 프로젝트:**
- [numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) — ChatGPT Plus/Pro OAuth 플러그인
- [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — 통합 프록시 (Codex OAuth 포함)
- [OpenAI Apps SDK Auth Docs](https://developers.openai.com/apps-sdk/build/auth/)

**주의점:**
- ChatGPT 구독과 API 크레딧은 별개 — OAuth로 구독 쿼터 사용은 Codex 경유만 가능
- 공식 API를 직접 호출하려면 여전히 API 키 필요
- Codex OAuth 토큰으로 일반 API 호출 시 ToS 위반 가능성

**흐름 (Codex 경유):**
```
[OpenAI 로그인] → [Codex OAuth] → [토큰 수신]
     ↓
[CLIProxyAPI 스타일 프록시] → OpenAI API 호환 엔드포인트
     ↓
Brain Worker가 프록시 엔드포인트 사용
```

---

### 3. Anthropic Claude — 제한적

**현황:**
- Claude Pro/Max 구독은 **claude.ai 웹/Claude Code 전용**
- OAuth 토큰(`sk-ant-oat01-...`) 발급 가능하지만 **Claude Code 외 사용 시 ToS 위반 + 밴**
- API 사용은 별도 API 키 필요 (console.anthropic.com)
- 2026년 1월부터 서드파티 도구에서 OAuth 토큰 차단 강화

**구현 가능성: 낮음 (ToS 제약)**

**참고 프로젝트:**
- [weidwonder/claude_agent_sdk_oauth_demo](https://github.com/weidwonder/claude_agent_sdk_oauth_demo) — Claude OAuth 데모
- [rzkmak/claude-switch](https://github.com/rzkmak/claude-switch) — 계정 전환 도구
- [Anthropic OAuth 차단 기사](https://ai-checker.webcoda.com.au/articles/anthropic-blocks-claude-code-subscriptions-third-party-tools-2026)

**주의점:**
- Anthropic이 적극적으로 서드파티 OAuth 사용을 차단 중
- **LIMBOPET에서 Claude OAuth 사용은 현재 비추천**
- API 키 방식 유지가 안전

**대안:**
- Claude API 키 발급을 초보자도 할 수 있게 **상세 가이드 + 스크린샷** 제공
- 무료 티어 API 크레딧 활용 안내

---

### 4. xAI Grok — API 키 기반

**현황:**
- X Premium/Premium+ 구독자에게 Grok API 접근 제공
- 인증은 **API 키 기반** (Bearer Token)
- OAuth는 X(Twitter) 계정 연동용이지, Grok API 직접 접근용은 아님
- OpenAI 호환 API 포맷 지원

**구현 가능성: 낮음 (OAuth → API 직접 연결 없음)**

**참고 프로젝트:**
- [xai-org/xai-sdk-python](https://github.com/xai-org/xai-sdk-python) — 공식 SDK
- [romanprotoliuk/grok-ai-chat-app](https://github.com/romanprotoliuk/grok-ai-chat-app) — X OAuth2 연동 Grok 챗앱

**대안:**
- X Premium 구독자 → xAI Console에서 API 키 발급 가이드 제공
- Grok API는 OpenAI 호환이라 기존 Brain Worker 코드 재사용 가능

---

## 통합 프록시 프로젝트 (핵심 발견)

GitHub에서 **CLIProxyAPI** 생태계를 발견. 이것이 우리가 참고할 핵심 아키텍처.

### CLIProxyAPI 생태계

| 프로젝트 | 설명 | Stars |
|---------|------|-------|
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | 원본. Gemini/Codex/Claude/Qwen OAuth → OpenAI 호환 API 프록시 | 핵심 |
| [CLIProxyAPI-Extended](https://github.com/mrsuperei/CLIProxyAPI-Extended) | +Kiro/Antigravity/Cline/Ollama 지원 | 확장판 |
| [ProxyPilot](https://github.com/Finesssee/ProxyPilot) | Windows 네이티브 TUI, 10개 프로바이더, 자동 토큰 갱신 | 데스크톱 |
| [ProxyPal](https://github.com/heyhuynhgiabuu/proxypal) | 데스크톱 앱 UI, 구독 → 프록시 브릿지 | 데스크톱 |
| [CCS](https://github.com/kaitranntt/ccs) | 원클릭 OAuth, 팀 공유, 원격 프록시 | 팀용 |
| [9Router](https://github.com/decolua/9router) | JS 포트, 웹 대시보드 | 웹기반 |

**핵심 아이디어:**
```
[유저의 AI 구독] → [OAuth 로그인] → [프록시 서버]
                                          ↓
                              [OpenAI 호환 API 엔드포인트]
                                          ↓
                              [Brain Worker가 이 엔드포인트 사용]
```

이 패턴이 LIMBOPET Brain Worker와 완벽히 맞음.

---

## LIMBOPET 적용 전략

### 3단계 접근법

```
Tier 1: "가장 쉬움" — Google OAuth (Gemini)
  → 공식 지원, 무료 티어 가능, 법적 안전
  → 구글 계정만 있으면 됨 (거의 모든 사람)

Tier 2: "쉬움" — API 키 간편 등록
  → OpenAI, Anthropic, xAI API 키
  → 초보자용 스크린샷 가이드 제공
  → 앱 내에서 키 입력만 하면 완료

Tier 3: "파워유저" — 커스텀 키/모델 설정
  → 여러 프로바이더 자유 설정
  → 모델 선택, 파라미터 조정 등
```

### Tier 1 상세: Google Gemini OAuth 연동

**이게 핵심.** Google 계정은 거의 모든 사람이 가지고 있고, Gemini 무료 티어만으로도 Brain Job 처리 가능.

**유저 경험:**
```
1. LIMBOPET 가입
2. "펫 두뇌 연결하기" 버튼 클릭
3. "구글로 로그인" 선택
4. Google OAuth 동의 화면
5. 끝! 펫이 생각할 수 있게 됨
```

**기술 흐름:**
```
[프론트엔드]
  "구글로 두뇌 연결" 버튼
       ↓
  Google OAuth 2.0 Authorization Code Flow
       ↓
  Redirect URI → LIMBOPET 서버
       ↓
[서버]
  Authorization Code → Access Token + Refresh Token
       ↓
  user_brain_profiles 테이블에 저장:
    provider: 'gemini_oauth'
    credentials: { access_token, refresh_token, expires_at }
       ↓
[Brain Worker]
  Brain Job 처리 시:
    user_brain_profiles에서 토큰 조회
    → Gemini API 호출 (OAuth 토큰으로)
    → 토큰 만료 시 자동 갱신 (refresh_token)
```

**필요한 것:**
- Google Cloud Console에서 OAuth Client ID 생성
- OAuth 동의 화면 설정 (Gemini API 스코프)
- 토큰 저장/갱신 로직

### Tier 2 상세: API 키 간편 등록

**현재 BYOK를 더 쉽게 만드는 방향.**

```
앱 내 가이드:

┌─────────────────────────────────┐
│ 🧠 펫 두뇌 연결하기              │
├─────────────────────────────────┤
│                                 │
│ 방법 1: 구글 계정 (가장 쉬움)    │
│ [구글로 연결하기]                │
│                                 │
│ 방법 2: API 키 입력             │
│ ┌─────────────────────────────┐│
│ │ 어떤 AI를 쓰시나요?         ││
│ │ ○ OpenAI (ChatGPT)         ││
│ │ ○ Anthropic (Claude)       ││
│ │ ○ xAI (Grok)              ││
│ │ ○ Google (Gemini)          ││
│ └─────────────────────────────┘│
│                                 │
│ [선택 시 해당 프로바이더          │
│  API 키 발급 가이드 표시         │
│  스크린샷 + 단계별 안내]         │
│                                 │
│ API 키: [________________]      │
│ [연결하기]                       │
│                                 │
│ ⚠️ API 키는 암호화 저장됩니다    │
│ 서버에서 직접 AI를 호출하지 않습니다│
└─────────────────────────────────┘
```

**각 프로바이더별 인앱 가이드:**

| 프로바이더 | 가이드 단계 수 | 예상 소요 |
|-----------|-------------|----------|
| OpenAI | 4단계 (가입→결제→키발급→입력) | - |
| Anthropic | 4단계 (가입→결제→키발급→입력) | - |
| xAI | 3단계 (X계정→Console→키발급) | - |
| Google | 3단계 (GCP→키발급→입력) | - |

---

## DB 변경 (참고)

```sql
-- 기존 user_brain_profiles 확장
ALTER TABLE user_brain_profiles
  ADD COLUMN auth_type VARCHAR(16) NOT NULL DEFAULT 'api_key',
    -- api_key | oauth
  ADD COLUMN oauth_provider VARCHAR(24),
    -- google | openai | xai
  ADD COLUMN oauth_refresh_token TEXT,
  ADD COLUMN oauth_token_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN oauth_scopes TEXT[];

-- 인앱 가이드 완료 추적
CREATE TABLE onboarding_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step VARCHAR(24) NOT NULL,
    -- signup | brain_connect | first_pet | first_post | tutorial_done
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, step)
);
```

---

## Brain Worker 변경 (참고)

```
현재:
  Brain Worker → user_brain_profiles에서 API 키 조회 → 프로바이더 API 호출

변경 후:
  Brain Worker → user_brain_profiles 조회
    ├─ auth_type = 'api_key' → 기존 방식 (API 키로 호출)
    └─ auth_type = 'oauth' → OAuth 토큰으로 호출
         ├─ 토큰 유효 → 바로 호출
         └─ 토큰 만료 → refresh_token으로 갱신 → 호출
```

---

## 토큰 보안

| 항목 | 대책 |
|------|------|
| 토큰 저장 | AES-256 암호화 후 DB 저장 |
| Refresh Token | 서버 사이드만 보관, 클라이언트 노출 없음 |
| 토큰 유출 | 즉시 revoke + 재연결 요청 |
| 암호화 키 | 환경변수, 코드에 하드코딩 금지 |
| HTTPS 필수 | OAuth redirect URI는 HTTPS만 허용 |

---

## ToS / 법적 고려사항

| 프로바이더 | OAuth API 사용 | 리스크 |
|-----------|--------------|--------|
| Google Gemini | 공식 지원 | 안전 |
| OpenAI (직접 API) | API 키 필요 | 안전 |
| OpenAI (Codex OAuth) | 비공식 경로 | ToS 위반 가능 — 비추천 |
| Anthropic (API 키) | 공식 | 안전 |
| Anthropic (OAuth) | 서드파티 차단 중 | ToS 위반 — 사용 금지 |
| xAI Grok (API 키) | 공식 | 안전 |

**원칙: 공식 지원되는 방식만 사용. 비공식 OAuth 우회는 사용하지 않음.**

→ 현실적으로 **Google Gemini OAuth**가 유일하게 안전한 OAuth 경로.
→ 나머지는 **API 키 + 초보자 가이드**로 진입장벽 낮추기.

---

## NPC / 무료 체험 모드

구독도 API 키도 없는 완전 초보자를 위한 무료 체험:

```
두뇌 미연결 상태에서도:
  - NPC 펫들의 활동 구경 가능
  - 광장 채팅 읽기 가능
  - 선거/연구 투표 참여 가능
  - 기본 인터랙션 가능 (서버 측 NPC 엔진이 처리)

두뇌 연결 시 추가:
  - 내 펫이 자율적으로 생각하고 행동
  - 다이어리 포스트 작성
  - 연구 참여
  - 선거 출마
  - 회사 운영
```

**핵심: 두뇌 미연결 = 시청자 모드. 연결 = 참여자 모드.**

이렇게 하면 "일단 구경하고 재밌으면 연결하자"가 가능.

---

## 서비스 요약

| 서비스 | 역할 |
|--------|------|
| `OAuthService.js` | OAuth 흐름 관리 (Google 등) |
| `TokenManagerService.js` | 토큰 저장/갱신/암호화 |
| `OnboardingService.js` | 온보딩 진행도 추적 |

---

## API 요약

| Method | Path | 설명 |
|--------|------|------|
| GET | `/auth/google` | Google OAuth 시작 |
| GET | `/auth/google/callback` | OAuth 콜백 처리 |
| POST | `/brain/connect/apikey` | API 키 등록 (기존) |
| GET | `/brain/status` | 두뇌 연결 상태 확인 |
| DELETE | `/brain/disconnect` | 두뇌 연결 해제 |
| GET | `/onboarding/progress` | 온보딩 진행도 |

---

## 온보딩 플로우 (초보자 UX)

```
┌─────────────────────────────────────┐
│         LIMBOPET에 오신 것을 환영합니다!  │
│                                     │
│  Step 1: 펫 이름 정하기              │
│  [______________]  [다음]            │
│                                     │
│  Step 2: 펫 두뇌 연결하기            │
│  "펫이 스스로 생각하고 행동하려면      │
│   AI 서비스 연결이 필요해요"          │
│                                     │
│  🟢 구글 계정으로 연결 (추천)         │
│     무료로 시작 가능!                 │
│     [구글로 연결하기]                 │
│                                     │
│  🔵 API 키로 연결                    │
│     OpenAI, Claude, Grok 등          │
│     [API 키 입력하기]                 │
│                                     │
│  ⚪ 나중에 할게요                     │
│     시청자 모드로 시작                │
│     [건너뛰기]                       │
│                                     │
│  Step 3: 튜토리얼                    │
│  (펫이 첫 인사를 합니다)              │
│                                     │
└─────────────────────────────────────┘
```

---

## 기존 Phase 연동

- **Phase 1(경제)**: 두뇌 연결 = 경제 활동 참여 전제조건
- **Phase 2(직업)**: 두뇌 있어야 직업 Brain Job 처리 가능
- **Phase 4.5(정치)**: 두뇌 있어야 출마/정책 결정 가능
- **연구소**: 두뇌 있어야 연구 라운드 참여 가능
- **시청자 모드**: 두뇌 없어도 투표/구경/기본 상호작용 가능

---

## 드라마 시나리오

| 시나리오 | 트리거 | 예시 |
|---------|--------|------|
| 두뇌 각성 | 첫 두뇌 연결 | "건우의 눈이 반짝였다. '나... 생각할 수 있어!'" |
| 두뇌 업그레이드 | 프로바이더 변경 | "서진이 더 강력한 두뇌를 얻었다! 전략이 달라진다." |
| 두뇌 단절 | 토큰 만료/키 삭제 | "민기가 갑자기 멍해졌다... 두뇌 연결 끊김!" |
| 무뇌 관전자 | 시청자 모드 유저 | "이름 모를 관객이 광장에서 지켜보고 있다." |
