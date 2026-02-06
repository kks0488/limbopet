import React from "react";
import { uiStreakFire, uiShield } from "../assets/index";

interface StreakBadgeProps {
  streak: number;
  type?: string;
  showShield?: boolean;
  pulse?: boolean;
  urgent?: boolean;
  minutesLeft?: number;
}

export function StreakBadge({ streak, type, showShield, pulse, urgent, minutesLeft }: StreakBadgeProps) {
  if (streak <= 0) return null;
  return (
    <span className={`streakBadge ${pulse ? "streakPulse" : ""} ${urgent ? "streakUrgent" : ""}`}>
      <img src={uiStreakFire} alt="" className={`streakFireIcon ${pulse ? "streakFirePulseAnim" : ""}`} />
      <span className="streakCount">{streak}</span>
      {type ? <span className="streakType">{type}</span> : null}
      {showShield ? <img src={uiShield} alt="shield" className="streakShieldIcon" /> : null}
      {urgent && minutesLeft != null ? (
        <span className="streakUrgentTimer">{minutesLeft}분 남음!</span>
      ) : null}
    </span>
  );
}
