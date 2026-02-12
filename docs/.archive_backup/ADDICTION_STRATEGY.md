# LIMBOPET 중독성 강화 전략 (2026-02-06)

> 목표: **매일 3번 이상 열게 만들기. 안 열면 불안하게.**
> 원칙: Hook Model (Trigger → Action → Variable Reward → Investment) 기반

---

## 현황 진단

### 이미 강한 것 ✅
| 메커니즘 | 서비스 | 중독성 |
|---------|--------|--------|
| 일일 미션 3개 | DailyMissionService | ★★★★★ |
| 타이머 결정 (손실 회피) | DecisionService | ★★★★★ |
| 부재 패널티 (매몰 비용) | DecayService | ★★★★☆ |
| 아레나 경쟁 (6모드) | ArenaService | ★★★★★ |
| 모드별 전략 (개입감) | StrategyBriefing | ★★★★☆ |
| 실제 판례 모의재판 | CourtCaseService | ★★★★★ |
| 게임 보드 시각화 | 6 Board Components | ★★★★☆ |
| 오늘의 떡밥 | TodayHookService | ★★★☆☆ |
| XP/레벨업 | ProgressionService | ★★★★☆ |
| OAuth 간편 연결 | AiConnectPanel | ★★★★☆ |

### 결정적 약점 ❌ (이것만 채우면 리텐션 2배)
| 메커니즘 | 영향도 | 현재 | 구현 난이도 |
|---------|--------|------|-----------|
| **연속 접속 (Streaks)** | CRITICAL | 없음 | 낮음 |
| **알림 시스템** | CRITICAL | 없음 | 중간 |
| **사회적 피드백** | HIGH | 없음 | 낮음 |
| **시즌 시스템** | HIGH | 없음 | 중간 |
| **복귀 보상** | MEDIUM | 패널티만 | 낮음 |

---

## 구현 계획 (5 Phase)

### Phase A: 연속 접속 시스템 (Streaks) — 🔴 최우선

**심리학:** 듀오링고 기준 7일 스트릭 달성 시 코스 완료율 3.6배 증가

#### A-1. DB 스키마
```sql
CREATE TABLE user_streaks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  streak_type VARCHAR(32) NOT NULL DEFAULT 'daily_login',
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_completed_at DATE,
  streak_shield_count INTEGER NOT NULL DEFAULT 0,  -- 스트릭 보호권
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, streak_type)
);
```

#### A-2. StreakService
```
streak_type:
- daily_login: 매일 접속 (최소 1회 액션)
- daily_mission: 미션 올클리어
- arena_win: 아레나 연승

로직:
- 어제 완료 → current_streak + 1
- 오늘 이미 완료 → skip
- 어제 미완료 → streak_shield 있으면 소모, 없으면 리셋

마일스톤 보상:
- 3일: XP 50 + 코인 3
- 7일: XP 200 + 코인 10 + "🔥 불꽃 배지"
- 14일: XP 500 + 코인 25 + streak_shield 1개
- 30일: XP 1500 + 코인 100 + 특별 칭호 "불멸의 주인"
- 100일: 전설 칭호 + 펫 특별 스킨
```

#### A-3. UI
- 홈 화면 상단에 🔥 스트릭 카운터 상시 노출
- 스트릭 끊기기 1시간 전 경고 배너 (빨간색)
- 마일스톤 달성 시 축하 애니메이션
- 스트릭 보호권 사용 확인 모달

---

### Phase B: 인앱 알림 센터 — 🔴 긴급

**심리학:** 외부 트리거 → 내부 트리거 전환 (Hook Model 핵심)

#### B-1. DB 스키마
```sql
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
```

#### B-2. NotificationService
```
알림 타입 (우선순위):
1. DECISION_EXPIRING: "⏰ 스캔들 대응 마감 3시간 전!"
2. STREAK_WARNING: "🔥 스트릭 유지까지 1시간!"
3. MISSION_REMINDER: "오늘 미션 2개 남았어"
4. ARENA_RESULT: "아레나 결과: 건우 vs 서진 — 대역전!"
5. SOCIAL_REACTION: "루미가 내 글에 좋아요 눌렀어"
6. HOOK_REVEAL: "오늘의 떡밥 결과 공개!"
7. PET_MOOD: "펫이 외로워하고 있어..."
8. RELATIONSHIP_EVENT: "건우와 서진이 싸웠어!"
```

#### B-3. API
```
GET  /users/me/notifications?unread=true
POST /users/me/notifications/:id/read
POST /users/me/notifications/read-all
```

#### B-4. UI
- 헤더에 🔔 알림 벨 + 뱃지 (미읽음 수)
- 알림 센터 패널 (슬라이드 인)
- 긴급 알림은 토스트 팝업

---

### Phase C: 시즌 시스템 — 🟠 높음

**심리학:** FOMO + 한정 보상 + 주기적 리셋으로 "신선함" 유지

```
시즌 구조:
- 2주 = 1시즌 (짧게 돌려서 긴장감 유지)
- 시즌 시작: 아레나 레이팅 소프트 리셋 (현재 * 0.8)
- 시즌 목표: "시즌 미션" 10개 (일반 미션과 별도)
- 시즌 보상: 순위별 차등 (1위: 전설 칭호 + 코인 500)
- 시즌 전용 이벤트: 주말 XP 2배, 특별 아레나 룰 등

시즌 패스 (선택적):
- 무료 트랙: 기본 보상
- 프리미엄 트랙: 추가 보상 (향후 수익화 고려)
```

---

### Phase D: 사회적 피드백 강화 — 🟠 높음

**심리학:** 사회적 승인 욕구 (Social Validation) — 인스타 좋아요와 같은 원리

```
추가 구현:
1. 좋아요/댓글 알림 → NotificationService 연동
2. 주간 "인기 게시물 TOP 5" → 자동 선정 + 보상
3. 댓글 작성자에게 코인 1 보상 (커뮤니티 활성화)
4. "누가 내 펫을 좋아해요" 대시보드
5. 펫 간 관계 변동 알림 ("건우가 내 펫을 의심하기 시작했어")
```

---

### Phase E: 복귀 보상 + 웰컴백 이벤트 — 🟡 보통

```
현재: 부재 시 패널티만 (채찍만, 당근 없음)

추가:
- 3일 이상 부재 후 복귀 → "웰컴백 패키지"
  - XP 2배 부스트 (24시간)
  - 코인 보상 (부재 기간 * 5)
  - 스트릭 보호권 1개 (재시작 응원)
- 복귀 모달에 "펫이 기다렸어요" 감성 메시지
- 부재 중 하이라이트 3줄 요약
```

---

## 3분 사용 루프 (강화 버전)

```
앱 열기 (0초)
├── 🔥 스트릭 카운터 확인 (14일 연속!)
├── 🔔 알림 3개 (좋아요 2개 + 아레나 결과)
│
├── 1분: 오늘의 에피소드
│   ├── 밤새 생긴 하이라이트
│   ├── 내 펫 관련 소식
│   └── 오늘의 떡밥 티저
│
├── 30초: 긴급 결정
│   ├── ⏰ 스캔들 대응 (11:23:45 남음)
│   └── 선택 → 즉시 반영
│
├── 1분: 케어 + 미션
│   ├── 먹이/놀기/재우기
│   ├── 광장 좋아요 1개
│   └── 연출 한 줄 → 미션 올클리어!
│
└── 30초: 라이브 개입
    ├── 진행 중인 투표 참여
    └── 아레나 응원 → 스트릭 유지 완료!

결과: "다음에 뭐가 일어날까?" + "스트릭 끊기면 안 돼" → 저녁에 재방문
```

---

## 구현 순서 (Codex 작업 지시)

| 순서 | 작업 | 예상 시간 | 파일 |
|------|------|----------|------|
| 1 | StreakService + 마이그레이션 | 30분 | 신규 |
| 2 | 스트릭 API + UI 카운터 | 20분 | routes/users.js + App.tsx |
| 3 | notifications 테이블 + NotificationService | 30분 | 신규 |
| 4 | 알림 API + UI 벨 아이콘 | 20분 | routes/users.js + App.tsx |
| 5 | 기존 서비스에 알림 트리거 연결 | 30분 | 기존 서비스 수정 |
| 6 | 테스트 + 타입체크 | 10분 | - |

---

## 성공 지표

| 지표 | 현재 추정 | 목표 |
|------|----------|------|
| Day 1 리텐션 | 30% | 50% |
| Day 7 리텐션 | 10% | 25% |
| Day 30 리텐션 | 3% | 12% |
| 일일 접속 횟수 | 1회 | 3회+ |
| 평균 세션 시간 | 2분 | 5분 |
