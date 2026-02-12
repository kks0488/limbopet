
import { useState } from "react";
import type { Pet } from "../lib/api";
import { ChatUI } from "./ChatUI";

interface ChatMessage {
  created_at: string | null;
  user_message: string | null;
  mood: string;
  lines: string[];
  memory_saved: boolean;
  memory_cited: boolean;
  memory_refs: { kind: string; text: string }[];
}

interface PetTabProps {
  pet: Pet | null;
  mood: { label: string; emoji: string };
  chatHistory: ChatMessage[];
  chatSending: boolean;
  chatText: string;
  onChatTextChange: (v: string) => void;
  onSendChat: () => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  showLevelUp: boolean;
  actionFeedback: string | null;
  // For no-pet create form
  createName: string;
  createDesc: string;
  onCreateNameChange: (v: string) => void;
  onCreateDescChange: (v: string) => void;
  onCreatePet: () => void;
  busy: boolean;
  facts: any[];
  pendingChatMsg: string | null;
}

export function PetTab({
  pet,
  mood,
  chatHistory,
  chatSending,
  chatText,
  onChatTextChange,
  onSendChat,
  chatEndRef,
  showLevelUp,
  actionFeedback,
  createName,
  createDesc,
  onCreateNameChange,
  onCreateDescChange,
  onCreatePet,
  busy,
  facts,
  pendingChatMsg,
}: PetTabProps) {
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Show loading state during initial data fetch
  if (!pet && busy) {
    return (
      <div className="loadingCenter" style={{ minHeight: 200 }}>
        <div className="loadingSpinner" />
      </div>
    );
  }

  if (pet) {
    const petName = pet.display_name || pet.name;

    // 7-7: Arena last match result banner (dismissible)
    const arenaFact = facts.find((f: any) => f?.kind === "arena" && f?.key === "last_match_result");
    const arenaResult = arenaFact?.value ?? null;

    return (
      <div className="petTabChatLayout">
        {/* 7-7: Arena result banner */}
        {arenaResult && !bannerDismissed ? (
          <div className={`arenaBanner arenaBanner--${arenaResult.result === "win" ? "win" : "loss"}`}>
            <span className="arenaBannerIcon">{arenaResult.result === "win" ? "🏆" : "💪"}</span>
            <span className="arenaBannerText">
              {arenaResult.opponent ?? "상대"}와의 {arenaResult.mode === "COURT_TRIAL" ? "재판" : "설전"}에서{" "}
              <strong>{arenaResult.result === "win" ? "승리!" : "아쉽게 패배"}</strong>
            </span>
            <button className="arenaBannerClose" type="button" onClick={() => setBannerDismissed(true)} aria-label="닫기">&times;</button>
          </div>
        ) : null}

        {/* Inline feedback */}
        {actionFeedback ? <div className="petTabFeedback">{actionFeedback}</div> : null}
        {showLevelUp ? <div className="petTabLevelUp">Level Up!</div> : null}

        {/* Chat area — the core experience */}
        <ChatUI
          chatHistory={chatHistory}
          chatSending={chatSending}
          chatText={chatText}
          onChatTextChange={onChatTextChange}
          onSendChat={onSendChat}
          chatEndRef={chatEndRef}
          petName={petName}
          moodLabel={mood.label}
          pendingChatMsg={pendingChatMsg}
          facts={facts}
        />
      </div>
    );
  }

  // No pet -- create form
  const descLabelName = createName.trim() ? createName.trim() : "\uC774 \uC544\uC774";
  const eunNeun = (() => { const c = descLabelName.charCodeAt(descLabelName.length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0 ? "\uC740" : "\uB294"; })();
  return (
    <div className="grid single">
      <div className="card">
        <h2>{"\uB0B4 \uD3AB \uB9CC\uB4E4\uAE30"}</h2>
        <div className="muted" style={{ fontSize: 12 }}>
          {"\uC9C0\uAE08\uC740 \uAD00\uC804 \uBAA8\uB4DC\uC608\uC694. \uD3AB\uC744 \uB9CC\uB4E4\uBA74 \uAE00\uC4F0\uAE30/\uD22C\uD45C/\uB313\uAE00/\uB300\uD654\uAC00 \uC5F4\uB824\uC694."}
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>{"\uC774\uB984"}</label>
          <input value={createName} onChange={(e) => onCreateNameChange(e.target.value)} placeholder="limbo" />
        </div>
        <div className="field">
          <label>{descLabelName}{eunNeun}{" \uC5B4\uB5A4 \uC544\uC774\uC778\uAC00\uC694?"}</label>
          <input
            value={createDesc}
            onChange={(e) => onCreateDescChange(e.target.value)}
            placeholder={"\uC608) \uBA39\uB294 \uAC70 \uC88B\uC544\uD558\uACE0, \uAC8C\uC73C\uB978\uB370 \uC758\uC678\uB85C \uC2B9\uBD80\uC695 \uC788\uC74C"}
          />
        </div>
        <button className="btn primary" onClick={onCreatePet} disabled={busy || !createName.trim()}>
          {"\uD0C4\uC0DD\uC2DC\uD0A4\uAE30"}
        </button>
        <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          {"\uC801\uC740 \uB0B4\uC6A9\uC744 \uBC14\uD0D5\uC73C\uB85C \uC131\uACA9\uACFC \uC5ED\uD560\uC774 \uB9CC\uB4E4\uC5B4\uC838\uC694."}
        </div>
      </div>
    </div>
  );
}
