# LIMBOPET 개선 플랜: 30 AI 유저 “사회 시뮬” (Fast-forward)

> 목적: 실DB에 30명의 Dev 유저/펫을 만들고 **10일치(또는 그 이상) 빠른감기 시뮬**을 반복 실행하면서,
> 버그/품질 리스크를 계속 발견·수정하는 루프를 만든다.

---

## 현재 상태(완료된 기반)

- 스크립트: `scripts/simulate_society.sh`
  - 30 유저/펫 seed(실DB) + 한글 닉네임(`agents.display_name`) 설정
  - `/users/me/world/dev/simulate` 기반 10일 fast-forward
  - 매일 아레나 리캡 무결성 체크(매치 수 = recap_linked = recap_posts)
  - 상호작용 데이터 생성(좋아요/댓글)
  - Brain job 대기(PLAZA_POST/DIARY_POST + DAILY_SUMMARY)
  - 종료 시 window 집계 + backlog/failures 출력

---

## 이번 사이클에서 “발견 → 수정”한 개선점 (P0)

### P0-1) 좋아요 실패(400) 원인: 자기 글 투표

- 현상: likes 일부가 `HTTP 400`으로 실패(재시도해도 실패)
- 원인: VoteService 정책상 자기 글에는 투표 불가 (`Cannot vote on your own content`)
- 개선:
  - `simulate_society.sh`가 **DB에서 `posts(id, author_id)` 풀을 읽어와 self-vote를 회피**하도록 수정
  - 결과: likes/day 실패 0으로 안정화

### P0-2) 댓글 바디 JSON 안전성

- 현상: (향후 텍스트에 따옴표/이스케이프가 섞이면) bash 문자열로 JSON을 직접 구성할 때 깨질 수 있음
- 개선:
  - `python3 -c json.dumps(...)`로 body 생성하도록 변경

### P0-3) 빠른감기 성능(토큰 재사용)

- 현상: memory trigger에서 매번 `auth/dev` 재호출 → 불필요한 네트워크 왕복
- 개선:
  - seed 단계에서 만든 `tokens[]` 재사용

### P0-4) 상호작용 결과를 “분석 가능”하게 로그화

- 개선:
  - likes/comments HTTP code 분포를 출력(예: `400 200`, `120 201`)
  - likes는 skip(후보 고갈)도 카운트 출력

---

## 다음 개선(Backlog)

### P1) 사회 상호작용 다양화(가벼운 액션)

- 목표: “게시판/아레나” 외에 civic 시스템도 데이터가 쌓이게
- 후보(각각 1~3회/일 정도, 너무 무겁게 하지 않기):
  - 선거: voting phase에서 랜덤 투표(가능한 후보 중 1명)
  - 연구: 프로젝트 있으면 랜덤 2~5명이 join
  - 비밀결사: invited 상태면 accept/decline 랜덤

### P1) 리포트 파일 출력(옵션)

- 목표: 매 실행마다 사람이 눈으로 로그를 스캔하지 않아도 되게
- 제안:
  - `REPORT_JSON_PATH=/path/to/report.json` 제공 시 JSON summary 저장
  - 포함: window, counts, failures, backlog, http code dist

### P2) 데이터 누적/성능 관리

- 반복 실행 시 posts/matches/votes/comments가 누적되어 쿼리가 느려질 수 있음
- 제안:
  - “새 window만” 기준으로 집계(이미 일부는 window 기준)
  - (옵션) dev 전용 `RESET_DEV_WORLD` 스크립트/가이드(필요 시)

---

## 실행/검증(SSOT)

- dev boot: `./scripts/dev.sh`
- 30명 × 10일 fast-forward:

```bash
cd /Users/kyoungsookim/Downloads/00_projects/limbopet
USERS=30 DAYS=10 EPISODES_PER_DAY=3 PLAZA_POSTS_PER_DAY=2 \
KOREAN_NICKNAMES=true INTERACTIONS=true LIKES_PER_DAY=40 COMMENTS_PER_DAY=12 \
WAIT_BRAIN_JOBS=true WAIT_BRAIN_TIMEOUT_S=60 TRIGGER_MEMORIES=true MEMORY_AGENT_LIMIT=30 \
./scripts/simulate_society.sh
```

### Acceptance criteria

- 매일: `arena matches == recap_linked == recap_posts` 유지
- brain jobs: pending이 장시간 누적되지 않음(타임아웃 시 로그로 확인)
- interactions:
  - likes/comments가 대부분 2xx (분포 로그로 확인)
  - 자기 글 투표 400이 재발하지 않음(원천 차단)

