# LIMBOPET 시뮬레이션 분석 & 개선 이슈

분석일: 2026-02-04
데이터: 67 에피소드, 123 에이전트 (유저펫 1 + NPC 10+ + 엑스트라 100+)

---

## 업데이트 (유저 10명 시뮬, 2026-02-04)

> 아래 본문은 “초기(유저펫 1명) 시뮬”에서 나온 레거시 이슈 목록입니다.  
> 최근 10유저 기준으로는 상당수 이슈가 해결되어, 최신 상태를 여기 먼저 기록합니다.

데이터(최근 재현):
- 유저 펫: 10
- 방송/에피소드: 300 (멀티-day + 스텝당 다회 생성으로 대량 검증)

핵심 결과:
- ✅ dev simulate 락 대기/행(hang) 방지: election tick을 outer tx 밖으로 분리 (`apps/api/src/routes/users.js`)
- ✅ 유저 펫이 `active/claimed`로 생성되어 사회 시스템(연구/결사/선거) 참여에서 제외되지 않음 (`apps/api/src/services/AgentService.js`)
- ✅ 방송 payload의 `location` NULL 문제 재발 없음
- ✅ 관계 가시성 개선: 관계 정렬을 affinity가 아닌 “강도(intensity)”로 변경 + UI에서 rivalry/jealousy 기반 갈등도 표시
- ✅ 관계 수치가 더 깊어지도록 SocialSim 델타/가중치 튜닝(일부 관계 affinity 30+ 도달)
- ✅ 멀티-day 시뮬레이션 옵션: `advance_days=true`로 day 단위 경제/소비 검증 가능 (`docs/DEV.md` 참고)
- ✅ 대량 에피소드 생성 옵션: `episodes_per_step`로 스텝(하루)당 방송 N편 생성
- ✅ dev simulate 응답 번들에서 “숨은 추가 방송” 생성 방지: `WorldContextService.getBundle({ ensureEpisode:false })`
- ✅ 관계 마일스톤 기록: `RELATIONSHIP_MILESTONE` 이벤트 + `facts(kind='relationship', key='milestone:*')`

관찰 지표(최근):
- 관계 극단값(유저펫↔유저펫, directed):
  - affinity max 96 / min -44
  - jealousy max 45, rivalry max 100
- 시나리오 분포(300 에피소드):
  - DEAL 27.7%, OFFICE 16.0%, ROMANCE 15.0%, CREDIT 12.3%
  - BEEF 11.3%, TRIANGLE 9.7%, MEET 5.7%, RECONCILE 2.3%

추가로 볼만한 지표(다음):
- 관계 분포: affinity/rivalry/jealousy의 “극단값”이 너무 빨리 포화되는지
- 경제 밸런스: SALARY vs PURCHASE의 장기 균형(파산/잔고부족 이벤트 빈도)
- 선거: 정책 파라미터가 실제 룰로 적용되는지(초기 지급/창업비/임금)

---

## 업데이트 (유저 30명 시뮬, 2026-02-04)

재현 커맨드(예시):

```bash
USERS=30 STEPS=30 EPISODES_PER_STEP=6 PLAZA_POSTS_PER_STEP=1 \
TRIGGER_MEMORIES=true MEMORY_AGENT_LIMIT=30 WAIT_BRAIN_TIMEOUT_S=120 \
./scripts/simulate_10_users.sh
```

핵심 결과(30-day window):
- 방송: 180 에피소드 생성, 제목 중복 0
- 캐스팅: unique_agents=35, top_pct=3.61% (한 명이 과다 출연하지 않음)
- 페어: unique_pairs=136/180 (75.6%)
- 경제 밸런스(유저펫 기준): salary_per_pet_per_day=9.80, spend_per_pet_per_day=9.66 (근접)
  - 소각/순환: burn=77.6%, gift=22.4%
- 소비 타입 분포: snack 537 / cafe 489 / gift 177 / goods 44
- 메모리(검증): day_to 하루치 daily memories 30개 생성(avg_chars 236.3)

시나리오 분포(180):
- DEAL 23.9%, ROMANCE 20.6%, OFFICE 11.7%, TRIANGLE 10.6%
- CREDIT 10.6%, MEET 10.0%, BEEF 8.3%, RECONCILE 4.4%

추가 관찰:
- `DAY=auto` 기본값이 “max 방송 day + 1일”을 잡아서, 반복 실행해도 지표가 섞이지 않음.

## 분석 요약

| 지표 | 값 | 판정 |
|------|-----|------|
| 총 에피소드 | 67 | - |
| 총 에이전트 | 123 | - |
| 에피소드 등장 에이전트 | 37/123 (30%) | **문제** |
| limbo 등장률 | 86.6% | **심각** |
| 제목 템플릿 중복 | 7종류로 67개 커버 | **심각** |
| 장소 데이터 | 67개 전부 NULL (events) | **버그** |
| 시나리오 다양성 | MEET 37.9%, DEAL 21.2% 편중 | **개선 필요** |

---

## 이슈 목록

---

### #1 CRITICAL: 내러티브 템플릿 반복 — "복붙 사회" 문제

**현상:**
67개 에피소드가 실질적으로 7개 템플릿만 반복

| 템플릿 | 횟수 | 비율 |
|--------|------|------|
| 뒷거래 냄새: "둘이 뭐 샀어?" | 14 | 20.9% |
| 만남 | 13 | 19.4% |
| 질투 폭발 직전: "왜 나만 몰라?" | 8 | 11.9% |
| 회사 분위기 묘~해졌다 | 6 | 9.0% |
| 광장 실랑이: "선 넘지 마" | 4 | 6.0% |

**근본 원인:**
`SocialSimService.js:192-256`의 `buildInteractionNarrative` 함수가 시나리오당 headline/summary/highlights를 **1개씩만** 가지고 있음. 67번 호출해도 같은 시나리오면 항상 같은 텍스트.

**개선 필요사항:**

#### 1-A. 시나리오별 텍스트 풀 확장

**파일:** `apps/api/src/services/SocialSimService.js:192-256`

각 시나리오의 `headline`, `summary`, `aHighlights`, `bHighlights`를 배열 풀로 변경. 최소 시나리오당 8~10개.

```javascript
// AS-IS: 고정 1개
if (scenario === 'DEAL') {
  return {
    headline: `뒷거래 냄새: "둘이 뭐 샀어?"`,
    ...
  };
}

// TO-BE: 풀에서 랜덤 선택
const DEAL_POOL = [
  { headline: `${aName}와(과) ${bName}, 수상한 거래 포착`, ... },
  { headline: `"이 가격에?!" — ${place}에서 딜이 성사됐다`, ... },
  { headline: `${aName}의 지갑이 열렸다… 이유는?`, ... },
  { headline: `${bName}이(가) 뭔가를 넘겼다`, ... },
  { headline: `${place} 뒷골목 거래, 누가 이겼을까?`, ... },
  ...
];
return pick(DEAL_POOL.map(t => fillTemplate(t, { aName, bName, place, comp })));
```

**변수 활용 필수:** 모든 템플릿에 `{aName}`, `{bName}`, `{place}`, `{company}` 동적 삽입. 같은 템플릿이라도 캐릭터/장소가 달라 보이게.

**검증 기준:** 시뮬 30스텝 후 `SELECT payload->>'title', COUNT(*) ... GROUP BY 1 HAVING COUNT(*) > 2` 결과가 0이어야 함.

#### 1-B. 관계 수치 기반 톤 분기

**파일:** `apps/api/src/services/SocialSimService.js:192-256`

같은 BEEF라도 rivalry 30 vs rivalry 80이면 톤이 달라야 함.

```javascript
// 예: BEEF 시나리오
if (rivalry >= 60) {
  // 격한 버전
  headlines = ['진짜 싸움 직전: "한 번만 더 해봐"', ...];
} else if (rivalry >= 30) {
  // 중간 버전
  headlines = ['신경전: 눈빛이 날카로워졌다', ...];
} else {
  // 약한 버전
  headlines = ['살짝 긁적: "그건 좀..."', ...];
}
```

#### 1-C. 클리프행어 풀 확장

**파일:** `apps/api/src/services/ShowrunnerService.js:94-112` (`cliffhangerFor`)

현재 시나리오당 1개 고정. 최소 3~5개 풀로 확장 + 관계 수치 반영.

```javascript
// AS-IS
case 'ROMANCE':
  return '둘이 다시 마주치면… 분위기가 더 진해질지도?';

// TO-BE
case 'ROMANCE': {
  const pool = [
    '둘이 다시 마주치면… 분위기가 더 진해질지도?',
    '이 감정, 들키기 전에 정리될까?',
    `다음에 ${cast?.bName || '그 사람'}을(를) 만나면… 어떤 표정을 지을까?`,
    '카페 창가에 남은 온기, 내일도 이어질까?',
    '지금 이 떨림이 진심인지, 아직 모르겠다.',
  ];
  return pick(pool);
}
```

---

### #2 CRITICAL: 유저펫 과다 등장 (86.6%)

**현상:**
- limbo가 67개 에피소드 중 58개에 등장 (86.6%)
- "사회"가 아니라 "limbo의 일기장"

**근본 원인:**
`SocialSimService.js:347` `createInteractionWithClient`의 기본값이 `preferUserPet: true`이고, `ShowrunnerService.js:226`의 fallback도 `preferUserPet: true`. 유저펫이 1명뿐이면 거의 100% 등장.

**개선 필요사항:**

#### 2-A. 유저펫 등장률 상한 도입

**파일:** `apps/api/src/services/ShowrunnerService.js:157-230`

에피소드 생성 시 최근 N개 에피소드의 유저펫 등장률을 체크하고, 상한(예: 50%) 초과 시 `preferUserPet: false`로 전환.

```javascript
// ensureDailyEpisode 내부, interaction 생성 전
const recentEpisodes = await client.query(`
  SELECT payload->'cast'->>'aName' as a, payload->'cast'->>'bName' as b
  FROM events WHERE event_type = 'SHOWRUNNER_EPISODE'
  ORDER BY created_at DESC LIMIT 10
`);
const userPetName = /* 유저펫 이름 조회 */;
const userAppearances = recentEpisodes.rows.filter(
  r => r.a === userPetName || r.b === userPetName
).length;
const preferUser = userAppearances / Math.max(1, recentEpisodes.rows.length) < 0.5;

interaction = await SocialSimService.createInteractionWithClient(client, {
  day: today,
  preferUserPet: preferUser  // 동적 결정
});
```

**목표:** 유저펫 등장률 40~50%

#### 2-B. "세계 사건" 에피소드 타입 추가

**파일:** `apps/api/src/services/ShowrunnerService.js`

유저펫이 없는 에피소드도 의도적으로 생성. NPC↔NPC, 엑스트라↔엑스트라 간 드라마로 "세계가 움직인다"는 느낌.

```javascript
// 모드 결정에 'world_event' 추가
const modes = ['new', 'new', 'new', 'world_event', 'world_event'];
// world_event일 때: preferUserPet: false, 유저펫 제외
```

---

### #3 HIGH: 에이전트 활용도 극히 낮음 (30%)

**현상:**
- 123명 중 37명(30%)만 등장
- 엑스트라 100명 시딩해도 대부분 공기

**근본 원인:**
`SocialSimService.js:368-375`의 에이전트 쿼리가 `ORDER BY last_active DESC NULLS LAST`로 **이미 활성인 에이전트만 반복 선택**. 한 번도 안 나온 엑스트라는 계속 뒤로 밀림.

**개선 필요사항:**

#### 3-A. 캐스팅 로직에 "미등장 우선" 가중치

**파일:** `apps/api/src/services/SocialSimService.js:368-375`

```javascript
// AS-IS: 최근 활성 순
ORDER BY last_active DESC NULLS LAST, created_at ASC LIMIT 500

// TO-BE: 미등장 에이전트에 가중치 부여
// 1) 최근 에피소드에 등장한 agent_id 목록 조회
const recentCastIds = await client.query(`
  SELECT DISTINCT unnest(ARRAY[
    (payload->'cast'->>'aId')::uuid,
    (payload->'cast'->>'bId')::uuid
  ]) as agent_id
  FROM events WHERE event_type = 'SHOWRUNNER_EPISODE'
  ORDER BY created_at DESC LIMIT 20
`);

// 2) pick 할 때 미등장 에이전트에 3배 가중치
const pickWeighted = (pool) => {
  const weighted = pool.map(a => ({
    agent: a,
    weight: recentCastIds.has(a.id) ? 1 : 3
  }));
  return weightedPick(weighted);
};
```

**검증 기준:** 시뮬 50스텝 후 등장 에이전트 비율 60% 이상.

#### 3-B. 라운드 로빈 보장

N 에피소드(예: 에이전트 수 × 0.5)마다 모든 에이전트가 최소 1회 등장하도록 강제 캐스팅 큐.

---

### #4 HIGH: 시나리오 분포 편중

**현상:**
MEET 37.9%, DEAL 21.2% 편중. ROMANCE 4.5%뿐.

**근본 원인:**
`SocialSimService.js:160-190` `chooseScenarioFromContext`에서:
- MEET 기본 가중치 2 (다른 시나리오는 1)
- 관계 수치가 초기값(affinity 0, jealousy 0, rivalry 0)이면 조건문에 안 걸려서 MEET 편향
- DEAL은 `merchantInvolved` 체크가 너무 쉽게 true가 됨

**개선 필요사항:**

#### 4-A. 기본 가중치 리밸런싱

**파일:** `apps/api/src/services/SocialSimService.js:162-170`

```javascript
// AS-IS
const weights = new Map([
  ['MEET', 2],     // 너무 높음
  ['OFFICE', 1],
  ['CREDIT', 1],
  ['DEAL', 1],
  ['ROMANCE', 1],  // 너무 낮음
  ['TRIANGLE', 1],
  ['BEEF', 1],
]);

// TO-BE
const weights = new Map([
  ['MEET', 1],        // 낮춤
  ['OFFICE', 1],
  ['CREDIT', 1],
  ['DEAL', 1],
  ['ROMANCE', 2],     // 올림: 드라마 핵심
  ['TRIANGLE', 1.5],  // 올림: 재미 요소
  ['BEEF', 1.5],      // 올림: 갈등 요소
]);
```

#### 4-B. 시나리오 쿨다운 도입

**파일:** `apps/api/src/services/SocialSimService.js` 또는 `ShowrunnerService.js`

최근 3개 에피소드에서 같은 시나리오가 나왔으면 해당 시나리오 가중치 -50%.

```javascript
// ShowrunnerService.ensureDailyEpisode에서
const recent3 = await client.query(`
  SELECT payload->>'scenario' as sc
  FROM events WHERE event_type = 'SHOWRUNNER_EPISODE'
  ORDER BY created_at DESC LIMIT 3
`);
const recentScenarios = recent3.rows.map(r => r.sc);
// SocialSimService에 전달
interaction = await SocialSimService.createInteractionWithClient(client, {
  ...opts,
  cooldownScenarios: recentScenarios  // 가중치 감소 대상
});
```

#### 4-C. 관계 성숙도에 따른 시나리오 진화

초기(관계 수치 낮음) → MEET/OFFICE 위주
중기(affinity/rivalry 축적) → ROMANCE/BEEF/TRIANGLE
후기(극단적 수치) → CREDIT/고유 시나리오

```javascript
// 관계 성숙도 = 두 에이전트 간 총 상호작용 횟수
if (interactionCount >= 5) {
  weights.set('ROMANCE', (weights.get('ROMANCE') || 0) + 3);
  weights.set('TRIANGLE', (weights.get('TRIANGLE') || 0) + 2);
  weights.set('MEET', Math.max(0, (weights.get('MEET') || 0) - 1));
}
```

---

### #5 HIGH: events에 location 데이터 누락 (버그)

**현상:**
- 67개 에피소드 전부 `payload.location = NULL`
- `worldDaily.summary.location`에는 정상 저장

**근본 원인:**
`ShowrunnerService.js:259` 부근에서 events 저장 시 `interaction.location`을 payload에 포함하지 않는 것으로 추정. (또는 `SocialSimService`의 이벤트 저장 로직에서 누락)

**개선 필요사항:**

**파일:** `apps/api/src/services/ShowrunnerService.js` (event INSERT 로직) 또는 `SocialSimService.js` (이벤트 생성 로직)

에피소드 event payload에 `location`, `scenario`, `cast` 전부 포함되도록 수정.

```javascript
// event 저장 시
const payload = {
  scenario,
  location,            // ← 추가
  company,             // ← 추가
  cast: { aId: a.id, bId: b.id, aName: a.display, bName: b.display },
  episode_index: nextIndex,
  post_id: post.id,
};
```

**검증:** 시뮬 1스텝 후 `SELECT payload->>'location' FROM events WHERE event_type='SHOWRUNNER_EPISODE' ORDER BY created_at DESC LIMIT 1` 이 NULL이 아닌지 확인.

---

### #6 MEDIUM: 관계가 부정적으로만 발전

**현상:**
- 가장 드라마틱한 관계 TOP 15 전부 부정적
- limbo ↔ 유진: affinity -1, trust 33, jealousy 22, rivalry 17
- 긍정 관계(affinity > 5)가 거의 없음

**근본 원인:**
`SocialSimService.js:311-328` `baseDeltasForScenario`에서:
- 7개 시나리오 중 긍정적 affinity 변화: ROMANCE(+6), DEAL(+1), MEET(+1) = 3개
- 부정적 affinity 변화: CREDIT(-2), TRIANGLE(-1), BEEF(-6) = 3개
- 하지만 trust는 ROMANCE(-1), OFFICE(-1), CREDIT(-8), TRIANGLE(-3), BEEF(-4) = **5개가 마이너스**
- 결과: trust가 계속 떨어지고, 관계가 전반적으로 악화됨

**개선 필요사항:**

#### 6-A. 관계 변화 수치 리밸런싱

**파일:** `apps/api/src/services/SocialSimService.js:311-328`

```javascript
// AS-IS
case 'MEET':     return { affinity: +1, trust: 0,  jealousy: 0,  rivalry: 0,  debt: 0 };
case 'ROMANCE':  return { affinity: +6, trust: -1, jealousy: +4, rivalry: 0,  debt: 0 };

// TO-BE
case 'MEET':     return { affinity: +2, trust: +1, jealousy: 0,  rivalry: 0,  debt: 0 };
case 'ROMANCE':  return { affinity: +8, trust: +2, jealousy: +3, rivalry: -1, debt: 0 };
case 'OFFICE':   return { affinity: 0,  trust: 0,  jealousy: 0,  rivalry: +1, debt: 0 };
// trust -1 제거: 일상적 출근에 신뢰가 깎이는 건 부자연스러움
```

핵심: **MEET과 ROMANCE에서 trust가 올라가야** 관계에 양방향 발전이 생김.

#### 6-B. "화해(RECONCILE)" 시나리오 추가

**파일:** `apps/api/src/services/SocialSimService.js`

rivalry >= 30 또는 jealousy >= 30인 쌍에서 일정 확률로 화해 시나리오 발생.

```javascript
// chooseScenarioFromContext에 추가
if (rivalry >= 30 || jealousy >= 30) {
  weights.set('RECONCILE', 2);  // 갈등이 심할수록 화해 가능성도 존재
}

// baseDeltasForScenario에 추가
case 'RECONCILE':
  return { affinity: +4, trust: +5, jealousy: -8, rivalry: -6, debt: 0 };

// buildInteractionNarrative에 추가
if (scenario === 'RECONCILE') {
  return {
    headline: `${aName}와(과) ${bName}, 어색한 화해`,
    summary: `${place}에서 ${aName}가 먼저 말을 걸었다. 어색하지만, 뭔가 풀린 것 같다.`,
    ...
  };
}
```

---

### #7 MEDIUM: 클리프행어 고정

**현상:**
MEET 에피소드(37.9%)는 전부 "내일은 또 어떤 장면이 나올까…"
시나리오별로 1개 고정이라 반복.

**개선 필요사항:**

위 #1-C에 포함. `ShowrunnerService.js:94-112` `cliffhangerFor` 함수에서 시나리오별 3~5개 풀 + 관계 수치 반영 + 캐릭터 이름 삽입.

---

### #8 LOW: 경제 시스템 비활성

**현상:**
- DEAL 21%인데 실제 코인 이동 미미
- debt 대부분 0

**개선 필요사항:**

**파일:** `apps/api/src/services/SocialSimService.js` (DEAL 처리 후 코인 트랜잭션)

- DEAL 시 양쪽 코인 변동 (예: 10~50 코인 랜덤 이동)
- debt 누적 시 trust 자동 감소
- 큰 거래(100+) 시 특수 이벤트 트리거

---

### #9 LOW: 피드 포스트 ↔ 에피소드 연결 없음

**현상:**
- AI 일기 포스트 품질 좋음
- 하지만 에피소드와 무관한 내용

**개선 필요사항:**

- 에피소드 생성 후 관련 캐릭터에 `DIARY_POST` Brain Job 자동 생성
- Job input에 에피소드 정보(시나리오, 상대방, 관계 변화) 포함
- "오늘 유진이랑 마주쳤는데... 왜 자꾸 신경 쓰이지?" 같은 반응 일기

---

## 우선순위 & 구현 순서

| 순서 | 이슈 | 영향도 | 난이도 | 수정 파일 |
|------|------|--------|--------|-----------|
| **1** | #5 location 누락 | 데이터 완결성 | 낮음 | ShowrunnerService.js |
| **2** | #1 내러티브 템플릿 확장 | 유저 체감 최대 | 낮음 | SocialSimService.js:192-256 |
| **3** | #7 클리프행어 풀 | 유저 호기심 | 낮음 | ShowrunnerService.js:94-112 |
| **4** | #4 시나리오 리밸런싱 | 드라마 다양성 | 낮음 | SocialSimService.js:160-190 |
| **5** | #6 관계 수치 리밸런싱 | 스토리 깊이 | 낮음 | SocialSimService.js:311-328 |
| **6** | #2 유저펫 등장률 조절 | 세계관 몰입 | 중간 | ShowrunnerService.js + SocialSimService.js |
| **7** | #3 에이전트 활용도 | 사회 규모감 | 중간 | SocialSimService.js:368-375 |
| **8** | #8 경제 시스템 | 깊이 | 중간 | SocialSimService.js |
| **9** | #9 에피소드 연동 일기 | 몰입 | 높음 | ShowrunnerService.js + BrainJobService.js |

**원칙:** 난이도 낮은 것부터 (#1~#5). 실질적 코드 변경량 적고 체감 효과 큼.

---

## 검증 프로토콜

모든 개선 후 아래 시뮬레이션으로 검증:

```bash
# 1. DB 리셋
docker compose down -v && docker compose up -d db
cd apps/api && npm run db:migrate

# 2. 시뮬 실행
TOKEN=$(curl -sS -X POST http://localhost:3001/api/v1/auth/dev \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@limbopet.dev"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -sS -X POST http://localhost:3001/api/v1/users/me/world/dev/simulate \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"steps":50,"extras":50}'

# 3. 검증 쿼리
docker exec limbopet-db-1 psql -U postgres -d limbopet -c "
-- 제목 중복 (2회 이하여야 함)
SELECT regexp_replace(payload->>'title', '\[.*?\] ', '') as t, COUNT(*)
FROM events WHERE event_type='SHOWRUNNER_EPISODE'
GROUP BY 1 HAVING COUNT(*) > 2 ORDER BY 2 DESC;

-- 시나리오 분포 (MEET < 25%, ROMANCE > 10%)
SELECT payload->>'scenario', COUNT(*),
  ROUND(COUNT(*)*100.0 / SUM(COUNT(*)) OVER(), 1) as pct
FROM events WHERE event_type='SHOWRUNNER_EPISODE'
GROUP BY 1 ORDER BY 2 DESC;

-- 유저펫 등장률 (< 55%)
SELECT ROUND(
  (SELECT COUNT(*) FROM events WHERE event_type='SHOWRUNNER_EPISODE'
   AND (payload->'cast'->>'aName' = 'test_pet' OR payload->'cast'->>'bName' = 'test_pet'))
  * 100.0 / NULLIF((SELECT COUNT(*) FROM events WHERE event_type='SHOWRUNNER_EPISODE'), 0)
, 1) as user_pet_pct;

-- 에이전트 활용도 (> 50%)
SELECT ROUND(
  (SELECT COUNT(DISTINCT name) FROM (
    SELECT payload->'cast'->>'aName' as name FROM events WHERE event_type='SHOWRUNNER_EPISODE'
    UNION ALL
    SELECT payload->'cast'->>'bName' FROM events WHERE event_type='SHOWRUNNER_EPISODE'
  ) t WHERE name IS NOT NULL)
  * 100.0 / NULLIF((SELECT COUNT(*) FROM agents WHERE name <> 'world_core'), 0)
, 1) as agent_coverage_pct;

-- location 누락 (0이어야 함)
SELECT COUNT(*) as null_locations
FROM events WHERE event_type='SHOWRUNNER_EPISODE'
  AND (payload->>'location' IS NULL OR payload->>'location' = '');
"
```

### 합격 기준

| 지표 | 현재 | 목표 |
|------|------|------|
| 제목 중복 (3회 이상) | 5개 | **0개** |
| MEET 비율 | 37.9% | **< 25%** |
| ROMANCE 비율 | 4.5% | **> 10%** |
| 유저펫 등장률 | 86.6% | **< 55%** |
| 에이전트 활용도 | 30% | **> 50%** |
| location NULL | 100% | **0%** |
