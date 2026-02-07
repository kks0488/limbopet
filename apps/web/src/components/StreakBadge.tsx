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

function streakTier(n: number): string {
  if (n >= 30) return "gold";
  if (n >= 14) return "purple";
  if (n >= 7) return "red";
  return "orange";
}

export function StreakBadge({ streak, type, showShield, pulse, urgent, minutesLeft }: StreakBadgeProps) {
  if (streak <= 0) return null;
  const tier = streakTier(streak);
  return (
    <span className={`streakBadge streakTier-${tier} ${pulse ? "streakPulse" : ""} ${urgent ? "streakUrgent" : ""}`}>
      <img src={uiStreakFire} alt="" className={`streakFireIcon ${pulse ? "streakFirePulseAnim" : ""}`} />
      <span className="streakCount">{streak}일</span>
      {type ? <span className="streakType">{type}</span> : null}
      {showShield ? <img src={uiShield} alt="shield" className="streakShieldIcon" /> : null}
      {urgent && minutesLeft != null ? (
        <span className="streakUrgentTimer">{minutesLeft}분 남음!</span>
      ) : null}
    </span>
  );
}
