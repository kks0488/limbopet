import React, { useState } from "react";

/**
 * 전략 브리핑 패널
 * 매치 시작 후 30초 라이브 윈도우 동안 표시
 * 유저가 모드별 전략을 라운드별로 선택할 수 있음
 */

type RoundStrategy = {
  round: number;
  action: string | null;
  label: string | null;
};

type StrategyDef = { label: string; action: string; desc: string; icon: string; effect: string };

const MODE_STRATEGIES: Record<string, StrategyDef[]> = {
  COURT_TRIAL: [
    { label: "증거 집중", action: "court_evidence", desc: "핵심 증거를 파고들어 논리적으로 입증", icon: "🔍", effect: "논리력 +40%" },
    { label: "반대 심문", action: "court_cross", desc: "상대 주장의 허점을 공격적으로 파헤침", icon: "⚡", effect: "공격력 +35%" },
    { label: "판례 인용", action: "court_precedent", desc: "기존 판례를 인용해 침착하게 설득", icon: "📚", effect: "설득력 +30%" },
  ],
  DEBATE_CLASH: [
    { label: "논리 공격", action: "debate_logic_attack", desc: "데이터와 논리로 상대를 압도", icon: "🧠", effect: "분석력 +50%" },
    { label: "감정 호소", action: "debate_emotion", desc: "공감과 감정으로 청중을 사로잡기", icon: "💖", effect: "공감력 +45%" },
    { label: "카운터", action: "debate_counter", desc: "상대 논리의 허점을 찾아 반격", icon: "🛡️", effect: "방어력 +40%" },
    { label: "압박", action: "debate_pressure", desc: "공격적으로 밀어붙여 상대를 흔듦", icon: "🔥", effect: "공격력 +35%" },
  ],
  AUCTION_DUEL: [
    { label: "스나이핑", action: "auction_snipe", desc: "마지막 순간 정확한 금액으로 치고 들어감", icon: "🎯", effect: "타이밍 +50%" },
    { label: "보수적", action: "auction_conservative", desc: "예산을 아끼며 효율적으로 입찰", icon: "💎", effect: "효율 +40%" },
    { label: "블러프", action: "auction_bluff", desc: "큰 금액으로 위협해 상대를 포기시킴", icon: "🃏", effect: "위협력 +45%" },
  ],
  MATH_RACE: [
    { label: "속도 우선", action: "math_speed", desc: "빠르게 풀어 시간 보너스를 노림", icon: "⚡", effect: "속도 +50%" },
    { label: "정확도 우선", action: "math_accuracy", desc: "천천히 정확하게, 오답 리스크 최소화", icon: "🎯", effect: "정확도 +40%" },
  ],
  PUZZLE_SPRINT: [
    { label: "힌트 분석", action: "puzzle_hint", desc: "주어진 단서를 깊이 분석", icon: "💡", effect: "분석력 +45%" },
    { label: "패턴 인식", action: "puzzle_pattern", desc: "직관적으로 패턴을 빠르게 포착", icon: "🔮", effect: "직관력 +50%" },
  ],
  PROMPT_BATTLE: [
    { label: "창의적", action: "prompt_creative", desc: "독창적이고 참신한 프롬프트 작성", icon: "🎨", effect: "창의력 +50%" },
    { label: "정밀", action: "prompt_precise", desc: "키워드를 빠짐없이 정확하게 포함", icon: "📐", effect: "정밀도 +45%" },
    { label: "키워드 집중", action: "prompt_keyword", desc: "필수 키워드 중심으로 구성", icon: "🔑", effect: "적중률 +40%" },
  ],
};

export function StrategyBriefing({
  mode,
  meta,
  remainingMs,
  busy,
  onSelectStrategy,
}: {
  mode: string;
  meta: any;
  remainingMs: number | null;
  busy: boolean;
  onSelectStrategy: (action: string) => void;
}) {
  const strategies = MODE_STRATEGIES[mode];
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  if (!strategies) return null;

  // 프리뷰 데이터에서 브리핑 정보 추출
  const briefing = extractBriefing(mode, meta);
  const isActive = remainingMs !== null && remainingMs > 0;
  const seconds = remainingMs !== null ? Math.ceil(remainingMs / 1000) : 0;

  return (
    <div className="strategyBriefing">
      <div className="strategyBriefingHeader">
        <div className="strategyBriefingTitle">전략 브리핑</div>
        {isActive ? (
          <span className="strategyTimer">{seconds}초 남음</span>
        ) : (
          <span className="strategyTimerDone">시간 종료</span>
        )}
      </div>

      {/* 상황 브리핑 */}
      {briefing ? (
        <div className="strategyContext">
          {briefing.title ? <div className="strategyContextTitle">{briefing.title}</div> : null}
          {briefing.desc ? <div className="strategyContextDesc">{briefing.desc}</div> : null}
          {briefing.details.length > 0 ? (
            <div className="strategyContextDetails">
              {briefing.details.map((d, i) => (
                <div key={i} className="strategyContextDetail">{d}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 전략 선택 */}
      <div className="strategyOptions">
        <div className="strategyOptionsLabel">전략을 선택하세요:</div>
        <div className="strategyGrid">
          {strategies.map((s) => {
            const isSelected = selectedAction === s.action;
            return (
              <button
                key={s.action}
                className={`strategyCard ${isSelected ? "selected" : ""}`}
                type="button"
                disabled={busy || !isActive}
                onClick={() => {
                  setSelectedAction(s.action);
                  onSelectStrategy(s.action);
                }}
              >
                <div className="strategyCardIcon">{s.icon}</div>
                <div className="strategyCardLabel">{s.label}</div>
                <div className="strategyCardDesc">{s.desc}</div>
                <div className="strategyCardEffect">{s.effect}</div>
                {isSelected ? <div className="strategyCardCheck">✓ 선택됨</div> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function extractBriefing(mode: string, meta: any): { title: string; desc: string; details: string[] } | null {
  if (mode === "COURT_TRIAL") {
    const ct = meta?.court_trial ?? meta?.court_preview;
    if (!ct) return null;
    return {
      title: `사건: ${String(ct.title ?? "")}`,
      desc: `혐의: ${String(ct.charge ?? "")}`,
      details: Array.isArray(ct.facts) ? ct.facts.map((f: any) => String(f)) : [],
    };
  }
  if (mode === "DEBATE_CLASH") {
    const db = meta?.debate ?? meta?.debate_base;
    if (!db) return null;
    return {
      title: `주제: ${String(db.topic ?? "")}`,
      desc: db.rule ? `규칙: ${String(db.rule)}` : "",
      details: db.judge ? [`심사: ${String(db.judge)}`] : [],
    };
  }
  if (mode === "AUCTION_DUEL") {
    const au = meta?.auction ?? meta?.auction_preview;
    if (!au) return null;
    return {
      title: `경매품: ${String(au.item ?? "")}`,
      desc: au.rule ? `규칙: ${String(au.rule)}` : "",
      details: au.vibe ? [`분위기: ${String(au.vibe)}`] : [],
    };
  }
  if (mode === "MATH_RACE") {
    const mr = meta?.math_race ?? meta?.math_preview;
    if (!mr) return null;
    return {
      title: `문제 유형: ${String(mr.kind ?? "수학")}`,
      desc: String(mr.question ?? ""),
      details: [],
    };
  }
  if (mode === "PUZZLE_SPRINT") {
    const pz = meta?.puzzle ?? meta?.puzzle_preview;
    if (!pz) return null;
    return {
      title: "퍼즐",
      desc: String(pz.question ?? ""),
      details: [],
    };
  }
  if (mode === "PROMPT_BATTLE") {
    const pb = meta?.prompt_battle ?? meta?.prompt_preview;
    if (!pb) return null;
    return {
      title: `테마: ${String(pb.theme ?? "")}`,
      desc: "",
      details: Array.isArray(pb.required) ? [`필수 키워드: ${pb.required.join(", ")}`] : [],
    };
  }
  return null;
}
