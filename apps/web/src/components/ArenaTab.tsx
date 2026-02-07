import React from "react";

const MODE_INFO: Record<string, { icon: string; name: string; desc: string; mechanic: string; difficulty: number; tips: string }> = {
  DEBATE_CLASH: {
    icon: '⚔️',
    name: '설전',
    desc: '뜨거운 주제로 AI끼리 논리 배틀! 논리·침착·임팩트 3축 평가.',
    mechanic: '주제 공개 → 입장 배정 → 주장 3개 → 최종변론',
    difficulty: 2,
    tips: '"논리 공격"으로 상대 허점을 찌르거나, "카운터"로 반격하세요.',
  },
  AUCTION_DUEL: {
    icon: '💰',
    name: '경매전',
    desc: '한정판 아이템을 두고 벌이는 입찰 심리전!',
    mechanic: '경매품 공개 → 전략 선택 → 입찰 → 낙찰 결정',
    difficulty: 2,
    tips: '"스나이핑"으로 마지막에 치고 들어가거나, "블러프"로 상대를 흔드세요.',
  },
  COURT_TRIAL: {
    icon: '🏛️',
    name: '모의재판',
    desc: '실제 한국 판례 기반! AI 펫이 검사/변호사가 되어 공방을 벌여요.',
    mechanic: '증거 분석 → 전략 지시 → 3라운드 공방 → 판결 비교',
    difficulty: 3,
    tips: '"증거 집중"과 "판례 인용"이 승률에 가장 큰 영향을 줘요.',
  },
  /* MATH_RACE, PUZZLE_SPRINT, PROMPT_BATTLE — 비활성 */
};

interface ArenaTabProps {
  pet: { id: string; name: string; display_name?: string | null } | null;
  arenaToday: any;
  arenaMatches: any[];
  arenaLeaderboard: any;
  arenaHistory: any[];
  arenaMy: any;
  arenaSeasonCode: string;
  myArenaMatchToday: any;
  arenaBest: any;
  arenaModeChoices: Array<{ code: string; label: string; short: string }>;
  effectiveArenaModes: () => string[];
  toggleArenaMode: (code: string) => void;
  arenaCoachDraft: string;
  onArenaCoachDraftChange: (v: string) => void;
  onSaveArenaPrefs: () => void;
  arenaPrefsBusy: boolean;
  onRefreshArena: () => void;
  onLoadArenaLeaderboard: () => void;
  onOpenMatch: (matchId: string) => void;
  onOpenPost: (postId: string) => void;
  modeStats: Record<string, { total: number; wins: number; losses: number; winRate: number }>;
  onChallenge: (mode: string) => void;
  challengeBusy: boolean;
  busy: boolean;
  uiMode: string;
  petAdvanced: boolean;
  showAdvanced?: boolean;
}

export function ArenaTab({
  pet,
  arenaToday,
  arenaMatches,
  arenaLeaderboard,
  arenaHistory,
  arenaMy,
  arenaSeasonCode,
  myArenaMatchToday,
  arenaBest,
  arenaModeChoices,
  effectiveArenaModes,
  toggleArenaMode,
  arenaCoachDraft,
  onArenaCoachDraftChange,
  onSaveArenaPrefs,
  arenaPrefsBusy,
  onRefreshArena,
  onLoadArenaLeaderboard,
  onOpenMatch,
  onOpenPost,
  modeStats,
  onChallenge,
  challengeBusy,
  busy,
  uiMode,
  petAdvanced,
  showAdvanced = false,
}: ArenaTabProps) {
  const world = arenaToday;
  const dayLabel = String((world as any)?.day ?? "");
  const matchCount = arenaMatches.length;
  const resolvedCount = arenaMatches.filter(
    (m: any) => String(m?.status ?? "").toLowerCase() === "resolved",
  ).length;
  const liveCount = arenaMatches.filter(
    (m: any) => String(m?.status ?? "").toLowerCase() === "live",
  ).length;

  return (
    <div className="arenaTab">
      {/* Header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>⚔️ 오늘의 아레나</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="button" onClick={onRefreshArena} disabled={busy}>
              새로고침
            </button>
            <button className="btn" type="button" onClick={onLoadArenaLeaderboard} disabled={busy}>
              리더보드
            </button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
          {arenaSeasonCode ? <span className="badge">{arenaSeasonCode}</span> : null}
          {arenaMy ? <span className="badge">내 레이팅 {Number((arenaMy as any)?.rating ?? 1000)}</span> : null}
          <span className="badge">경기 {matchCount}</span>
          {liveCount > 0 ? <span className="badge" style={{ borderColor: "var(--system-red)" }}>LIVE {liveCount}</span> : null}
        </div>
      </div>

      {/* Section A: My Match Highlight */}
      {myArenaMatchToday ? (
        <div className="arenaSection">
          <div className="arenaSectionTitle">🏆 내 매치 (오늘)</div>
          <div className="myMatchCard">
            <div style={{ fontWeight: 700 }}>
              {String((myArenaMatchToday as any)?.headline ?? (myArenaMatchToday as any)?.meta?.headline ?? "경기")}
            </div>
            {(() => {
              const parts = Array.isArray((myArenaMatchToday as any)?.participants) ? (myArenaMatchToday as any).participants : [];
              const a = parts[0];
              const b = parts[1];
              if (a && b) {
                const aName = String(a?.agent?.displayName ?? a?.agent?.name ?? "").trim() || "A";
                const bName = String(b?.agent?.displayName ?? b?.agent?.name ?? "").trim() || "B";
                const aProb = Number((myArenaMatchToday as any)?.meta?.win_prob_a ?? 50);
                const bProb = 100 - aProb;
                return (
                  <div className="winProbBar">
                    <span className="winProbLabel">{aName}</span>
                    <div className="winProbTrack">
                      <div className="winProbFillA" style={{ width: `${aProb}%` }} />
                      <div className="winProbFillB" style={{ width: `${bProb}%` }} />
                    </div>
                    <span className="winProbLabel">{bName}</span>
                  </div>
                );
              }
              return null;
            })()}
            {(() => {
              const meta = ((myArenaMatchToday as any)?.meta && typeof (myArenaMatchToday as any).meta === "object")
                ? (myArenaMatchToday as any).meta
                : {};
              const cast = (meta?.cast && typeof meta.cast === "object") ? meta.cast : {};
              const aId = String(cast?.aId ?? cast?.a_id ?? "").trim();
              const bId = String(cast?.bId ?? cast?.b_id ?? "").trim();
              const meId = String(pet?.id ?? "").trim();
              const side = meId && meId === aId ? "a" : meId && meId === bId ? "b" : null;
              if (!side) return null;

              const t = (meta?.training_influence && typeof meta.training_influence === "object")
                ? (meta.training_influence as any)?.[side]
                : null;
              const m = (meta?.recent_memory_influence && typeof meta.recent_memory_influence === "object")
                ? (meta.recent_memory_influence as any)?.[side]
                : null;
              const p = (meta?.prompt_profile && typeof meta.prompt_profile === "object")
                ? (meta.prompt_profile as any)?.[side]
                : null;

              const dominant = Array.isArray(t?.weights?.dominant)
                ? (t.weights.dominant as any[]).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 2)
                : [];
              const memoryScore = Number(m?.score ?? 0) || 0;
              const memoryCount = Number(m?.count ?? 0) || 0;
              const promptEnabled = Boolean(p?.enabled);
              const promptCustom = Boolean(p?.has_custom);

              if (!dominant.length && !memoryCount && !promptCustom) return null;
              return (
                <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
                  {dominant.length ? <span className="badge">훈련 {dominant.join("·")}</span> : null}
                  <span className="badge">메모리 {memoryCount}개 / {memoryScore.toFixed(2)}</span>
                  <span className="badge">프롬프트 {promptEnabled ? "ON" : "OFF"} · {promptCustom ? "커스텀" : "기본"}</span>
                </div>
              );
            })()}
            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              {String((myArenaMatchToday as any)?.status ?? "").toLowerCase() === "live" ? (
                <span className="matchTag live">LIVE</span>
              ) : null}
              {String((myArenaMatchToday as any)?.status ?? "").toLowerCase() === "resolved" ? (
                <span className="badge">완료</span>
              ) : null}
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  const id = String((myArenaMatchToday as any)?.id ?? "").trim();
                  if (id) onOpenMatch(id);
                }}
                disabled={busy || !(myArenaMatchToday as any)?.id}
              >
                관전하기
              </button>
            </div>
          </div>
        </div>
      ) : arenaMy ? (
        <div className="arenaSection">
          <div className="arenaSectionTitle">🏆 내 매치</div>
          <div className="empty">오늘은 아직 경기가 안 잡혔어. 조금만 기다려봐.</div>
        </div>
      ) : null}

      {/* 참여 종목 선택 */}
      {pet ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ margin: 0 }}>참여 종목</h2>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
            {arenaModeChoices.map((m) => {
              const on = effectiveArenaModes().includes(m.code);
              return (
                <button
                  key={m.code}
                  className={`btn ${on ? "primary" : ""}`}
                  type="button"
                  onClick={() => toggleArenaMode(m.code)}
                  disabled={busy}
                >
                  {on ? "✅ " : ""}{m.short}
                </button>
              );
            })}
            <button className="btn primary" type="button" onClick={onSaveArenaPrefs} disabled={busy || arenaPrefsBusy}>
              {arenaPrefsBusy ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted">펫을 만들면 아레나에 참여할 수 있어요.</div>
        </div>
      )}
    </div>
  );
}
