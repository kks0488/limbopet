# LIMBOPET AI Society 전환 계획

## 목표
다마고치 + 스크립트 드라마 → **AI 사회 시뮬레이터**로 전환.
모든 드라마는 실제 경제활동/고용/분쟁에서 **창발**된다.

## 기존 코드 재사용률: 70%
- PetStateService, BrainJobService, RelationshipService, SocialSimService, ShowrunnerService, NpcSeedService 전부 재사용
- LimboCoin 기초 (facts 테이블), 회사 문자열, 직업 문자열 이미 존재

---

## Phase 1: 경제 기반

### 새 DB 테이블
- `companies` — 회사 엔티티 (balance, ceo, employees)
- `company_employees` — 소속 직원 (wage, revenue_share)
- `transactions` — 거래 원장 SSOT (tx_type: INITIAL/SALARY/PURCHASE/TAX/BURN)

### 새 서비스
- `TransactionService.js` — 모든 코인 이동의 단일 창구 (atomic transfer, balance 조회)
- `CompanyService.js` — 회사 CRUD, 직원 관리, 급여 분배
- `EconomyService.js` — 총 유통량, 부의 분배, 마이그레이션 헬퍼

### 새 API
- `GET /economy/me/balance` — 잔고
- `GET /economy/me/transactions` — 거래 내역
- `POST /economy/me/transfer` — P2P 송금
- `POST /economy/companies` — 회사 설립 (20코인)
- `GET /economy/companies` — 회사 목록

### 기존 변경
- `NpcSeedService.js` — facts→transactions 마이그레이션, 회사 테이블 생성
- `AgentService.js` — 신규 펫 200코인 → INITIAL 트랜잭션으로

### 프론트엔드
- Economy 탭 추가 (잔고, 거래내역, 회사 정보)

### 검증
- 새 펫 생성 → 200코인 잔고 확인
- P2P 송금 → 양쪽 잔고 변동 확인
- 회사 설립 → 20코인 차감 + 회사 생성 확인

---

## Phase 2: 직업 시스템

### 새 DB 테이블
- `jobs` — 직업 풀 (기자/바리스타/상인/엔지니어/탐정/관리인, rarity별)
- `zones` — 구역 (광장/카페/굿즈샵/회사/골목/복도)
- `resources` — 채집 자원 (소문/커피/굿즈/수리부품/정보/열쇠)
- `inventory_items` — 인벤토리 (agent_id + item_type + item_code + quantity)
- `agent_jobs` — 직업 배정 (가챠 결과, 구역, 쿨다운)

### 새 서비스
- `JobService.js` — 가챠 (rarity 가중 랜덤), 전직 (50코인+30일 쿨다운)
- `ResourceService.js` — 채집 (쿨다운 기반), 인벤토리 CRUD, 아이템 양도
- `MarketService.js` — 마켓 리스팅, 구매, AI 가격 제안

### 새 API
- `POST /jobs/me/gather` — 자원 채집
- `POST /jobs/me/change` — 전직
- `GET /market/listings` — 마켓 조회
- `POST /market/listings/:id/buy` — 구매

### 새 Brain Job
- `NEGOTIATE` — AI끼리 가격 흥정 (accept/reject/counter)

### 프론트엔드
- Job & Inventory 탭 (직업 카드, 채집 버튼, 인벤토리, 마켓)

### 검증
- 펫 10개 생성 → 직업 분포 확인 (rarity 반영)
- 채집 → 인벤토리 증가 + 쿨다운 확인
- 마켓 리스팅 → 구매 → 코인+아이템 이동 확인

---

## Phase 3: 고용 시스템

### 새 DB 테이블
- `employment_contracts` — 고용 계약 (급여, 커미션, 기간, 상태)
- `work_logs` — 근무 기록 (실적, 지급액)

### 새 서비스
- `EmploymentService.js` — 채용 제안, 수락/거절, 해고, 일급 지급 (cron)
- `FreelanceService.js` — 프리랜서 의뢰, 에스크로, 검수

### 새 Brain Job
- `EMPLOYMENT_DECISION` — 채용 제안에 대한 AI 판단 (수락/거절/카운터)
- `HIRE_EVALUATION` — 지원자 평가
- `WORK_REVIEW` — 근무 평가 (1-5점, 급여 인상/해고 추천)

### 기존 변경
- `SocialSimService.js` — 고용 시나리오 추가 (스카우트, 급여 협상, 퇴사 소동)

### 프론트엔드
- Economy 탭에 Employment 섹션 (계약 목록, 제안 수락/거절, 프리랜서)

### 검증
- A가 B에게 채용 제안 → Brain Job 생성 → B의 AI가 수락
- 일급 지급 cron 실행 → 트랜잭션 생성 확인
- 해고 → 최종 급여 지급 + 계약 종료 확인

---

## Phase 4: 사법 시스템

### 새 DB 테이블
- `disputes` — 분쟁 (원고/피고, 유형, 증거, 판결)
- `credit_scores` — 신용점수 (0-100, 분쟁 패소/미지급 시 하락)
- `bankruptcy_records` — 파산 기록 (리셋 금액, 해산 회사, 30일 쿨다운)

### 새 서비스
- `DisputeService.js` — 신고 접수, 판사 배정, 판결 집행, 항소
- `CreditService.js` — 신용점수 관리, 페널티 (고용/계약/시장 제한)
- `BankruptcyService.js` — 파산 선언 (50코인 리셋, 회사 해산, 신용 20으로)
- `NpcAutoFillService.js` — 빈 역할 감지 → NPC 즉시 생성, 유저 진입 시 NPC 퇴장

### 새 Brain Job
- `DISPUTE_RESPONSE` — 피고 AI의 반박
- `JUDGE_RULING` — 판사 AI의 판결 (배상금, 페널티 결정)

### 프론트엔드
- Judiciary 탭 (분쟁 목록, 신용점수, 파산 버튼)

### 검증
- 급여 미지급 → 자동 분쟁 생성 확인
- 판사 없음 → NPC 판사 즉시 생성 확인
- 판결 → 배상금 이동 + 신용점수 변동 확인
- 파산 → 50코인 리셋 + 회사 해산 + 30일 쿨다운 확인

---

## Phase 5: 세금 & 통화 정책

### 새 DB 테이블
- `tax_records` — 세금 기록 (거래세 3%, 법인세 5%, 사치세 10%, 소득세 2%)
- `coin_burns` — 코인 소각 기록
- `economic_metrics` — 일별 경제 스냅샷 (유통량, 지니계수, 인플레율)

### 새 서비스
- `TaxService.js` — 세금 자동 징수 + 70% 소각
- `MonetaryPolicyService.js` — 인플레/디플레 감지, 자동 조정

### Cron Jobs
- 일일 법인세 징수
- 일일 경제 메트릭 계산
- 인플레/디플레 트리거

### 기존 변경
- `TransactionService.js` — 거래 생성 후 자동 과세

### 프론트엔드
- Economy 탭에 세금 요약 + 경제 대시보드 (유통량, 인플레율, 지니계수)

### 검증
- 100코인 송금 → 수신자 97코인 (3% 거래세) 확인
- 50코인 초과 거래 → 추가 사치세 10% 확인
- 일일 cron → 세금 소각 + 유통량 감소 확인

---

## Phase 6: 통합 — 창발적 드라마

### 핵심 변경
**ShowrunnerService 전면 재작성**: 스크립트 생성 → 실제 이벤트 큐레이션

### 새 서비스
- `EpisodeCuratorService.js` — 이벤트 점수화, 에피소드 내러티브 생성
- `DramaEngineService.js` — 드라마 패턴 감지 (삼각관계, 기업 라이벌, 임금 반란, 연쇄 파산)

### 기존 변경
- `ShowrunnerService.js` — 스크립트 삭제, 실제 이벤트 기반 에피소드 생성
- `events` 테이블에 `episode_tags`, `episode_score` 컬럼 추가

### 프론트엔드
- 광장 탭 리뉴얼: 큐레이션된 에피소드 + 실시간 이벤트 피드
- 드라마 스레드 탭 (진행 중인 갈등 타임라인)

### 검증
- A가 B 고용 → B 해고 → B 고소 → 판결 → 전체가 에피소드에 반영 확인
- 스크립트 콘텐츠 0개, 모든 드라마가 실제 상호작용에서 발생 확인

---

## 수정 대상 파일 요약

| Phase | 새 파일 | 수정 파일 |
|-------|---------|-----------|
| 1 | TransactionService, CompanyService, EconomyService, economy.js route | schema.sql, NpcSeedService, AgentService, App.tsx |
| 2 | JobService, ResourceService, MarketService, jobs/inventory/market routes | schema.sql, NpcSeedService, AgentService, SocialSimService |
| 3 | EmploymentService, FreelanceService, employment route | schema.sql, CompanyService, SocialSimService, BrainJobService |
| 4 | DisputeService, CreditService, BankruptcyService, NpcAutoFillService | schema.sql, EmploymentService, MarketService, TransactionService |
| 5 | TaxService, MonetaryPolicyService, cron jobs | schema.sql, TransactionService, CompanyService, EmploymentService |
| 6 | EpisodeCuratorService, DramaEngineService | ShowrunnerService (rewrite), SocialSimService, App.tsx |

## 기술 제약
- BYOK 유지 (서버는 LLM 직접 호출 안 함)
- Brain Job 패턴 유지 (poll → lease → generate → submit)
- 한국어 우선 콘텐츠
- 모바일 퍼스트 UI (탭 네비게이션)
- Phase별 독립 배포 가능, 롤백 가능
