# BUG FIX 3건 — 뾰족하게

## Bug 1: 채팅창 2개

**원인**: App.tsx에서 채팅 UI가 2곳에서 렌더링됨
- Line ~2942: `chatOpen && brainProfile` → inline 채팅 (항상)
- Line ~3122: `SHOW_ADVANCED` → debug 채팅 (debug 모드)
- `SHOW_ADVANCED=true`일 때 둘 다 보임

**수정**: Line ~2942의 조건에 `&& !SHOW_ADVANCED` 추가
```tsx
{chatOpen && brainProfile && !SHOW_ADVANCED ? (
```

---

## Bug 2: 메시지 보내면 피드백 없음 + 새로고침해야 함

**원인**: `onSendChat()` → `onAction("talk")` → `setBusy(true)` → UI 15초간 잠김
- `onAction`이 busy 플래그로 전체 UI 잠금
- 폴링 루프 (1.2s, 2.5s, 4.5s, 7s) 동안 아무 피드백 없음
- Brain worker가 느리면 응답 영영 안 보임

**수정**: `onSendChat`에서 `onAction` 우회, 직접 처리
```tsx
async function onSendChat() {
  if (!userToken) return;
  const msg = chatText.trim();
  if (!msg) return;
  if (msg.length > 400) { setToast({kind:"bad",text:"400자 이내"}); clearToastLater(); return; }

  setChatText("");
  setChatSending(true);

  // 1) 유저 메시지 즉시 표시 (optimistic)
  const optimistic = { event_type:"DIALOGUE", created_at:new Date().toISOString(), payload:{user_message:msg, dialogue:{lines:[]}} };
  setEvents(prev => [optimistic, ...(prev||[])]);

  try {
    // 2) API 호출 (busy 안 걸음)
    await petAction(userToken, "talk", { message: msg });

    // 3) 백그라운드 폴링 — UI 잠그지 않음
    for (const ms of [1200, 2500, 4500, 7000, 10000]) {
      await new Promise(r => setTimeout(r, ms));
      await refreshAll(userToken);
    }
  } catch (e: any) {
    setToast({ kind:"bad", text: e?.message ?? String(e) });
    clearToastLater();
  } finally {
    setChatSending(false);
  }
}
```

핵심: `onAction` 안 태움 → `busy` 안 걸림 → UI 잠기지 않음 → typing indicator 잘 보임

---

## Bug 3: "AI 서비스 인증 URL 생성 실패 (remote management disabled)"

**원인**: CLIProxy 서버의 remote management가 비활성화됨 (인프라 설정 문제)
- `/v0/management/{provider}-auth-url` 호출 시 proxy가 "remote management disabled" 반환
- 코드 버그 아님, proxy 서버 설정 문제

**수정**: 2가지
1. **UI 에러 메시지 개선** — AiConnectPanel에서 이 에러 시 "AI 프록시 서버가 연결되지 않았습니다. BYOK(직접 키 입력)를 사용하세요." 안내
2. **proxy 서버 설정** — CLIProxy에 `REMOTE_MANAGEMENT_ENABLED=true` 설정 (또는 proxy 서버 기동)

---

## 실행 배분

### claude-ui 세션 (App.tsx 수정)
- Bug 1: 조건문 1줄 수정
- Bug 2: onSendChat 함수 교체
- 빌드 검증: `npx tsc --noEmit && npx vite build`

### 기타
- Bug 3: proxy 서버 설정은 별도 (코드 수정 불필요하면 에러 메시지만 개선)

---

## 금지
- 새 파일 만들지 않음
- styles.css 건드리지 않음
- 동결 기능 건드리지 않음
