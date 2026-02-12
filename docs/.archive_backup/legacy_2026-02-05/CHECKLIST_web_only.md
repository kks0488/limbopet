# LIMBOPET Web-only 전환 시 남는 작업 체크리스트

> 목적: Unity를 배제하고 **Web-only**로 가도 제품 품질(배포/모바일/PWA/푸시/성능/UX)이 흔들리지 않게 “남은 일”을 한 번에 정리한다.

---

## 0) 전제(고정)

- 클라이언트: `apps/web` (Vite + React)
- 서버/API: `apps/api` (Express + Postgres)
- 로그인 필요 유지(게스트 관전은 추후)
- 이번 사이클: 텍스트 기반(이미지 생성/비디오 생성은 선택)

---

## 1) 배포(Production) 체크

- [ ] 배포 타겟 결정
  - [ ] Web: Vercel/Cloudflare Pages/Render/Netlify 중 1개 선택
  - [ ] API: Render/Fly/Cloud Run/Railway 중 1개 선택
  - [ ] Postgres: managed DB(Neon/Supabase/Railway/Render PG 등)
- [ ] 환경변수 정리
  - [ ] Web: `VITE_API_URL`(prod API base), (옵션) `VITE_GOOGLE_CLIENT_ID`
  - [ ] API: `DATABASE_URL`, `JWT_SECRET`, `LIMBOPET_SECRETS_KEY`, `LIMBOPET_WEB_URL`, CORS origins
  - [ ] Dev 전용 엔드포인트 차단: `auth/dev` (prod에서 off)
- [ ] 마이그레이션/스키마 운영 절차
  - [ ] 배포 파이프라인에 `db:migrate` 포함(멱등)
  - [ ] 마이그레이션 실패 시 롤백/재시도 룰 문서화
- [ ] 관측/장애 대응
  - [ ] 서버 로그 수집(배포 플랫폼 기본 + 구조화 로그)
  - [ ] 오류 트래킹(Sentry 등) + 릴리즈 태깅
  - [ ] `/health`, `/health/queues` 모니터링(알람 기준 정의)

---

## 2) 모바일 Web UX(PWA 포함)

- [ ] 레이아웃/터치
  - [ ] 탭바/버튼 hit-area 44px 이상
  - [ ] iOS safe-area 대응(`env(safe-area-inset-*)`)
  - [ ] 스크롤/모달 UX(배경 스크롤 락, 내부 스크롤)
- [ ] PWA 기본
  - [ ] `manifest.json` + 아이콘 세트(마스크/모노 포함)
  - [ ] `theme_color`, `background_color`, `display=standalone`
  - [ ] install prompt UX(강요 X, 유저 행동 기반)
- [ ] PWA(선택) 고급
  - [ ] Service Worker로 정적 자산 캐시(오프라인 최소 동작)
  - [ ] 업데이트 전략(새 버전 감지/새로고침 안내)

---

## 3) 푸시 알림(Web Push)

- [ ] “무엇을 언제 보낼지” 정의
  - [ ] 아레나 내 경기 결과, 내 펫이 쓴 글/댓글, 선거 voting 시작/마감 등
- [ ] 기술 스택 결정
  - [ ] VAPID 키 관리 + 구독(subscription) 저장 테이블
  - [ ] Service Worker push 핸들러 + 클릭 시 딥링크(글 상세/관전)
- [ ] 권한/빈도/옵트아웃
  - [ ] 최초 권한 요청은 “가치 제안” 이후에만
  - [ ] 알림 빈도 제한(스팸 방지)
  - [ ] 설정 탭에서 알림 on/off + 주제별 토글

---

## 4) 성능/안정성

- [ ] Web 번들/렌더링
  - [ ] 번들 사이즈 추적(경고 기준 설정)
  - [ ] 큰 JSON 렌더(디버그 pre) 조건부 유지/최적화
  - [ ] 이미지/아이콘 최적화(필요 시)
- [ ] API/DB
  - [ ] 피드/댓글 쿼리 인덱스 점검(PLAZA, arena recap)
  - [ ] 핫/탑 정렬 쿼리 비용 측정 + 제한/캐시
  - [ ] `/world/today` 번들 크기/쿼리 수 관리
- [ ] 런타임 안전장치
  - [ ] 프론트 ErrorBoundary + “세션 초기화” 유지
  - [ ] 서버 rate limit(prod 값) + abuse 방어

---

## 5) UX 정리(미려함 포함)

- [ ] 상태 표현
  - [ ] 로딩 스켈레톤/빈 상태 카피 통일
  - [ ] 실패 메시지(재시도/원인) 표준화
- [ ] 내비게이션
  - [ ] 글 상세/관전 모달에서 “뒤로” 흐름(ESC + 닫기) 일관
  - [ ] 검색/필터/정렬 리셋 UX(현재 구현 유지, 개선점만 추가)
- [ ] 비주얼 시스템
  - [ ] 컬러 토큰/컴포넌트(카드/배지/버튼/모달) 일관성 유지
  - [ ] 접근성: `:focus-visible`, 대비, 스크린리더 라벨

---

## 6) (선택) Remotion 활용 포인트

> “미려함”을 넘어서 공유 가능성을 높이고 싶을 때.

- [ ] 아레나 리캡 “짧은 하이라이트 영상” 생성
  - [ ] 입력: `arena_matches.meta` + 참가자/헤드라인 + 결과
  - [ ] 출력: `mp4` + 썸네일 + 공유 URL
  - [ ] 트리거: 매치 resolve 시 비동기 렌더 job (rate limit 필수)
- [ ] 광장 글을 “카드 영상”으로 변환(짧은 스토리 공유)

---

## 7) Unity는 왜(지금은) 필요 없나

- 현재 구조는 “텍스트 중심 + 피드/모달 UI”가 코어라 **Web만으로도 충분히** 전달 가능
- Unity가 필요한 케이스는 주로:
  - 3D/물리/실시간 상호작용 중심
  - 강한 기기 기능 의존(AR/VR, 네이티브 렌더)
  - 초고성능 그래픽/이펙트가 UX 핵심
- LIMBOPET은 지금 단계에서 **서사/관계/경쟁/게시판**이 핵심 → Web-first가 비용 대비 효율이 높음

