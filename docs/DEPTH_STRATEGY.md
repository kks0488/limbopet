# LIMBOPET 깊이 전략 — "살아있는 세계"로 가는 길

> **핵심 진단: 시스템은 충분하다. 문제는 시스템들이 서로 대화하지 않는다는 것.**
> 56개 서비스, 22,629줄. 인프라는 갖춰졌다. 하지만 유저가 "이 세계가 살아있다"고 느끼려면,
> 시스템 간 연쇄 반응이 보여야 한다.

---

## 1. 현재 깊이 지도

### 깊은 서비스 (Emergent) — 핵심 엔진
| 서비스 | 줄 수 | 하는 일 | 깊이 |
|--------|-------|---------|------|
| ArenaService | 2,448 | 턴제 배틀 + 베팅 + 스캔들 + 복수전 | ★★★★★ |
| SocialSimService | 2,250 | NPC 간 사회적 상호작용 시뮬레이션 | ★★★★☆ |
| ShowrunnerService | 812 | 일일 에피소드 + 캐스트 순환 + 세계 맥락 | ★★★★☆ |
| TodayHookService | 844 | 떡밥 선정 + 예고/결과 | ★★★★☆ |
| ElectionService | 1,083 | 14일 텀 선거 + 정책 반영 | ★★★☆☆ |
| ResearchLabService | 570 | 5단계 AI 연구 파이프라인 | ★★★☆☆ |

### 중간 서비스 — 작동하지만 보이지 않음
| 서비스 | 줄 수 | 문제 |
|--------|-------|------|
| EconomyTickService | 179 | 경제 돌아가지만 위기/호황이 없음 |
| DecisionService | 417 | 타이머 결정은 좋지만 결과가 드라마로 안 됨 |
| DailyMissionService | 243 | 매일 같은 3개. 세계 상황 반영 안 함 |
| PerkService | 229 | 스탯 버프만. 캐릭터성/트레이드오프 없음 |
| RelationshipService | 230 | 수치만 변함. 역사/기억이 없음 |
| SpendingTickService | 580 | AI 소비 패턴 있지만 유저에게 안 보임 |

### 얕은 서비스 — 껍데기만 있음
| 서비스 | 줄 수 | 문제 |
|--------|-------|------|
| SecretSocietyService | 176 | 멤버 시딩만. 미션/탐정/폭로 없음 |
| EmotionContagionService | 157 | 공식 기반 1회성 계산. 피드백 루프 없음 |
| RumorService | 187 | 상태 저장만. 전파/조사/폭로 미구현 |
| RelationshipMilestoneService | 165 | 8개 마일스톤만. 축하/보상/분기 없음 |

---

## 2. 연쇄 반응이 없는 곳 (가장 큰 문제)

현재 시스템들은 **독립적으로** 돌아간다:

```
선거 결과 → 정책 변경 (끝)
           ↗ 경제에 영향? ❌
           ↗ NPC 반응? ❌
           ↗ 스캔들 발생? ❌
           ↗ 관계 변화? ❌

아레나 패배 → 랭킹 하락 (끝)
             ↗ 펫 기분 변화? ❌ (약함)
             ↗ 라이벌 조롱? ❌
             ↗ 팬 이탈? ❌
             ↗ 복수 서사? ✅ (있음!)

경제 위기 → ... 없음 ❌
          ↗ 해고? ❌
          ↗ 범죄 증가? ❌
          ↗ 정치 불안? ❌
```

### 이상적인 연쇄 반응:
```
선거에서 세금 인상 공약 후보 당선
  → 세율 2% → 5% 변경
  → 기업 수익 감소 → 해고 발생
  → 해고당한 NPC가 분노 → 시위 게시글
  → 여론 악화 → 탄핵 투표 시작
  → 유저: "내가 뽑은 후보 때문에 이 난리가..."
```

---

## 3. 깊이 강화 전략 (3 Phase)

### Phase 1: 시스템 연결 (Cross-System Events) — 최우선

**목표: 한 시스템의 결과가 다른 시스템의 원인이 되게**

#### 1-1. 이벤트 버스 패턴
현재 `events` 테이블에 이벤트를 저장하지만 **소비하는 곳이 없다.**
WorldTickWorker에서 이벤트를 읽고 연쇄 반응을 트리거:

```
EVENT: ELECTION_WON (세율 인상)
  → EconomyTickService: 기업 수익률 조정
  → ShowrunnerService: "세금 폭탄" 에피소드 생성
  → NotificationService: 기업 소속 유저에게 알림

EVENT: ARENA_UPSET (약자가 강자 이김)
  → RelationshipService: 패자→승자 rivalry +20
  → ShowrunnerService: "충격의 결과" 에피소드
  → RumorService: "경기 조작 의혹" 루머 자동 생성
  → NotificationService: 관련 유저 알림

EVENT: AGENT_FIRED (해고)
  → RelationshipService: 해고한 인사담당과 rivalry +30
  → EconomyService: 실업 상태 → 소비 감소
  → DailyMissionService: "재취업 미션" 특별 생성
  → EmotionContagionService: 동료들 stress +10
```

#### 1-2. 구현 — CrossSystemEventService.js (신규)
```javascript
// 이벤트 발생 시 연쇄 반응 맵
const CHAIN_REACTIONS = {
  'ELECTION_WON': [
    { service: 'EconomyTick', method: 'applyPolicyChange' },
    { service: 'Showrunner', method: 'queuePoliticsEpisode' },
    { service: 'Notification', method: 'notifyAffectedUsers' },
  ],
  'ARENA_BIG_LOSS': [
    { service: 'Relationship', method: 'adjustRivalry' },
    { service: 'Rumor', method: 'maybeCreateRumor' },
    { service: 'EmotionContagion', method: 'spreadShock' },
  ],
  // ... 20+ 이벤트 타입
};
```

#### 1-3. 유저에게 보여주기 — 실시간 월드 틱커
UI 상단에 세계 상태 실시간 표시:
```
🏛 선거: 투표 중 (67%) | 💰 경제: 호황 | ⚔️ 아레나: 3경기 진행 중 | 🔥 스캔들: 2건
```

---

### Phase 2: 감정 깊이 (Emotional Depth) — 높음

**목표: 숫자 변화가 아니라 이야기로 느끼게**

#### 2-1. 관계 기억 시스템
RelationshipService에 **기억 로그** 추가:
```sql
CREATE TABLE relationship_memories (
  id SERIAL PRIMARY KEY,
  from_agent_id UUID NOT NULL,
  to_agent_id UUID NOT NULL,
  event_type VARCHAR(64),  -- 'FIGHT', 'HELP', 'BETRAY', 'CONFESS'
  summary TEXT,             -- "선거에서 배신당했다"
  emotion VARCHAR(32),      -- 'angry', 'grateful', 'heartbroken'
  day DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
- NPC가 과거를 기억하고 대화에 반영: "지난번에 네가 한 거 아직 안 잊었어"
- 관계 페이지에 타임라인 표시

#### 2-2. 경제 드라마
EconomyTickService에 **경기 사이클** 추가:
- 호황/불황 사이클 (14일 주기)
- 불황 시: 해고 확률 ↑, 범죄 ↑, 정치 불안 ↑
- 호황 시: 소비 ↑, 아레나 상금 ↑, 창업 이벤트
- **블랙 프라이데이**: 경제 지표 급변 시 전체 알림

#### 2-3. 선거 드라마
ElectionService에 **캠페인 이벤트** 추가:
- 후보 간 공개 토론 (에피소드로 생성)
- 스캔들 리크 (10% 확률로 후보 비밀 폭로)
- 공약 위반 시 탄핵 투표 트리거
- 당선 연설 + 패배 선언 (캐릭터 보이스로)

---

### Phase 3: 플레이어 파워 (Player Agency) — 중간

**목표: 유저의 작은 행동이 큰 나비효과를 만들게**

#### 3-1. 능동적 개입
- **루머 퍼뜨리기**: 코인 소모 → 특정 NPC에 대한 루머 생성 → 평판 변동
- **뇌물**: 선거 후보에게 코인 기부 → 당선 확률 ↑ → 발각 시 스캔들
- **시위 조직**: 정책 반대 → 다른 유저 동참 → 정책 변경 가능
- **밀고**: 비밀결사 정보를 경찰(감사 NPC)에게 전달 → 보상 + 배신자 태그

#### 3-2. 나비효과 리포트
유저 행동 → 24시간 후 연쇄 반응 추적:
```
너의 행동: "건우에게 먹이를 안 줬다"
  → 건우 컨디션 하락 (-10)
  → 아레나에서 패배
  → 패배 후 스캔들 고발
  → 재판에서 유죄 판결
  → 코인 몰수 → 파산 위기!

나비효과 점수: 87/100 🦋🦋🦋🦋
```

#### 3-3. 동적 미션
DailyMissionService를 세계 상태 반응형으로:
- 선거일: "투표하기" 미션 추가
- 스캔들 진행 중: "증거 수집" 미션 추가
- 불황: "절약 미션" (소비 안 하기)
- 축제: "축하 미션" (XP 2배)

---

## 4. 중독성 강화 — 빠진 고리들

### 지금 가장 ROI 높은 것 (구현 난이도 낮음)

| 순위 | 기능 | 효과 | 난이도 |
|------|------|------|--------|
| **1** | 월드 틱커 UI | "세계가 움직이고 있다" 실감 | 낮음 |
| **2** | 이벤트 연쇄 반응 (5개만) | 시스템 간 드라마 자동 생성 | 중간 |
| **3** | 관계 기억 로그 | "왜 이 NPC가 나를 싫어하지?" 이해 | 낮음 |
| **4** | 경제 호황/불황 사이클 | 예측 불가 긴장감 | 낮음 |
| **5** | 동적 미션 (세계 반응형) | 매일 다른 미션 = 매일 올 이유 | 중간 |
| **6** | 비밀결사 미션 + 폭로 | SecretSociety 활성화 | 중간 |
| **7** | 루머 전파 시스템 | RumorService 활성화 | 중간 |
| **8** | 감정 전염 피드백 루프 | EmotionContagion 활성화 | 낮음 |

### "못 끊게 만드는" 심리 메커니즘 현황

| 메커니즘 | 현재 | 목표 | 갭 |
|---------|------|------|-----|
| 가변 보상 (슬롯머신) | ★★★☆☆ | ★★★★★ | 경제 변동 + 루머 폭발 |
| 손실 회피 | ★★★★★ | ★★★★★ | ✅ 완료 |
| 매몰 비용 | ★★★★☆ | ★★★★★ | 관계 기억이 빠짐 |
| FOMO | ★★☆☆☆ | ★★★★★ | 월드 틱커 + 실시간 알림 |
| 사회적 증거 | ★☆☆☆☆ | ★★★★☆ | 랭킹 + "몇명 참여중" |
| 자기효능감 | ★★☆☆☆ | ★★★★☆ | 나비효과 리포트 |
| 소유 효과 | ★★★★☆ | ★★★★★ | 관계 기억 + 성장 히스토리 |
| 호기심 갭 | ★★★☆☆ | ★★★★★ | 클리프행어 + 타임캡슐 |

---

## 5. 즉시 실행 가능한 작업 (Codex 지시용)

### Task A: CrossSystemEventService 구현
- 이벤트 연쇄 반응 5개부터 시작
- WorldTickWorker에서 호출

### Task B: 월드 틱커 API + UI
- GET /world/ticker → 현재 세계 상태 요약
- UI 상단 고정 바

### Task C: 관계 기억 로그
- relationship_memories 테이블
- RelationshipService에서 자동 기록
- API: GET /agents/:id/relationship-history

### Task D: 경제 사이클
- EconomyTickService에 호황/불황 로직
- world fact에 경기 상태 저장
- 급변 시 알림

### Task E: 동적 미션
- DailyMissionService가 world state 읽어서 미션 변형

---

## 변경 로그
- 2026-02-06: 초판 작성. 56개 서비스 전수 분석 기반.
