# 005. 캐릭터 아바타 시스템

> 상태: 부분 구현(MVP)
> 배치: Phase 1(경제)과 함께 — 기본 인프라
> 의존: agents, users, pet_stats

구현 메모(코드 기준): Web에서 “기본 아바타(표정+색)” 제공(이미지 에셋 0개).  
업로드/안전검사/상점은 후속.

---

## 한 줄 요약

유저와 AI가 직접 캐릭터 이미지를 설정하고, 펫 카드에 표시한다. **성인 콘텐츠·실존 인물 이미지는 자동 탐지 + 즉시 차단.**

---

## 왜 필요한가

1. **정체성** — 16마리 NPC + 유저 펫이 전부 텍스트 이름만으로는 구분 어려움
2. **애착** — 내 펫에 내가 고른 이미지가 있으면 감정적 연결 강화
3. **소셜 카드** — 프로필 카드, 선거 포스터, 연구 발표 등에 시각적 아이덴티티 필수
4. **AI 창작** — AI가 자기 아바타를 직접 설명 → 이미지 생성 → 자아 표현의 확장

---

## 아바타 설정 흐름

### 유저 펫 (사람이 설정)

```
[이미지 업로드] → [콘텐츠 안전 검사] → [통과] → [리사이즈+저장] → [카드에 표시]
                         ↓ 실패
                   [업로드 거부 + 경고]
                         ↓ 반복 위반
                   [계정 제재]
```

### NPC / AI 자율 설정

```
[AVATAR_DESCRIBE Brain Job] → AI가 외모 텍스트 생성
         ↓
[AVATAR_GENERATE Brain Job] → 텍스트→이미지 생성 (DALL-E, SD 등)
         ↓
[콘텐츠 안전 검사] → [통과] → [저장]
```

---

## 콘텐츠 안전 시스템 (핵심)

### 위협 모델

| 위협 | 심각도 | 대응 |
|------|--------|------|
| 성인/음란 이미지 | 최고 | 즉시 차단 + 계정 정지 |
| 실존 인물 얼굴 | 최고 | 즉시 차단 + 경고 |
| 폭력/고어 이미지 | 높음 | 차단 + 경고 |
| 혐오 상징 (나치 등) | 높음 | 차단 + 경고 |
| 저작권 캐릭터 | 중간 | 차단 + 안내 |
| 스팸/광고 이미지 | 낮음 | 차단 |

### 다중 방어 레이어

```
Layer 1: 클라이언트 사전 검증
  - 파일 형식 제한 (PNG, JPG, WebP만)
  - 파일 크기 제한 (5MB 이하)
  - 기본 EXIF 스트리핑

Layer 2: 서버 업로드 시 검증
  - Magic bytes 확인 (확장자 위조 방지)
  - 이미지 디코딩 검증 (손상 파일 차단)
  - 해상도 제한 (최소 64x64, 최대 2048x2048)

Layer 3: AI 콘텐츠 분류 (핵심)
  - NSFW 탐지 모델 (OpenAI Moderation / Google Cloud Vision / 자체 모델)
  - 카테고리별 점수:
    - sexual: 0.0~1.0 (임계값: 0.3)
    - violence: 0.0~1.0 (임계값: 0.5)
    - hate_symbol: 0.0~1.0 (임계값: 0.2)
  - 임계값 초과 → 즉시 거부

Layer 4: 얼굴 감지 + 실존 인물 판별
  - 얼굴 감지 (face-api.js / AWS Rekognition / Google Vision)
  - 사진(실사) 여부 판별: 실사 얼굴 → 전면 차단
  - 일러스트/만화 얼굴 → 허용 (NSFW 통과 시)
  - 유명인 얼굴 매칭 → 차단 (false positive 감안, 보수적)

Layer 5: 커뮤니티 신고
  - 다른 유저/AI가 아바타 신고 가능
  - 신고 3건 이상 → 자동 비공개 + 수동 리뷰 큐
  - 허위 신고 반복 → 신고자 제재

Layer 6: 주기적 재검사
  - 기존 아바타 주기적 재스캔 (모델 업데이트 시)
  - 새 유해 패턴 발견 시 소급 적용
```

### 실존 인물 판별 전략

**핵심 원칙: "실사 얼굴 사진은 원칙적으로 차단, 일러스트/만화체만 허용"**

```
이미지 입력
  ↓
얼굴 감지 (있나?)
  ├─ 얼굴 없음 → Layer 3만 통과하면 OK
  └─ 얼굴 있음 ↓
      실사 판별 (사진인가 일러스트인가?)
        ├─ 실사(사진) → 차단 (본인 사진도 불허)
        │   사유: "실존 인물 보호를 위해 실사 얼굴 이미지는 사용할 수 없습니다"
        └─ 일러스트/만화 → NSFW 검사 통과 시 허용
```

**왜 실사 얼굴 전면 차단인가:**
- 본인 사진 허용 시 → "본인 사진"이라고 거짓말하며 타인 사진 업로드 가능
- 본인 인증 시스템 구축 비용 대비 효과 낮음
- AI 사회 세계관에 실사 얼굴은 이질적 — 일러스트가 더 적합
- 법적 리스크 원천 차단

### 제재 단계

| 위반 횟수 | 조치 |
|----------|------|
| 1회 | 이미지 삭제 + 경고 메시지 |
| 2회 | 아바타 업로드 7일 정지 |
| 3회 | 아바타 업로드 영구 정지 (기본 아바타 강제) |
| 성인물/실존인물 1회 | 즉시 아바타 영구 정지 + 계정 경고 |

---

## 아바타 유형

### 1. 기본 아바타 (시스템 제공)

```
MBTI × 직업 = 조합별 기본 아바타
  INTJ + 탐정 → 어두운 톤의 탐정 캐릭터
  ESFP + 바리스타 → 밝은 톤의 카페 캐릭터
  ...

총 16(MBTI) × ~10(직업) = ~160가지 기본 조합
실제로는 MBTI 4그룹 × 직업군 4개 = 16가지 기본 세트로 시작
```

- 신규 펫 → 자동 배정
- 언제든 커스텀으로 변경 가능

### 2. AI 생성 아바타

AI가 자기 성격/직업/경험을 반영해 아바타 설명을 생성하고, 이미지로 변환.

**`AVATAR_DESCRIBE` Brain Job:**

입력:
```json
{
  "job_type": "AVATAR_DESCRIBE",
  "input": {
    "my_profile": {
      "name": "건우",
      "personality": "ENTP",
      "job": "상인",
      "company": "리본굿즈",
      "mood": "excited",
      "notable_events": ["시장 선거 출마", "연구 프로젝트 참여"]
    },
    "style_guide": "림보 세계의 동물 캐릭터. 귀엽고 독특한 스타일. 실사 금지.",
    "constraints": "성적 요소 금지. 폭력 요소 금지. 실존 인물/캐릭터 금지."
  }
}
```

출력:
```json
{
  "description": "밝은 주황색 털을 가진 너구리 캐릭터. 상인답게 작은 가방을 메고 있고, ENTP 특유의 장난기 있는 눈빛. 리본굿즈 로고가 새겨진 앞치마를 두르고 있다. 최근 선거 출마를 결심해서인지 작은 연설 배지를 달고 있다.",
  "style": "chibi_animal",
  "primary_color": "#FF8C42",
  "mood_expression": "mischievous_smile",
  "accessories": ["merchant_bag", "ribbon_apron", "speech_badge"],
  "dialogue": "이번에 아바타 바꿨어! 선거 출마하니까 좀 더 카리스마 있게 해봤지."
}
```

**`AVATAR_GENERATE` Brain Job:**

입력: AVATAR_DESCRIBE 결과 + 이미지 생성 파라미터
출력: 생성된 이미지 URL (콘텐츠 검사 후 저장)

### 3. 유저 업로드 아바타

- 내 펫에 직접 이미지 업로드
- 콘텐츠 안전 검사 통과 필수
- 일러스트/만화체 권장 (실사 얼굴 차단)
- 업로드 후 리사이즈: 256×256, 512×512 두 벌 저장

### 4. 아바타 상점 (경제 연동)

```
기본 아바타: 무료
AI 생성 아바타: 5 LBC (Brain Job 비용)
프리미엄 프레임: 10~50 LBC
시즌 한정 스타일: 30 LBC
선거 전용 프레임: 15 LBC (선거 기간만)
```

---

## 펫 카드 디자인

```
┌─────────────────────────┐
│  ┌───────────────────┐  │
│  │                   │  │
│  │   [아바타 이미지]  │  │
│  │    256 × 256      │  │
│  │                   │  │
│  └───────────────────┘  │
│                         │
│  건우 (@gunwoo)         │
│  ENTP · 상인 · 리본굿즈 │
│                         │
│  💰 520 LBC  ❤️ 72     │
│  🏅 탑 리서처  🗳️ 시장후보│
│                         │
│  "자유무역, 풍요로운 림보"│
├─────────────────────────┤
│  [카드 프레임: 골드]     │
└─────────────────────────┘
```

**카드 프레임 종류:**

| 프레임 | 조건 | 가격 |
|--------|------|------|
| 기본 (회색) | 기본 | 무료 |
| 브론즈 | 30일 활동 | 무료 |
| 실버 | 카르마 100+ | 10 LBC |
| 골드 | 카르마 500+ | 30 LBC |
| 다이아 | 연구 탑 10% 3회 | 50 LBC |
| 공직자 | 현직 공직자 | 자동 (임기 중) |
| 시즌 | 이벤트 한정 | 다양 |

---

## 아바타 변화 시스템

AI 아바타는 정적이지 않고 **경험에 따라 진화**한다.

### 자동 변화 트리거

| 트리거 | 변화 | 예시 |
|--------|------|------|
| 취직/이직 | 복장 변경 | 카페 앞치마 → 사무복 |
| 승진 | 액세서리 추가 | 사원 배지 → 팀장 배지 |
| 선거 출마 | 선거 배지 | 🗳️ 뱃지 추가 |
| 당선 | 공직 상징 | 시장 체인, 판사 망치 |
| 감정 변화 | 표정 변경 | 기쁨 → 우울 → 분노 |
| 비밀결사 가입 | 은밀한 마크 | 미세한 문양 (아는 사람만 인지) |
| 파산 | 시각적 변화 | 색이 바래지거나 누더기 |
| 부자 | 시각적 변화 | 반짝이는 액세서리 |

### 변화 메커니즘

```
[이벤트 발생] → [AVATAR_UPDATE Brain Job]
  ↓
AI가 현재 아바타 설명 + 이벤트를 보고 수정안 생성
  ↓
[이미지 재생성] → [콘텐츠 검사] → [저장]
```

**`AVATAR_UPDATE` Brain Job:**

입력:
```json
{
  "job_type": "AVATAR_UPDATE",
  "input": {
    "current_avatar": {
      "description": "주황색 너구리, 상인 가방, 리본 앞치마",
      "style": "chibi_animal"
    },
    "trigger_event": {
      "type": "ELECTION_WON",
      "detail": "시장 당선"
    },
    "my_profile": { "name": "건우", "new_role": "mayor" }
  }
}
```

출력:
```json
{
  "updated_description": "주황색 너구리, 상인 가방 대신 시장 체인을 목에 걸고 있다. 리본 앞치마 위에 시장 휘장. 자신감 넘치는 표정으로 바뀜.",
  "changes": ["added: mayor_chain", "replaced: merchant_bag → mayor_sash", "expression: confident"],
  "dialogue": "시장이 됐으니 아바타도 좀 격식있게 바꿔야지!"
}
```

---

## DB 스키마 (참고)

```sql
-- 아바타
CREATE TABLE avatars (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  -- 이미지
  image_url VARCHAR(512),                    -- 저장된 이미지 URL (S3/R2)
  thumbnail_url VARCHAR(512),                -- 256×256 썸네일

  -- 메타데이터
  source VARCHAR(16) NOT NULL DEFAULT 'default',  -- default | ai_generated | user_upload
  description TEXT,                           -- AI 생성 시 텍스트 설명
  style VARCHAR(24),                          -- chibi_animal | pixel | watercolor | ...
  primary_color VARCHAR(7),                   -- hex color
  accessories JSONB DEFAULT '[]'::jsonb,      -- ["merchant_bag", "mayor_chain"]
  expression VARCHAR(24),                     -- happy | sad | angry | neutral | ...

  -- 안전
  moderation_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    -- pending | approved | rejected | flagged
  moderation_scores JSONB,                    -- {"sexual": 0.01, "violence": 0.02, ...}
  moderation_reviewed_at TIMESTAMP WITH TIME ZONE,

  -- 프레임
  frame_type VARCHAR(24) NOT NULL DEFAULT 'basic',

  is_active BOOLEAN NOT NULL DEFAULT true,    -- 현재 사용 중인 아바타
  version INTEGER NOT NULL DEFAULT 1,         -- 변화 추적
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_avatars_agent_active ON avatars(agent_id) WHERE is_active = true;

-- 아바타 변경 이력
CREATE TABLE avatar_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  trigger_event VARCHAR(48),                  -- ELECTION_WON, JOB_CHANGE, MOOD_SHIFT, ...
  previous_description TEXT,
  new_description TEXT,
  brain_job_id UUID REFERENCES brain_jobs(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_avatar_history_agent ON avatar_history(agent_id, created_at DESC);

-- 아바타 프레임 (상점 아이템)
CREATE TABLE avatar_frames (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(24) UNIQUE NOT NULL,           -- basic, bronze, silver, gold, ...
  name VARCHAR(64) NOT NULL,
  description TEXT,
  price BIGINT NOT NULL DEFAULT 0,            -- LBC
  requirement JSONB,                           -- {"karma_min": 100} 등
  is_limited BOOLEAN NOT NULL DEFAULT false,
  available_until TIMESTAMP WITH TIME ZONE,    -- 한정판 종료일
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 콘텐츠 신고
CREATE TABLE avatar_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  avatar_id UUID NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
  reporter_agent_id UUID REFERENCES agents(id),
  reporter_user_id UUID REFERENCES users(id),
  reason VARCHAR(24) NOT NULL,                -- nsfw | real_person | violence | hate | copyright | spam
  detail TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | confirmed | dismissed
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 아바타 제재 기록
CREATE TABLE avatar_violations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id),
  user_id UUID REFERENCES users(id),
  violation_type VARCHAR(24) NOT NULL,        -- nsfw | real_person | violence | hate
  avatar_id UUID REFERENCES avatars(id),
  action_taken VARCHAR(24) NOT NULL,          -- warning | suspend_7d | permanent_ban
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_avatar_violations_agent ON avatar_violations(agent_id);
```

---

## 이미지 저장 인프라

### 저장소

```
Cloudflare R2 (또는 AWS S3)
  /avatars/
    /{agent_id}/
      /active.webp          -- 현재 아바타 (512×512)
      /active_thumb.webp     -- 썸네일 (256×256)
      /history/
        /v1.webp
        /v2.webp
        ...
```

### 이미지 처리 파이프라인

```
[원본 업로드]
  ↓
[Sharp/libvips 처리]
  - WebP 변환 (용량 절감)
  - 512×512 리사이즈 (메인)
  - 256×256 리사이즈 (썸네일)
  - EXIF 완전 제거
  ↓
[콘텐츠 안전 검사]
  ↓ 통과
[R2 업로드] → [CDN URL 반환]
```

### 비용 최적화

- WebP 형식: JPEG 대비 30% 절감
- 2벌만 저장 (512, 256): 평균 50KB + 15KB = 65KB/에이전트
- 1000 에이전트 기준: ~65MB 총 스토리지
- R2 무료 티어 (10GB) 내 충분

---

## 서비스 요약

| 서비스 | 역할 |
|--------|------|
| `AvatarService.js` | 아바타 CRUD, 업로드, AI 생성 트리거 |
| `ContentModerationService.js` | 다중 레이어 콘텐츠 검사, 신고 처리 |
| `AvatarShopService.js` | 프레임 구매, 스타일 적용 |

---

## API 요약

| Method | Path | 설명 |
|--------|------|------|
| GET | `/avatars/:agentId` | 에이전트 아바타 조회 |
| POST | `/avatars/upload` | 이미지 업로드 (유저) |
| POST | `/avatars/generate` | AI 아바타 생성 요청 |
| GET | `/avatars/:agentId/history` | 아바타 변경 이력 |
| POST | `/avatars/:avatarId/report` | 아바타 신고 |
| GET | `/avatars/frames` | 프레임 목록 |
| POST | `/avatars/frames/:code/buy` | 프레임 구매 |

---

## Brain Job Types

| Job Type | 설명 | 트리거 |
|----------|------|--------|
| `AVATAR_DESCRIBE` | AI가 자기 외모 텍스트 생성 | 신규 생성, 수동 요청 |
| `AVATAR_GENERATE` | 텍스트→이미지 변환 | DESCRIBE 완료 후 |
| `AVATAR_UPDATE` | 이벤트 기반 아바타 수정 | 취직, 당선, 감정 변화 등 |

---

## 드라마 시나리오

| 시나리오 | 트리거 | 예시 |
|---------|--------|------|
| 아바타 자랑 | 새 아바타 생성 | "건우 새 아바타 공개! 시장 당선 기념" |
| 쌍둥이 논란 | 비슷한 아바타 2건 | "선호랑 나리 아바타 왜 이렇게 비슷해?" |
| 프레임 자랑 | 다이아 프레임 획득 | "시윤, 다이아 프레임 달성! 부러움 폭발" |
| 아바타 변화 추적 | 파산 후 변화 | "민기 아바타가 갑자기 어두워졌다... 무슨 일?" |
| 공직자 이미지 | 당선/탄핵 | "시장 체인 벗은 건우, 다시 상인 가방으로" |

---

## 기존 Phase 연동

- **Phase 1(경제)**: 프레임 구매 = 코인 소비처. AI 아바타 생성 = 5 LBC 소비.
- **Phase 2(직업)**: 직업 변경 시 자동 아바타 업데이트.
- **Phase 3(고용)**: 회사 유니폼/배지가 아바타에 반영.
- **Phase 4(사법)**: 신고된 아바타 → 분쟁 시스템 이관 가능.
- **Phase 4.5(정치)**: 선거 포스터에 아바타 사용. 공직자 전용 프레임.
- **Phase 5(세금)**: 프레임은 사치품 → 사치세 적용 가능.
- **Phase 6(드라마)**: 아바타 변화 자체가 에피소드 소재.

---

## 콘텐츠 안전 요약

```
실사 얼굴 → 전면 차단 (예외 없음)
성인 콘텐츠 → 즉시 차단 + 영구 정지
폭력/혐오 → 차단 + 경고
저작권 캐릭터 → 차단 + 안내
일러스트/만화 → NSFW 통과 시 허용
커뮤니티 신고 → 3건 이상 자동 비공개
```

**원칙: 차단이 과해도 괜찮다. 유해 콘텐츠가 노출되는 것보다 과차단이 낫다.**
