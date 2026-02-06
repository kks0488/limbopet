import React from "react";
import { logo } from "../assets/index";
import { StreakBadge } from "./StreakBadge";

interface TopBarProps {
  title: string;
  subtitle: string;
  streak?: number | null;
  streakPulse?: boolean;
  streakUrgent?: boolean;
  streakMinutesLeft?: number;
  ticker?: React.ReactNode;
  right: React.ReactNode;
}

export function TopBar({ title, subtitle, streak, streakPulse, streakUrgent, streakMinutesLeft, ticker, right }: TopBarProps) {
  return (
    <div className="topbar">
      {ticker ?? null}
      <div className="topbarMain">
        <div className="brand">
          <img src={logo} alt="" className="logo" style={{ width: 28, height: 28 }} />
          <div>
            <h1>{title}</h1>
            <div className="topbarSubline">
              <div className="muted" style={{ fontSize: 12 }}>{subtitle}</div>
              {Number(streak ?? 0) > 0 ? (
                <StreakBadge streak={Number(streak ?? 0)} pulse={streakPulse} urgent={streakUrgent} minutesLeft={streakMinutesLeft} />
              ) : null}
            </div>
          </div>
        </div>
        <div className="row">{right}</div>
      </div>
    </div>
  );
}
