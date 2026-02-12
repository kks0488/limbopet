# RAZOR — 죽은 코드 전부 도려내기

## 진단
- App.tsx 4,552줄 중 ~1,800줄이 죽은 코드
- 도달 불가능한 탭 2개 (news, settings)
- 동결 기능 코드가 state/handler/JSX 모두에 잔존
- 사용하지 않는 state 변수 10개+
- 호출되지 않는 함수 5개+

## 핵심 원칙
- **살리는 것**: 펫탭(대화+기억) + 아레나탭(재판+설전) + 피드탭 + 로그인 + SettingsPanel
- **죽이는 것**: 그 외 전부

---

## Phase 1: 죽은 탭 통째 삭제 (App.tsx)

### "news" 탭 (lines ~3012-3212)
- `tab === "news"` JSX 블록 전부 삭제
- 관련 state: `world`, `worldHealth`, `worldHealthError` 삭제
- 관련 함수: `refreshParticipation()` 삭제
- `liveTicker` memo 삭제

### "settings" 탭 (lines ~3459-3721)
- `tab === "settings"` JSX 블록 전부 삭제
- Dev Simulation state 6개 삭제: `devSimSteps`, `devSimDay`, `devSimExtras`, `devSimAdvanceDays`, `devSimEpisodesPerStep`, `devSimStepDays`
- `onDevSimulate()` 삭제
- World Worker 관련 (`worldHealth`, `worldHealthError`) 삭제
- Debug JSON dump + `safePretty()` 삭제 (다른 곳 미사용 확인 후)
- `renderLimboSummary()` 함수 전체 삭제 (호출처 없음)

---

## Phase 2: 동결 기능 코드 삭제 (App.tsx)

### Elections
- API imports: `worldActiveElections`, `worldRegisterCandidate`, `worldCastVote`, `ActiveElection`
- State: `elections`, `electionsDay`
- Helper: `officeLabel()`
- Functions: `refreshElections()`, `onRefreshElections()`, `onElectionRegister()`, `onElectionVote()`

### Secret Society
- API imports: `worldDevSecretSociety`, `respondSocietyInvite`
- State: `participation` (연구소와 공유)
- Functions: `onDevSecretSociety()`, `onSocietyRespond()`
- Computed: `pSociety`, `societyId`, `societyName`, `societyPurpose`, `societyMemberCount`, `societyMyStatus`

### Research Lab
- API imports: `worldDevResearch`, `joinResearchProject`
- Functions: `onDevResearch()`, `onResearchJoin()`
- Computed: `researchId`, `researchTitle`, `researchStage`, `researchMyStatus`, `canJoinResearch`

### Streaks/Seasons
- API imports: `myStreaks`, `petStreakRecord`, `UserStreak`
- Component import: `StreakBadge`
- Asset import: `uiStreakFire`
- Constant: `STREAK_MILESTONES`
- Helper: `streakTypeLabel()`, `millisUntilLocalMidnight()`
- State: `streaks`, `streakCelebration`
- Ref: `streakSnapshotRef`
- 5개 memo/effect 블록 (streakByType, loginStreakRow, missionStreakRow 등)
- `petStreakRecord()` 호출 in onAction

---

## Phase 3: 죽은 state/코드 삭제 (App.tsx)

| 항목 | 삭제 대상 |
|------|----------|
| Absence | state `absence`, `absenceOpen` + `AbsenceModal` 컴포넌트 + fetch |
| Decisions | state `decisionModalOpen`, `decisions`, `decisionsBusy` + handlers |
| Perk | state `perkOffer` + `onChoosePerk()` |
| Missions | state `missions` (streak에만 사용) |
| Limbo | state `limbo` + `renderLimboSummary()` |
| CoinBalance | state `coinBalance` + fetch |
| Nudge | state `nudgeText` + `onAddNudge()`, `onQuickNudge()` + memo |
| Director View | state `directorView` + `broadcastWhyLines` memo + setter |
| Notification (죽은 부분) | `NotificationPanel` 컴포넌트 정의 (미렌더) + `NotificationBell` import |

---

## Phase 4: 미사용 import 정리

- `NotificationBell` (미사용)
- `StreakBadge` (미사용)
- 동결 기능 API 함수들
- `uiStreakFire` 에셋

---

## Phase 5: Stitch MCP로 3탭 참조 디자인

Stitch MCP 사용해서:
1. Pet 탭: 아바타 + 채팅 + 액션버튼 — Apple HIG 참조 디자인
2. Arena 탭: 매치 카드 + 결과 — Apple HIG 참조 디자인
3. 생성된 디자인 토큰으로 styles.css 미세 조정

---

## Phase 6: 빌드 검증
```bash
npx tsc --noEmit && npx vite build
```

---

## 세션: claude-ui
- Phase 1-4: App.tsx 대수술 (한번에)
- Phase 5: Stitch MCP 디자인 참조
- Phase 6: 빌드

## 규칙
- App.tsx + styles.css만 수정
- 새 파일 금지
- 동결 기능 **로직** 건드리지 않음 → 코드 자체를 삭제
- api.ts의 함수 export는 유지 (다른 곳에서 쓸 수 있음)
- 삭제 시 TypeScript 에러 나면 즉시 수정
