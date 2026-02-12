import { useState } from "react";

/**
 * 전략 브리핑 패널
 * 매치 시작 후 30초 라이브 윈도우 동안 표시
 * 유저가 모드별 전략을 라운드별로 선택할 수 있음
 */

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
        <div className="strategyOptionsLabel">전략을 골라 봐요:</div>
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
  return null;
}
