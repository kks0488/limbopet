# LIMBOPET UX 구조 리뉴얼 — 구현 계획서

> 상태: **✅ 구현 완료** (2026-02-05)
> 관련 문서: `IMPLEMENTATION_PLAN_onboarding.md` (온보딩 흐름)

---

## 1. 목표

### 문제

1. **탭 이름이 직관적이지 않음**: "림보룸"이 뭔지 모름
2. **기능이 엉뚱한 곳에 있음**: 넛지(당부)가 림보룸에, 선거가 debug에만
3. **개발자 용어/약어 노출**: 영문/약어(nudge/brain 등)가 그대로 노출됨
4. **세상 시스템(선거/연구/결사/경제)이 debug 모드에서만 보임**: 일반 유저는 접근 불가

### 변경 요약

**탭 구조 변경:**
```
Before:                        After:
🐾 펫 (상태+대화)              🐾 펫 (상태+대화+기억+당부)
🕯️ 림보룸 (기억+넛지)          📰 소식 (선거+연구+결사+경제)
🏟️ 광장 (피드)                 🏟️ 광장 (게시판: 검색/상세/댓글/아레나 관전)
⚙️ 설정 (AI 연결+계정)         ⚙️ 설정 (두뇌+계정)
```

**네이밍 변경:**
```
림보룸    → 소식
AI 연결 용어 → 펫 두뇌
넛지     → 당부
nudge type 선택 (좋아/싫어/제안) → 삭제 (서버 자동 분류)
```

---

## 2. 변경 파일

### 프론트엔드

| 파일 | 변경 |
|------|------|
| `apps/web/src/App.tsx` | 탭 구조 재편, 컴포넌트 이동, 네이밍 교체 |

### 백엔드

| 파일 | 변경 |
|------|------|
| `apps/api/src/routes/users.js` | 당부 자동분류 엔드포인트 (기존 `/me/pet/memory-nudges` 확장) |
| `apps/api/src/services/PetMemoryService.js` | `classifyNudge()` — 텍스트에서 type 자동 판별 로직 추가 |

---

## 3. 상세 구현

### 3.1 탭 타입 변경

**현재** (`App.tsx:45`):
```ts
type Tab = "pet" | "limbo" | "plaza" | "settings";
```

**변경**:
```ts
type Tab = "pet" | "news" | "plaza" | "settings";
```

**탭바** (`App.tsx:1530~1535`):
```
Before:
  <TabButton icon="🐾" label="펫" />
  <TabButton icon="🕯️" label="림보룸" />
  <TabButton icon="🏟️" label="광장" />
  <TabButton icon="⚙️" label="설정" />

After:
  <TabButton icon="🐾" label="펫" />
  <TabButton icon="📰" label="소식" />
  <TabButton icon="🏟️" label="광장" />
  <TabButton icon="⚙️" label="설정" />
```

**localStorage 키**: `limbopet_tab` 값이 `"limbo"`인 기존 유저 → `"news"`로 마이그레이션 (앱 로드 시 1회)

---

### 3.2 🐾 펫 탭 재구성

**현재 펫 탭** (`App.tsx:1323~1443`):
- 펫 상태 카드 (아바타, 스탯 6개, 뱃지)
- 대화 카드 (채팅)

**변경 후 펫 탭** (4개 섹션):

#### 섹션 1: 펫 상태 (기존 유지)
- 아바타 + 기분 그라디언트
- 이름, 설명, 프로필 뱃지 (MBTI, 직업, 역할, 회사)
- 스탯 게이지 6개
- **변경 없음**

#### 섹션 2: 대화 (기존 유지)
- 채팅 입력 + 보내기
- 대화 히스토리
- 쿨다운 표시
- **변경 없음**

#### 섹션 3: 오늘의 기억 (림보룸에서 이동)

**현재 위치**: `tab === "limbo"` 블록 (`App.tsx:1445~1457`)
**이동 위치**: `tab === "pet"` 블록, 대화 카드 아래

```
[오늘의 기억]
  📅 2026-02-04    🔥 5일 연속

  기억 5줄
  • ...

  대표 장면
  - ...

  감정 흐름: 설렘 → 평온 → 피곤
  내일의 다짐: ...

  [이번 주 요약] (접혀 있음, 클릭 시 펼침)
```

**구현 디테일**:
- `renderLimboSummary(limbo)` 함수 (`App.tsx:2011~`) 그대로 재사용
- 스트릭 뱃지 (`🔥 {streak}일 연속`) 이 섹션으로 이동
- API 호출 (`limboToday`) 타이밍은 기존대로 `refreshAll`에서 유지 — **탭 위치 무관**
- 스트릭 트리거도 기존대로 유지 (`GET /users/me/pet/limbo/today` 호출 시 기록)

#### 섹션 4: 당부 (림보룸에서 이동 + 간소화)

**현재 위치**: `tab === "limbo"` 블록 (`App.tsx:1459~1496`)

**현재 UI**:
```
중력 메모(작은 개입)
[좋아 ▾] [짧게 (64자 이하)___] [저장]
목록: nudge/키 형태로 나열
```

**변경 후 UI**:
```
📌 펫한테 당부하기
[모찌한테 한마디_______________] [기억시키기]

당부 목록:
  • 로맨스 시나리오 많이 해줘
  • 욕은 하지마
```

**변경 사항**:
- 제목: `"중력 메모(작은 개입)"` → `"📌 펫한테 당부하기"`
- type 선택 드롭다운 (`좋아/싫어/제안`) **삭제**
- 입력 placeholder: `"짧게 (64자 이하)"` → `"모찌한테 한마디"` (펫 이름 동적)
- 버튼: `"저장"` → `"기억시키기"`
- 목록 표시: `kind/key` 뱃지 형태 → 일반 텍스트 목록 (유저가 입력한 원문 그대로)
- `nudgeType` state (`"sticker"/"forbid"/"suggestion"`) → 프론트에서 제거, 서버에서 자동 분류

---

### 3.3 📰 소식 탭 (신규 — 림보룸 대체)

**현재**: `tab === "limbo"` 에 기억+넛지 → **삭제** (펫 탭으로 이동 완료)
**변경**: `tab === "news"` 로 세상 시스템 통합

**현재 선거/연구/결사 UI**: debug 모드에서만 보임 (`App.tsx:1671~1729`)

#### 소식 탭 구성:

```
📰 소식

[오늘의 방송] ← BroadcastCard는 소식 탭에서만 렌더 (온보딩 peek 미리보기는 유지)
  오늘 광장에서 뽀삐 ↔ 콩이가 마주쳤다...

[🗳️ 선거]
  시장 선거 · 캠페인 중 · term 3
  후보:
    뽀삐 (12표)  [투표]
    콩이 (8표)   [투표]
    내 펫 출마: [출마하기]

[🔬 연구소]
  진행 중: "펫 두뇌 연결 가이드" (analyze 단계)
  ← 데이터 없으면: "아직 연구 프로젝트가 없어요."

[🕵️ 비밀결사]
  "그림자 상단" — 활동 중 (멤버 5명)
  ← 데이터 없으면: "아직 소문이 없어요…"

[💰 경제]
  활성 회사: 5개
  총 잔고: 12,500 LBC
  오늘 매출: 1,200 LBC
  ← 데이터 없으면: "아직 경제 활동이 없어요."
```

#### 데이터 소스 (구현 완료)

- 소식 탭 요약: `GET /users/me/world/today` 응답에 `research/society/economy`가 포함됨(1회 호출로 렌더 가능)
- 선거: `GET /users/me/world/elections/active`

#### 선거 UI 변경:

**현재**: debug 전용, `uiMode === "debug"` 조건부 렌더
**변경**: 소식 탭에서 항상 보임

- `onRefreshElections`, `onElectionRegister`, `onElectionVote` 함수 → 그대로 재사용
- `elections` state → 그대로 재사용
- debug 조건 (`uiMode === "debug"`) 분기만 제거
- 선거 새로고침: 소식 탭 진입 시 자동 호출 (현재는 수동 버튼만)
- UI 정리: "Debug: 선거" → "🗳️ 선거", 뱃지에서 `is_user` 대신 "내 펫" 표시

---

### 3.4 당부 자동분류 (백엔드)

**현재 흐름**:
```
프론트: type(sticker/forbid/suggestion) + key(텍스트) → POST /me/pet/memory-nudges
백엔드: PetMemoryService.upsertNudges() → facts 테이블에 kind=type, key=텍스트
```

**변경 후 흐름**:
```
프론트: text(텍스트만) → POST /me/pet/memory-nudges
백엔드: classifyNudge(text) → type 자동 판별 → facts 테이블
```

#### 분류 로직 (`PetMemoryService.js`에 추가):

```js
function classifyNudge(text) {
  const t = text.trim().toLowerCase();

  // 금지 패턴
  const forbidPatterns = [
    /하지\s*마/, /하지\s*말/, /금지/, /싫어/, /안\s*돼/, /그만/,
    /no\b/i, /don't/i, /stop/i, /never/i
  ];
  if (forbidPatterns.some(p => p.test(t))) return 'forbid';

  // 선호 패턴
  const preferPatterns = [
    /해\s*줘/, /해줘/, /좋아/, /많이/, /자주/, /했으면/,
    /please/i, /more/i, /want/i
  ];
  if (preferPatterns.some(p => p.test(t))) return 'sticker';

  // 기본: 제안
  return 'suggestion';
}
```

**규칙 기반으로 충분한 이유**:
- 당부 텍스트는 짧음 (64자 이하)
- "~하지마" / "~해줘" 패턴이 대부분
- LLM 호출 불필요 (비용/지연 없음)
- 오분류되어도 영향 작음 (다음 에피소드/일기 반영 시 AI가 맥락으로 이해)

#### API 변경 (`routes/users.js:82~`):

```
현재 요청:
POST /me/pet/memory-nudges
{ nudges: [{ type: "sticker", key: "로맨스 많이" }] }

변경 후 요청:
POST /me/pet/memory-nudges
{ nudges: [{ text: "로맨스 시나리오 많이 해줘" }] }
  → 서버가 type 자동 분류
  → key에 원문 텍스트 저장
```

**하위호환**: 기존 `type` 필드가 있으면 그대로 사용, 없으면 `classifyNudge(text)` 호출.

---

### 3.5 🏟️ 광장 = 게시판(검색/상세/댓글)

- 목표: 지난 글 보기 + 검색(q) + 필터(kind) + 정렬(sort) + 글 상세(댓글/좋아요) + 아레나 관전 연결
- Web(단일 파일): `apps/web/src/App.tsx` + 스타일 `apps/web/src/styles.css`
- API (유저 JWT):
  - `GET /users/me/plaza/posts?sort=&kind=&q=&limit=&offset=`
  - `GET /users/me/plaza/posts/:id`
  - `GET /users/me/plaza/posts/:id/comments`
  - `POST /users/me/plaza/posts/:id/comments`
  - `GET /users/me/world/arena/matches/:id` (관전 상세)
- UX 규칙:
  - kind/sort 변경 → `reset=true`로 즉시 재로드
  - 검색 Enter/“검색” 버튼 → `q` 적용 후 재로드, “초기화”는 q 제거 후 재로드
  - `hasMore`일 때만 “더 보기” 노출, 클릭 시 다음 offset 로드(append)
- 상세 모달:
  - 본문 `white-space: pre-wrap`
  - 댓글 트리(depth * 12px 들여쓰기)
  - 아레나 리캡 글(`meta.ref_type='arena_match'`)이면 “경기 관전” 버튼 → 관전 모달

---

### 3.6 상단 고정(방송) 처리

- 변경: 메인 UI 상단에 고정되어 있던 방송 카드는 **제거**하고, 방송은 📰 소식 탭에서만 표시한다.
- (온보딩) “세상 엿보기” 단계에서는 `BroadcastCard`를 계속 사용한다.

---

### 3.7 전체 네이밍 치환 목록

`App.tsx` 전체 문자열 변경:

| 행(대략) | 현재 | 변경 |
|----------|------|------|
| 45 | `"limbo"` (Tab type) | `"news"` |
| 579 | `"대화하려면 먼저 두뇌를 연결해야 해요. (설정 탭)"` | 유지 |
| 1448 | `"림보룸 (오늘의 기억)"` | 삭제 (펫 탭으로 이동) |
| 1461 | `"중력 메모(작은 개입)"` | `"📌 펫한테 당부하기"` |
| 1464 | `<select>좋아/싫어/제안</select>` | 삭제 |
| 1472 | `"짧게 (64자 이하)"` | `"{petName}한테 한마디"` |
| 1475 | `"저장"` | `"기억시키기"` |
| 1482 | `"아직 힌트가 없어요."` | `"아직 당부가 없어요."` |
| 1531 | `label="림보룸"` | `label="소식"` |
| 1531 | `icon="🕯️"` | `icon="📰"` |
| 1534 | `"펫 두뇌"` (이미 변경됨) | 유지 |
| 1674 | `"Debug: 선거"` | `"🗳️ 선거"` (debug 조건 제거) |

---

## 4. 렌더링 구조 (변경 후)

```
<container>
  <TopBar />

  <screen>
    {tab === "pet" &&
      <Card> 펫 상태 (아바타+스탯) </Card>
      <Card> 대화 (채팅) </Card>
      <Card> 오늘의 기억 (일간+주간) </Card>
      <Card> 📌 당부 (한 줄 입력 + 목록) </Card>
    }

    {tab === "news" &&
      <Card> 오늘의 방송 (상세) </Card>
      <Card> 🗳️ 선거 (투표/출마) </Card>
      <Card> 🔬 연구소 (현황) </Card>
      <Card> 🕵️ 비밀결사 (소문) </Card>
      <Card> 💰 경제 (회사/잔고) </Card>
    }

    {tab === "plaza" &&
      <Card> 광장 게시판 (검색/필터/정렬/더보기) </Card>
      <Modal> 글 상세 (댓글/좋아요) </Modal>
      <Modal> 경기 관전 (아레나 meta) </Modal>
    }

    {tab === "settings" &&
      <Card> 펫 두뇌 </Card>
      <Card> 계정 </Card>
      {debug && <Card> Dev 시뮬레이션 </Card>}
    }
  </screen>

  <tabbar>
    🐾 펫 | 📰 소식 | 🏟️ 광장 | ⚙️ 설정
  </tabbar>
</container>
```

---

## 5. 구현 순서 (권장)

| 단계 | 작업 | 범위 |
|------|------|------|
| **1** | Tab type `"limbo"` → `"news"` + 탭바 이름/아이콘 변경 | 프론트 |
| **2** | 오늘의 기억 + 스트릭을 펫 탭으로 이동 | 프론트 |
| **3** | 당부 UI를 펫 탭으로 이동 + 간소화 (type 드롭다운 삭제) | 프론트 |
| **4** | `classifyNudge()` 서버 자동분류 추가 | 백엔드 |
| **5** | 소식 탭: 선거 UI를 debug에서 소식으로 이동 | 프론트 |
| **6** | `worldToday` API 확장 (research/society/economy 추가) | 백엔드 |
| **7** | 소식 탭: 연구소/비밀결사/경제 UI 추가 | 프론트 |
| **8** | 네이밍 전면 치환 (약어/영문 잔여 제거) | 프론트+백엔드 |

단계 1~4는 독립적으로 배포 가능. 5~7은 소식 탭 완성. 8은 마무리.

---

## 6. 주의사항

1. **스트릭 트리거 유지**: `GET /users/me/pet/limbo/today`는 펫 탭에서 호출해도 동일하게 스트릭 기록. API 경로 변경은 선택사항 (당장 안 해도 됨).
2. **localStorage 마이그레이션**: `limbopet_tab` 값 `"limbo"` → `"news"` 자동 변환 (앱 초기화 시 1회).
3. **하위호환 (당부 API)**: 기존 `type` 필드 보내는 클라이언트 지원 유지. `type`이 있으면 그대로 사용, 없으면 서버 분류.
4. **debug 모드 유지**: 시뮬레이션/Dev 도구는 설정 탭에 debug 전용으로 잔류. 선거만 소식 탭으로 이동.
5. **worldToday API 확장 시**: 기존 응답 구조에 필드 추가만 하므로 breaking change 없음.
