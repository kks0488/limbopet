import React from "react";
import { petMoodMap } from "../assets/index";

interface MoodIndicatorProps {
  mood: string; // "bright" | "okay" | "low" | "gloomy"
  size?: number;
  className?: string;
  animClass?: string; // e.g. "petEatAnim" for feed action
}

export function MoodIndicator({ mood, size = 120, className = "", animClass = "" }: MoodIndicatorProps) {
  const src = petMoodMap[mood] || petMoodMap["okay"];
  return (
    <div className={`moodIndicator ${className} ${animClass}`} style={{ width: size, height: size }}>
      <img
        src={src}
        alt={`Pet mood: ${mood}`}
        className="moodPetImg"
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </div>
  );
}
