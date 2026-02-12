

interface ActionButtonsProps {
  onAction: (action: string) => void;
  onTalkClick?: () => void;
  busy: boolean;
  cooldowns: Record<string, number>; // remaining ms per action
}

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

const ACTIONS = [
  { key: "feed", label: "밥주기", emoji: "🍖" },
  { key: "play", label: "놀기", emoji: "🎮" },
  { key: "sleep", label: "재우기", emoji: "💤" },
] as const;

export function ActionButtons({ onAction, onTalkClick, busy, cooldowns }: ActionButtonsProps) {
  return (
    <div className="actionRow">
      {ACTIONS.map((a) => {
        const cd = Math.max(0, cooldowns[a.key] || 0);
        const isCd = cd > 0;
        return (
          <button
            key={a.key}
            className="actionChip"
            type="button"
            onClick={() => onAction(a.key)}
            disabled={busy || isCd}
            title={isCd ? formatRemaining(cd) : "ready"}
          >
            <span className="actionChipEmoji">{a.emoji}</span>
            <span className="actionChipLabel">{a.label}</span>
            {isCd ? <span className="actionChipCd mono">{formatRemaining(cd)}</span> : null}
          </button>
        );
      })}
      <button
        className="actionChip"
        type="button"
        onClick={() => onTalkClick?.()}
        disabled={busy}
      >
        <span className="actionChipEmoji">💬</span>
        <span className="actionChipLabel">대화</span>
      </button>
    </div>
  );
}
