# OAuth 시스템 수정 지시서 — cx-main 전용

> 작성: cl-ui 팀 (2026-02-08)
> 상태: 전수조사 완료, 수정 필요

---

## 현황 진단

| 연결 방식 | 상태 | 원인 |
|-----------|------|------|
| API 키 (BYOK) | **작동** | AES-256-GCM 암호화, 정상 |
| Google OAuth 직접 | **고장** | `.env`에 `GOOGLE_OAUTH_CLIENT_ID` 비어있음 |
| 프록시 OAuth (CLIProxyAPI) | **고장** | 서버 미실행 + 코드 버그 |

---

## Phase 1: Google OAuth 활성화 (최우선)

### 1-1. Google Cloud Console에서 OAuth 2.0 클라이언트 생성
- 앱 유형: 웹 애플리케이션
- 승인된 리디렉션 URI: `http://localhost:3001/api/v1/oauth/google/gemini/callback`
- Generative Language API 활성화 필요

### 1-2. `.env` 설정
```
GOOGLE_OAUTH_CLIENT_ID=<발급받은_client_id>
GOOGLE_OAUTH_CLIENT_SECRET=<발급받은_client_secret>
```

### 1-3. 테스트
프론트에서 Google OAuth 버튼 클릭 → 팝업 → 구글 로그인 → 콜백 → brain profile 생성 확인

---

## Phase 2: CLIProxyAPI 프록시 서버 세팅

### 2-1. CLIProxyAPI 시작
```bash
cd vendor/CLIProxyAPI && ./cli-proxy-api
```

### 2-2. config.yaml 수정 (둘 중 하나)
- **방법A**: `allow-remote: true` 로 변경
- **방법B**: `apps/api/.env`의 `LIMBOPET_PROXY_BASE_URL`을 `http://127.0.0.1:8317/v1` 로 변경

### 2-3. 관리 키 일치시키기
`apps/api/.env`의 `LIMBOPET_PROXY_MGMT_KEY` 값과 `vendor/CLIProxyAPI/config.yaml`의 `secret-key` 값 일치 필요.
현재 불일치: 평문 vs bcrypt 해시

### 2-4. 연결 확인
```bash
curl http://localhost:8317/v1/models
curl -H 'Authorization: Bearer <mgmt-key>' http://localhost:8317/v0/management/status
```

---

## Phase 3: mode='proxy' 라우팅 버그 수정 (코드 버그)

### 파일: `apps/api/src/services/ServerBrainWorker.js`

현재 `_tick()` 메서드에서 user brain job 처리 시:
```javascript
// 현재 (버그): proxy 모드도 UserByokLlmService로 보냄 → apiKey null → 에러
const profile = await UserBrainProfileService.getDecryptedOrRefresh(ownerUserId);
result = await UserByokLlmService.generate(profile, job.job_type, job.input);
```

수정:
```javascript
const profile = await UserBrainProfileService.getDecryptedOrRefresh(ownerUserId);
if (profile.mode === 'proxy') {
  // 프록시 모드: CLIProxyAPI 경유
  result = await ProxyBrainService.generate(job.job_type, job.input);
} else {
  // API키/OAuth 모드: 유저 키로 직접 호출
  result = await UserByokLlmService.generate(profile, job.job_type, job.input);
}
```

### 테스트
proxy 모드로 연결된 유저가 펫 대화 → brain job 생성 → ProxyBrainService 경유 → 응답 정상

---

## Phase 4: 보안 강화

### 4-1. LIMBOPET_SECRETS_KEY 설정
```bash
openssl rand -base64 32
```
`apps/api/.env`에 `LIMBOPET_SECRETS_KEY=<생성된_키>` 추가
⚠️ 기존 암호화된 데이터 재암호화 필요할 수 있음

### 4-2. JWT algorithms 명시
파일: `apps/api/src/utils/jwt.js`
`jwt.verify()` 호출에 `{ algorithms: ['HS256'] }` 옵션 추가

### 4-3. 헬스체크 엔드포인트
`GET /health/proxy` → CLIProxyAPI 연결 상태 반환

---

## 우선순위
1. **Phase 3** (코드 버그) → 가장 먼저. proxy 연결해도 job 처리 안 되면 의미 없음
2. **Phase 1** (Google OAuth) → 가장 빠르게 효과
3. **Phase 2** (CLIProxyAPI) → OpenAI/Claude 프록시 연결
4. **Phase 4** (보안) → 데모 전 필수

## 금지
- 새 DB 테이블 만들지 마라
- 동결 기능 건드리지 마라
- 프론트 파일 수정하지 마라 (cl-ui 담당)
