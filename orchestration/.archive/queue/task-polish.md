# UI 뾰족하게 — 군더더기 빼고 액기스만

## 현황 진단
- 다크→라이트 기계적 변환 완료, 하지만 **밋밋함**
- 화이트 카드 on 화이트 배경 = 계층감 없음
- 불필요한 UI 요소 여전히 남아있음
- 애니메이션/이펙트 과다

---

## Phase 1: 제거 (빼기)

### App.tsx에서 제거할 것
| 요소 | 이유 |
|------|------|
| `worldTicker` | 게임 느낌, 핵심 아님. state + JSX + CSS 전부 삭제 |
| `missionBonus` overlay | 오버레이 노이즈. state + JSX + CSS 삭제 |
| `urgentBanner` | streak 관련 동결 기능. JSX + CSS 삭제 |
| `SHOW_ADVANCED` debug 패널 전체 | 일반 유저에게 불필요. debug 모드 코드 블록 삭제 |

### styles.css에서 제거할 것
| 클래스 | 줄 수 (대략) |
|--------|------------|
| `.worldTicker*` 전체 | ~60줄 |
| `.missionBonusFx*` | ~30줄 |
| `.urgentBanner/Pill/Timer/Actions` | ~60줄 |
| `.streakFirePulseAnim`, `.streakPulse` | ~5줄 (이전에 빠진 잔여) |
| `.broadcast*` | ~25줄 (사용 확인 후) |
| 불필요한 @keyframes (bellShake 제외) | 확인 후 |

---

## Phase 2: 카드 계층감 살리기 (CSS)

현재: 흰 카드 + 흰 배경 = 구분 안 됨

**수정:**
```css
.card {
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: #FFFFFF;
  border-radius: 16px;
  padding: var(--spacing-md);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  transition: box-shadow 150ms ease;
}
.card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
```

**tabbar:**
```css
.tabbar {
  background: rgba(255, 255, 255, 0.98);
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.03);
}
```

**topbar:**
```css
.topbar {
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
```

---

## Phase 3: 핵심 3탭 Polish

### Pet 탭
- 펫 아바타: 그라데이션 유지하되 그림자 줄이기
- 게이지 바: 8px → 6px, 색상 더 파스텔하게
- 액션 버튼 4개: 아이콘 원형 배경 더 연하게, 테두리 제거
- 채팅 영역: 말풍선 디자인 — 유저=오른쪽 연보라, 펫=왼쪽 연회색

### Arena 탭
- 모드 선택: 카드형 → 깔끔한 세그먼트 컨트롤
- 매치 결과: 승/패 색상 대비 더 확실하게

### Feed 탭
- 포스트 카드: 여백 넉넉하게, 저자 아바타 작게
- 좋아요/댓글: 아이콘 + 숫자만, 깔끔하게

---

## Phase 4: 로그인 화면 개선
- "LIMBOPET" 타이틀 → 더 크고 bold
- "펫들이 사는 작은 세상" 서브 → 제거 또는 "나만의 AI를 대화로 키우고, 법정에서 싸운다."
- 환영 카드: 텍스트 줄이기 (3줄 → 1줄)
- dev 로그인: 더 깔끔하게

---

## Phase 5: 빌드 검증
```bash
npx tsc --noEmit && npx vite build
```

---

## 세션 배분

### claude-ui
- Phase 1: App.tsx 노이즈 제거 + styles.css 불필요 클래스 삭제
- Phase 2: 카드/탭바/탑바 CSS 정리
- Phase 3: 3탭 Polish
- Phase 4: 로그인 화면
- Phase 5: 빌드

### 나머지 세션
- 대기

## 규칙
- 새 파일 만들지 않음
- styles.css + App.tsx 2개만 수정
- 동결 기능 로직 건드리지 않음 (CSS/JSX만 삭제)
- 과도한 추가 금지 — 빼기 위주
