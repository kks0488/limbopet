import React from "react";
import { actionIconMap } from "../assets/index";

interface ActionButtonsProps {
  onAction: (action: string) => void;
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
  { key: "feed", label: "먹이", primary: true },
  { key: "play", label: "놀기", primary: false },
  { key: "sleep", label: "재우기", primary: false },
  { key: "talk", label: "대화", primary: false },
] as const;

export function ActionButtons({ onAction, busy, cooldowns }: ActionButtonsProps) {
  return (
    <div className="actionGrid">
      {ACTIONS.map((a) => {
        const cd = Math.max(0, cooldowns[a.key] || 0);
        const isCd = cd > 0;
        const icon = actionIconMap[a.key];
        return (
          <button
            key={a.key}
            className={`actionBtn actionBtnCircle ${a.primary ? "primary" : ""}`}
            type="button"
            onClick={() => onAction(a.key)}
            disabled={busy || isCd}
          >
            <div className="actionIconWrap">
              {icon ? (
                <img src={icon} alt="" className="actionSvgIcon" />
              ) : (
                <div className="actionIcon">
                  {a.key === "feed" ? "🍖" : a.key === "play" ? "✨" : a.key === "sleep" ? "🛏️" : "💬"}
                </div>
              )}
            </div>
            <div className="actionLabel">{a.label}</div>
            <div className="actionMeta mono">{isCd ? formatRemaining(cd) : "ready"}</div>
          </button>
        );
      })}
    </div>
  );
}
