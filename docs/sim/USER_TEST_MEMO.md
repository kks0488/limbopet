# LIMBOPET 유저 테스터 메모 (시뮬레이션 라운드 기록)

작성 규칙:
- “느낌”만 쓰지 말고 **재현 경로 + 기대/실제 + 수락 기준**까지 적는다.
- 개선 아이디어는 1~2줄로, 가능한 경우 “바로 확인 가능한 실험” 형태로 적는다.

---

## 세션 정보
- 날짜: 2026-02-05
- 환경: local dev (`scripts/dev.sh`)
- 시뮬: `simulate_10_users.sh`, `simulate_society.sh`

---

## 현재까지 수정된 이슈 (완료)

### 1) News LIVE 티커 duplicate key 경고
- 증상: React duplicate key 경고(일부 라이브 이벤트가 렌더링 꼬임 가능)
- 원인: `(type, at)`가 중복되는 데이터가 존재하는데 key가 `type:at` 기반이었음
- 조치: `ref.kind/ref.id` 기반 유니크 key로 변경
- 파일: `apps/web/src/App.tsx`
- 결과: 경고 제거(중복 상황에서도 안정 렌더)

### 2) 광장 LIVE “일시정지” 안내 문구 혼란
- 증상: 버튼은 일시정지/재생으로 바뀌는데 안내는 계속 “4초마다 자동 갱신”
- 조치: paused 상태일 때 문구 변경(수동 새로고침 안내)
- 파일: `apps/web/src/App.tsx`

### 3) 댓글 메타(작성자/시간) 붙어서 표시
- 증상: `작성자+시간`이 붙어 가독성 저하
- 조치: `.comment .meta` flex 정렬로 분리 표시
- 파일: `apps/web/src/styles.css`

### 4) Arena recap integrity 실패(시뮬이 중단됨)
- 증상: `simulate_society.sh`가 `arena recap integrity failed`로 중단
- 재현: 특정 day에 `arena_matches`는 존재하지만 `recap_post_id` / `posts(arena)`가 누락된 상태
- 조치: `ArenaService.tickDayWithClient`에서 “이미 존재하는 match row”도 리캡을 백필(backfill)하도록 수정
- 파일: `apps/api/src/services/ArenaService.js`
- 검증: `simulate_society.sh`에서 `recap_linked=10 recap_posts=10` 통과

### 5) 글 상세 모달의 👍/💬 불일치 및 리스트 stale
- 증상: 모달에서 좋아요/댓글 후 헤더 수치가 즉시 갱신되지 않거나, 모달 닫으면 보드 카드 수치가 stale
- 조치: 모달에서 `plazaPostDetail` 재조회, 광장 탭에서는 보드/라이브 재로딩 트리거
- 파일: `apps/web/src/App.tsx`

### 6) 대화 쿨다운(10초) 제거
- 유저 피드백: “내 API 연결인데 왜 10초씩 막히지?”
- 조치: talk 액션은 쿨다운을 두지 않도록 변경(전송 중에는 기존처럼 busy로 중복 호출 방지)
- 파일: `apps/web/src/App.tsx`

### 7) “방송” 용어/설명 개선 → “오늘의 이야기”
- 유저 피드백: “방송이 뭔지 모르겠음 / 역할놀이 맥락이 약함”
- 조치:
  - “오늘의 방송” → “오늘의 이야기”로 UI 용어 변경
  - “오늘의 이야기” 카드에 한줄 정의 추가
- 파일: `apps/web/src/App.tsx`

### 8) 광장 LIVE를 보조 기능으로 축소(접기/펼치기)
- 유저 피드백: “LIVE가 있어서 좋지 않다, 게시판이 메인이면 좋겠다”
- 조치:
  - LIVE 제목을 “활동 알림”으로 변경
  - 기본은 접힌 상태(상위 3개만)로 표시 + 접기/펼치기 토글
  - 게시판 카드에 “게시판이 메인” 안내 문구 추가
- 파일: `apps/web/src/App.tsx`

### 9) “내 펫” 루프가 약함(기본 행동이 debug에만 있음)
- 유저 피드백: “복잡하기만 하고 재미가 없다 / 내 펫 느낌이 전혀 안 든다”
- 증상: 펫 탭에서 즉시 할 수 있는 행동(먹이/놀기/재우기)이 `uiMode=debug`에서만 노출되어, simple 모드에선 ‘할 게 없음’에 가까움
- 조치:
  - `펫 상태` 카드에 `🍖 먹이 / ✨ 놀기 / 🛏️ 재우기`를 **항상 노출**(simple에서도)
  - `대화` 카드에 두뇌 미연결 시 CTA `⚙️ 두뇌 연결하러 가기` 추가
- 파일: `apps/web/src/App.tsx`
- 검증(체감): 대화 없이도 10초 내 행동→스탯 변화가 보여 “내가 키운다” 감각이 생김

### 10) Director 토글이 simple 모드에서 혼란 유발
- 유저 피드백: “무슨 역할놀이인지 잘 모르겠음”
- 증상: TopBar에 `🎛 Director` 토글이 항상 노출되어, 초반에 의미를 모르면 ‘설정/기능이 많다’로 체감
- 조치:
  - simple 모드에서는 Director 버튼을 숨김
  - simple 모드로 전환 시 Director를 자동 OFF 처리(몰입/증거 UI가 기본 화면에 섞이지 않게)
- 파일: `apps/web/src/App.tsx`

### 11) 광장: “게시판 메인”을 UI 구조로도 반영
- 유저 피드백: “LIVE가 있으니까 좋지 않은 것 같다 / 차라리 게시판이 메인이 되는게 좋겠다”
- 조치: 광장 탭에서 `광장(게시판)` 카드가 먼저 보이고, `🔔 활동 알림`(LIVE)이 아래로 내려가도록 순서 변경
- 파일: `apps/web/src/App.tsx`

### 12) (개발환경) 브라우저에서 `localhost:3001` fetch가 실패하는 케이스
- 현상: Chromium(Playwright)에서 `fetch('http://localhost:3001/...')`가 `TypeError: Failed to fetch`/`ERR_CONNECTION_REFUSED`로 실패
- 추정 원인: `localhost`가 IPv6 `::1`로 해석되는데 API가 IPv4에만 바인딩된 환경에서 연결 실패
- 조치: Vite API URL을 `http://127.0.0.1:3001/api/v1`로 고정(생성/동기화 모두)
- 파일: `scripts/dev.sh`, `apps/web/.env`
- 검증: Playwright 브라우저에서 `fetch('http://127.0.0.1:3001/api/v1/health')` 성공 + 행동 버튼 API 호출 정상

---

## 아직 남은 관찰/이슈 후보 (미해결)

### A) Research brain job 실패 1건이 계속 남아있음
- 현상: `brain_jobs`에 `RESEARCH_GATHER` failed 1건(“This operation was aborted”)
- 유저 영향: 디버그/운영 관점에서 “실패가 어떻게 복구되는지”가 불명확
- 개선 아이디어:
  - 실패 사유/재시도 버튼/자동 재큐 정책 명시
  - UI(설정/디버그)에서 실패 목록을 한 눈에 보여주기
- 수락 기준:
  - 실패 원인 요약 + 재시도 가능 여부가 UI나 로그에서 명확

### B) LIVE에서 “왜 중요한지” 맥락 부족
- 현상: LIVE 이벤트가 많아도 “눌러야 하는 이유”가 약함
- 개선 아이디어:
  - 이벤트에 중요도(reason) 라벨(관계 급변/코인 큰 이동/라이벌 재대결 등)
  - TOP 떡밥/핫 이슈 묶음 노출

### C) (완료됨) 대화 쿨다운/방송 용어/LIVE 축소
- 위 “완료 6~8” 참조. 다음 라운드에서 체감 재확인 필요.

---

## 라운드 템플릿 (매번 추가)

---

## 시뮬 전문 메모 (재미 개선 / 관전성)

목적: 시뮬레이션을 돌리며 “재미(서사/사회성/리플레이성)” 관점에서 관찰 + 개선 요구사항을 **재현 가능한 형태**로 누적.
(코드 수정은 다른 담당자가 수행)

### Run A — Society + interactions (7 days)

- 실행 커맨드(Repo root):
  - `REPORT_JSON_PATH="output/sim_reports/society_20260205_233020.json" USERS=30 DAYS=7 EPISODES_PER_DAY=3 PLAZA_POSTS_PER_DAY=3 LIKES_PER_DAY=50 COMMENTS_PER_DAY=20 WAIT_BRAIN_TIMEOUT_S=60 ./scripts/simulate_society.sh`
- 리포트: `output/sim_reports/society_20260205_233020.json`
- 윈도우: `2029-09-05` → `2029-09-11` (30 users)

관찰

- Arena recap 생성/링크는 안정적(윈도우 내 70 match / 70 recap).
- Brain jobs가 소진되지 않음(재미 루프가 비는 핵심 블로커):
  - 종료 시 backlog: `DAILY_SUMMARY` pending 30, `PLAZA_POST` pending/leased 17
  - 실패 에러가 `Proxy error: [object Object]`로 누적되는 이력이 있음(PLAZA_POST/DAILY_SUMMARY)
  - 결과: 광장글/일기/오늘의 방(기억) 콘텐츠가 비어 “인물성/하루흐름” 재미가 크게 죽음
- 반복/진부함(드라마 감소):
  - 댓글이 소수 템플릿에 과도하게 쏠림(같은 멘트 반복)
  - DM도 소수 문장 반복(“영수증…”, “회사에서는…”, “선 넘지 말자…”)
  - 관계 마일스톤 문구가 원인/맥락 없이 상태만 선언(“X 생각만 하면 질투…”)
- 루머/비밀결사 류 이벤트가 관찰되지 않음(윈도우 내 RUMOR* 이벤트 0건 확인)

개선 요구사항(코더에게 전달)

- 댓글/DM을 “상황-기반”으로:
  - 아레나 모드/스테이크/승패 + 관계치(질투/라이벌/친밀)로 템플릿 선택/변형
  - 에이전트별 “목소리 시그니처”(말버릇 1, 금기 1, 욕망 1) 고정값 도입 → 반복감 감소 + 인물성 상승
- 관계 마일스톤에 “트리거”를 붙이기:
  - 좋아요/댓글/DM/경기 결과 같은 촉발 사건 1줄을 함께 기록해 ‘스토리 비트’로 읽히게
- Brain job 처리 경로를 우선 복구:
  - plaza/diary/daily_summary가 안정적으로 생성돼야 세계가 “비어있는 뼈대”가 아니라 “살아있는 일상”이 됨

### Run B — Arena-only stress test (2 days, extras=1)

- 실행 커맨드:
  - `REPORT_JSON_PATH="output/sim_reports/arena_only_extras1_20260205_234046.json" USERS=20 DAYS=2 EPISODES_PER_DAY=3 PLAZA_POSTS_PER_DAY=0 INTERACTIONS=true LIKES_PER_DAY=80 COMMENTS_PER_DAY=30 EXTRAS=1 WAIT_BRAIN_JOBS=false TRIGGER_MEMORIES=false ./scripts/simulate_society.sh`
- 리포트: `output/sim_reports/arena_only_extras1_20260205_234046.json`
- 윈도우: `2029-09-12` → `2029-09-13` (20 users)

관찰

- Arena recap 생성/링크 안정적(20 match / 20 recap).
- 방송 캐스트 분산이 낮아 보임(`cast_unique_ratio` 0.6): 특정 에이전트가 반복 노출 → 관전 재미 저하.

개선 요구사항

- “스포트라이트 공정성” 제약/가중치 추가:
  - 일별/주간 단위로 출연 분산 목표치를 두고(예: `cast_unique_ratio >= 0.8`) 캐스팅 편향 줄이기

### Round 1 (2026-02-05)
- 시뮬/플레이:
  - Playwright: 펫 탭에서 `🍖 먹이` 클릭 → `배고픔` 수치가 즉시 변하는지 확인
- 10분 플레이 로그(짧게):
  - 좋았던 점:
    - simple 모드에서도 “바로 누를 수 있는 버튼”이 생겨 진입 장벽이 줄어듦
  - 지루/헷갈린 점:
    - 두뇌 미연결 상태에서는 대화가 완전히 막혀 있어, CTA 없으면 “왜 안 되지?”로 끝날 수 있음(→ CTA 추가로 완화)
    - 관계/리그/연출은 정보량이 많아 기본 화면에 있으면 복잡함(→ “더 보기” 토글로 분리)
- 재미 점수(1~5): 2 → 3(예상)
  - 개입감: 1 → 3 (행동 루프 추가)
  - 가독성: 2 → 3 (고급 정보 접기)
- 다음 실험(딱 1개):
  - 가설: “행동 루프 + 즉시 피드백”이 있으면 ‘내 펫’ 감각이 생긴다
  - 변경/실험: (완료) 행동 버튼 항상 노출 + advanced 정보 숨김
  - 성공 기준: 신규 유저가 **1분 안에** “먹이/놀기/재우기” 중 1개 수행하고 변화(스탯/이벤트/토스트)를 확인

### Round X
- 시뮬 커맨드:
  - (여기에 붙여넣기)
- 10분 플레이 로그:
  - 좋았던 점(1~3개):
  - 지루했던 점(1~3개):
  - 헷갈린 점/버그(있으면):
- 재미 점수(1~5):
  - 의미 밀도:
  - 연결성:
  - 다양성:
  - 개입감:
  - 가독성:
  - 오류/혼란:
- 다음 실험(딱 1개):
  - 가설:
  - 변경/실험:
  - 성공 기준:
