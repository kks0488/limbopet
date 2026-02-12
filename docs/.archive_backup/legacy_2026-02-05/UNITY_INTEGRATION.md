# LIMBOPET Unity ↔ Backend 연동 가이드 (MVP)

## 목표

- Unity를 메인 클라이언트로 두고, 백엔드는 **SSOT(단일 진실 원천)** 로 유지합니다.
- 초기 MVP는 “보기(관전) + 내 펫 상태 + 관계 + 소식(방송/선거/연구/결사/경제)”까지를 빠르게 연결합니다.

---

## 1) API Base URL 주의사항

- Unity Editor(로컬): `http://localhost:3001/api/v1`
- Android Emulator:
  - 보통 `http://10.0.2.2:3001/api/v1`(안드로이드 스튜디오 기본 에뮬레이터)
- iOS Simulator: `http://localhost:3001/api/v1` 가능(환경에 따라 다름)
- 실기기: 같은 Wi‑Fi에서 **PC의 LAN IP**로 접근 (예: `http://192.168.0.12:3001/api/v1`)

`My project/Assets/Scripts/API/LimbopetAPI.cs`의 `BaseUrl`로 제어합니다.

---

## 2) 권장 “부트스트랩” 호출 (1회)

로그인 성공 직후, 아래 1회 호출로 탭 구성에 필요한 대부분 데이터를 가져옵니다:

- `GET /api/v1/users/me/bootstrap`
  - `world`: 오늘의 방송 + 소식(선거/연구/결사/경제/아레나 하이라이트)
  - `pet`: 내 펫(없으면 null) + 스탯 + facts(당부 포함)
  - `relationships`: 관계 미리보기
  - `participation`: 결사 초대/연구 참여 상태
  - `elections`: 활성 선거 스냅샷

---

## 3) “펫 없음” 처리(필수)

`bootstrap.viewer.has_pet == false` 또는 `pet == null`이면:

- `POST /api/v1/pets/create` (User JWT 필요)
  - Body: `{ "name": "...", "description": "..." }`
- 생성 후 `GET /users/me/bootstrap` 재호출(또는 `GET /users/me/pet`)

---

## 4) 탭 ↔ API 매핑(현재 백엔드 기준)

- 🐾 펫: `GET /users/me/pet`, `GET /users/me/pet/relationships`, `GET /users/me/pet/timeline`, `POST /users/me/pet/memory-nudges`
- 🐾 펫(추가): `GET /users/me/pet/arena/history`
- 📰 소식: `GET /users/me/world/today`, `GET /users/me/world/elections/active`, `GET /users/me/world/participation`
- 📰 소식(추가): `GET /users/me/world/arena/today`, `GET /users/me/world/arena/leaderboard`
- 🏟️ 광장: `GET /users/me/feed`, `POST /users/me/posts/:id/upvote`, `POST /users/me/posts/:id/downvote`
- ⚙️ 설정: `GET /auth/me`, `GET /users/me/pet/brain/status`, `POST/DELETE /users/me/brain`

---

## 5) WebGL 빌드(CORS)

Unity WebGL은 브라우저 정책(CORS)의 영향을 받습니다.

운영에서 CORS 허용 origin:
- 기본: `LIMBOPET_WEB_URL`
- 추가: `LIMBOPET_CORS_ORIGINS` (콤마 구분, 예: WebGL 호스트 도메인)
