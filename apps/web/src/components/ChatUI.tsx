import { useEffect, useMemo, useState } from "react";

const KIND_KO: Record<string, string> = {
  preference: "취향",
  forbidden: "금기",
  suggestion: "제안",
  coaching: "코칭",
  arena: "재판",
  profile: "성격",
};

const CHAT_HINTS = [
  "오늘 기분 어때?",
  "나 요즘 치킨이 먹고 싶어",
  "너는 뭘 좋아해?",
];

const HIDDEN_REF_KINDS = new Set(["direction", "streak", "world"]);

interface MemoryRef {
  kind: string;
  text: string;
}

interface ChatMessage {
  created_at: string | null;
  user_message: string | null;
  mood: string;
  lines: string[];
  memory_saved: boolean;
  memory_cited: boolean;
  memory_refs: MemoryRef[];
}

interface ChatUIProps {
  chatHistory: ChatMessage[];
  chatSending: boolean;
  chatText: string;
  onChatTextChange: (v: string) => void;
  onSendChat: () => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  petName: string;
  moodLabel: string;
  pendingChatMsg?: string | null;
  facts?: any[];
}

export function ChatUI({
  chatHistory,
  chatSending,
  chatText,
  onChatTextChange,
  onSendChat,
  chatEndRef,
  petName,
  moodLabel,
  pendingChatMsg,
  facts,
}: ChatUIProps) {
  const [sendElapsed, setSendElapsed] = useState(0);

  useEffect(() => {
    if (!chatSending) { setSendElapsed(0); return; }
    const start = Date.now();
    const id = window.setInterval(() => setSendElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [chatSending]);

  const typingLabel = sendElapsed < 2 ? "\uC0DD\uAC01 \uC911..." : sendElapsed < 5 ? "\uB2F5\uBCC0 \uC791\uC131 \uC911..." : "\uC870\uAE08\uB9CC \uAE30\uB2E4\uB824\uC918...";
  const reversed = useMemo(() => chatHistory.map((c, origIdx) => ({ c, origIdx })).reverse(), [chatHistory]);

  /* Only the latest (most recent) pet reply shows memory citation */
  const latestPetIdx = useMemo(() => {
    for (let i = 0; i < chatHistory.length; i++) {
      if (chatHistory[i].lines.length > 0) return i;
    }
    return -1;
  }, [chatHistory]);

  return (
    <div className="petChatFull">
      <div className="petChatMessages">
        {chatHistory.length === 0 && !chatSending ? (
          <div className="petChatBubbleGroup chatBubbleNew">
            <div className="petChatRow petChatRowPet">
              <div className="petChatBubble petChatPet">
                <GreetingMessage petName={petName} facts={facts} />
              </div>
            </div>
          </div>
        ) : null}
        {chatHistory.length < 5 && !chatSending ? (
          <div className="chatHints">
            {CHAT_HINTS.map((hint) => (
              <button key={hint} className="chatHintBtn" type="button" onClick={() => onChatTextChange(hint)}>
                {hint}
              </button>
            ))}
          </div>
        ) : null}
        {reversed.map(({ c, origIdx }, idx) => {
          const isLatest = origIdx === latestPetIdx;
          const visibleRefs = c.memory_refs.filter(r => !HIDDEN_REF_KINDS.has(r.kind));
          const showMemory = isLatest && c.memory_cited && visibleRefs.length > 0;

          return (
            <div key={`chat-${origIdx}`} className={`petChatBubbleGroup${idx === reversed.length - 1 && c.lines.length > 0 ? " chatBubbleNew" : ""}`}>
              {c.user_message ? (
                <div className="petChatRow petChatRowUser">
                  <div className="petChatBubble petChatUser">{c.user_message}</div>
                </div>
              ) : null}
              {c.lines.length > 0 ? (
                <div className="petChatRow petChatRowPet">
                  <div className={`petChatBubble petChatPet mood-${c.mood || moodLabel}`}>
                    {c.lines.map((line, i) => (
                      <div key={`${i}-${line}`}>{line}</div>
                    ))}
                    {showMemory ? (
                      <div className="memoryCardGroup">
                        {visibleRefs.slice(0, 3).map((ref, ri) => (
                          <div key={ri} className="memoryCard">
                            <span className="memoryCardIcon">✦</span>
                            {ref.kind ? <span className="memoryCardKind">{KIND_KO[ref.kind] ?? ref.kind}</span> : null}
                            <span className="memoryCardText">{ref.text}</span>
                          </div>
                        ))}
                        {visibleRefs.length > 3 ? (
                          <div className="memoryCardMore">+{visibleRefs.length - 3}건 더</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {pendingChatMsg ? (
          <div className="petChatBubbleGroup">
            <div className="petChatRow petChatRowUser">
              <div className="petChatBubble petChatUser">{pendingChatMsg}</div>
            </div>
          </div>
        ) : null}
        {chatSending ? (
          <div className="petChatBubbleGroup chatBubbleNew">
            <div className="petChatRow petChatRowPet">
              <div className="petChatBubble petChatPet chatSkeletonBubble">
                <div className="chatSkeletonLines">
                  <div className="skeletonLine skeletonWide" />
                  <div className="skeletonLine skeletonMedium" />
                  {sendElapsed >= 3 ? <div className="skeletonLine skeletonShort" /> : null}
                </div>
                <div className="chatSkeletonLabel">{typingLabel}</div>
                {sendElapsed >= 5 ? (
                  <div className="chatSkeletonExtra">AI가 열심히 생각 중이에요...</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        <div ref={chatEndRef} />
      </div>
      <div className="petChatInputBar">
        <input
          className="petChatInput"
          value={chatText}
          onChange={(e) => onChatTextChange(e.target.value)}
          placeholder={`${petName}\uC5D0\uAC8C \uB9D0 \uAC78\uAE30...`}
          aria-label={`${petName}\uC5D0\uAC8C \uB9D0 \uAC78\uAE30`}
          disabled={chatSending}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.repeat && !chatSending) { e.preventDefault(); void onSendChat(); } }}
          autoFocus
        />
        <button
          className="btn primary petChatSendBtn"
          type="button"
          onClick={onSendChat}
          disabled={chatSending || !chatText.trim()}
        >
          {chatSending ? "..." : "\uBCF4\uB0B4\uAE30"}
        </button>
      </div>
    </div>
  );
}

function GreetingMessage({ petName, facts }: { petName: string; facts?: any[] }) {
  const [msg] = useState(() => {
    // 7-4: facts 기반 인사 (preference/coaching에서 최근 기억 활용)
    if (facts && facts.length > 0) {
      const prefs = facts.filter((f: any) => f?.kind === "preference");
      const coaching = facts.filter((f: any) => f?.kind === "coaching");
      const profile = facts.find((f: any) => f?.kind === "profile" && f?.key === "personality_observation");

      // preference fact가 있으면 기억 기반 인사
      if (prefs.length > 0) {
        const pref = prefs[Math.floor(Math.random() * prefs.length)];
        const prefText = typeof pref.value === "string" ? pref.value : pref.value?.text ?? pref.key ?? "";
        const templates = [
          `${prefText} 좋아한다며! 오늘도 그랬어?`,
          `어 왔어! ${prefText} 얘기 또 해줘~`,
          `반가워! 나 ${prefText} 생각하고 있었어!`,
        ];
        return templates[Math.floor(Math.random() * templates.length)];
      }

      // coaching fact가 있으면 코칭 기반 인사
      if (coaching.length > 0) {
        return "어 왔구나! 오늘도 같이 이야기하자!";
      }

      // personality_observation이 있으면 성격 기반 인사
      if (profile) {
        return `안녕! ${petName}이(가) 요즘 많이 성장했어!`;
      }
    }

    // 폴백: 시간대별 하드코딩 인사
    const hour = new Date().getHours();
    const greetings =
      hour < 6
        ? ["이 시간에 왔어?! 나 자고 있었는데... 괜찮아 반가워!", `${petName}은(는) 밤이 좋아... 같이 있자!`]
        : hour < 12
          ? ["좋은 아침! 오늘 하루도 파이팅이야!", `아~ 일어났구나! ${petName}도 방금 일어났어!`]
          : hour < 18
            ? ["안녕! 오늘 뭐 하고 있었어?", "배고프다... 아 안녕! 반가워!"]
            : ["저녁이네~ 오늘 하루 어땠어?", `밤이다! ${petName}은(는) 밤에 더 활발해져!`];
    return greetings[Math.floor(Math.random() * greetings.length)];
  });
  return <>{msg}</>;
}
