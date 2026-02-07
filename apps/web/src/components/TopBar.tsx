import React from "react";
import { StreakBadge } from "./StreakBadge";

interface TopBarProps {
  /** "모코 Lv.5" style compact title */
  title: string;
  /** kept for onboarding screens that still use subtitle */
  subtitle?: string;
  streak?: number | null;
  streakPulse?: boolean;
  streakUrgent?: boolean;
  streakMinutesLeft?: number;
  /** @deprecated ticker removed from main game UI */
  ticker?: React.ReactNode;
  right: React.ReactNode;
}

export function TopBar({ title, subtitle, streak, streakPulse, streakUrgent, streakMinutesLeft, ticker, right }: TopBarProps) {
  return (
    <div className="topbar">
      {ticker ?? null}
      <div className="topbarMain">
        <div className="brand">
          <div>
            <h1>{title}</h1>
            {subtitle ? (
              <div className="topbarSubline">
                <div className="muted" style={{ fontSize: 12 }}>{subtitle}</div>
              </div>
            ) : null}
          </div>
          {Number(streak ?? 0) > 0 ? (
            <StreakBadge streak={Number(streak ?? 0)} pulse={streakPulse} urgent={streakUrgent} minutesLeft={streakMinutesLeft} />
          ) : null}
        </div>
        <div className="row">{right}</div>
      </div>
    </div>
  );
}
