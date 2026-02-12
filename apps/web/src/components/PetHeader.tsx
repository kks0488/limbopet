import { useRef, useState } from "react";
import type { Pet, PetStats, PetProgression } from "../lib/api";
import { PixelPet } from "./PixelPet";

const MOOD_KR: Record<string, string> = {
  bright: "기분좋음",
  okay: "보통",
  low: "기분다운",
  gloomy: "우울",
};

const PET_TAP_LINES = ["냥?", "왜~?", "뭐!", "헤헤", "찡긋", "누구!"];

interface PetHeaderProps {
  pet: Pet;
  stats: PetStats | null;
  mood: { label: string; emoji: string };
  progression: PetProgression | null;
  onSettingsToggle: () => void;
  chatSending: boolean;
  chatHistory: { memory_cited: boolean }[];
  petAnimClass: string;
  facts: any[];
}

export function PetHeader({ pet, stats, mood, progression, onSettingsToggle, chatSending, chatHistory, petAnimClass, facts }: PetHeaderProps) {
  const petName = pet.display_name || pet.name;
  const level = Number((progression as any)?.level ?? 1) || 1;
  const xpPct = progression ? Math.min(100, Math.round((progression.xp / Math.max(1, progression.next_level_xp)) * 100)) : 0;
  const moodText = MOOD_KR[mood.label] || mood.label;

  // Pet reaction state
  const latestMsg = chatHistory.length > 0 ? chatHistory[0] : null;
  const memoryCited = latestMsg?.memory_cited && !chatSending;
  const petMood = chatSending ? "okay" : memoryCited ? "bright" : mood.label;
  const forceSparkle = !!memoryCited;

  // Personality observation
  const personalityFact = facts.find((f: any) => f?.kind === "profile" && f?.key === "personality_observation");
  const personalityText = typeof personalityFact?.value === "string"
    ? personalityFact.value
    : personalityFact?.value?.text ?? personalityFact?.value?.observation ?? null;

  // Pet tap reaction
  const [tapBubble, setTapBubble] = useState<string | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPetTap = () => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    setTapBubble(PET_TAP_LINES[Math.floor(Math.random() * PET_TAP_LINES.length)]);
    tapTimerRef.current = setTimeout(() => setTapBubble(null), 1500);
  };

  return (
    <div className="petHeader">
      {/* Row 1: Avatar + name/level + mood + settings */}
      <div className="petHeaderRow1">
        <div className="petHeaderLeft" onClick={onPetTap} style={{ cursor: "pointer", position: "relative" }}>
          <div className={`petHeaderAvatar${chatSending ? " petThinking" : ""}${memoryCited ? " petMemoryCited" : ""}${tapBubble ? " petTapBounce" : ""}`}>
            <PixelPet mood={petMood} size={48} animClass={petAnimClass} forceSparkle={forceSparkle} />
          </div>
          {tapBubble ? <div className="petTapBubble">{tapBubble}</div> : null}
          <div className="petHeaderInfo">
            <span className="petHeaderName">{petName}</span>
            <span className="petHeaderLevel">Lv.{level}</span>
            {progression ? (
              <div className="petHeaderXpBar"><div className="petHeaderXpFill" style={{ width: `${xpPct}%` }} /></div>
            ) : null}
          </div>
        </div>
        <div className="petHeaderRight">
          <div className="petHeaderMood">
            <span className="petHeaderMoodEmoji">{mood.emoji}</span>
            <span className="petHeaderMoodText">{moodText}</span>
          </div>
          <button className="petHeaderGear settingsGearBtn" type="button" onClick={onSettingsToggle} title="설정" aria-label="설정">
            {"\u2699\uFE0F"}
          </button>
        </div>
      </div>

      {/* Row 2: Stats chips */}
      {stats ? (
        <div className="petHeaderStats">
          <span className="petHeaderStatChip">친밀 {Math.round(stats.bond)}</span>
          <span className="petHeaderStatChip">기분 {Math.round(stats.mood)}</span>
          <span className="petHeaderStatChip">호기심 {Math.round(stats.curiosity)}</span>
        </div>
      ) : null}

      {/* Row 3: Personality observation (if exists) */}
      {personalityText ? (
        <div className="petHeaderPersonality">
          <span className="personalityIcon">🔮</span>
          <span className="petHeaderPersonalityText">{personalityText}</span>
        </div>
      ) : null}
    </div>
  );
}
