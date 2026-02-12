
import { PixelPet } from "./PixelPet";

interface MoodIndicatorProps {
  mood: string; // "bright" | "okay" | "low" | "gloomy"
  size?: number;
  className?: string;
  animClass?: string; // e.g. "petEatAnim" for feed action
}

export function MoodIndicator({ mood, size = 120, className = "", animClass = "" }: MoodIndicatorProps) {
  return (
    <div className={`moodIndicator ${className} ${animClass}`} style={{ width: size, height: size }}>
      <PixelPet mood={mood} size={size} animClass={animClass} />
    </div>
  );
}
