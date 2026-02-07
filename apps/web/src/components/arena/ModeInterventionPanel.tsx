import React from "react";

type ModeStrategy = {
  label: string;
  action: string;
  boosts: Record<string, number>;
};

const MODE_STRATEGIES: Record<string, ModeStrategy[]> = {
  DEBATE_CLASH: [
    { label: "논리 공격", action: "debate_logic_attack", boosts: { study: 0.4 } },
    { label: "감정 호소", action: "debate_emotion", boosts: { aggressive: 0.3 } },
    { label: "카운터", action: "debate_counter", boosts: { calm: 0.35 } },
    { label: "압박", action: "debate_pressure", boosts: { aggressive: 0.7 } },
  ],
  COURT_TRIAL: [
    { label: "증거 집중", action: "court_evidence", boosts: { study: 0.5 } },
    { label: "반대 심문", action: "court_cross", boosts: { aggressive: 0.3 } },
    { label: "판례 인용", action: "court_precedent", boosts: { calm: 0.5 } },
  ],
  AUCTION_DUEL: [
    { label: "스나이핑", action: "auction_snipe", boosts: { budget: 0.5 } },
    { label: "보수적", action: "auction_conservative", boosts: { budget: 0.7 } },
    { label: "블러프", action: "auction_bluff", boosts: { aggressive: 0.5 } },
  ],
  MATH_RACE: [
    { label: "속도", action: "math_speed", boosts: { aggressive: 0.3 } },
    { label: "정확도", action: "math_accuracy", boosts: { study: 0.5 } },
  ],
  PUZZLE_SPRINT: [
    { label: "힌트", action: "puzzle_hint", boosts: { study: 0.6 } },
    { label: "패턴", action: "puzzle_pattern", boosts: { study: 0.3 } },
  ],
  PROMPT_BATTLE: [
    { label: "창의적", action: "prompt_creative", boosts: { aggressive: 0.3 } },
    { label: "정밀", action: "prompt_precise", boosts: { study: 0.5 } },
    { label: "키워드", action: "prompt_keyword", boosts: { calm: 0.3 } },
  ],
};

export function ModeInterventionPanel({
  mode,
  busy,
  onIntervene,
}: {
  mode: string;
  busy: boolean;
  onIntervene: (action: string, boosts: Record<string, number>) => void;
}) {
  const strategies = MODE_STRATEGIES[mode];
  if (!strategies) return null;

  return (
    <div className="modeInterventionPanel">
      <div className="modeInterventionTitle">모드 전략</div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {strategies.map((s) => (
          <button
            key={s.action}
            className="btn modeStrategyBtn"
            type="button"
            disabled={busy}
            onClick={() => onIntervene(s.action, s.boosts)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
