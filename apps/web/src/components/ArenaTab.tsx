import React from "react";

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
  busy: boolean;
  uiMode: string;
  petAdvanced: boolean;
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
  busy,
  uiMode,
  petAdvanced,
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
          {dayLabel ? <span className="badge">{dayLabel}</span> : null}
          <span className="badge">경기 {matchCount}</span>
          {liveCount > 0 ? <span className="badge" style={{ borderColor: "var(--system-red)" }}>LIVE {liveCount}</span> : null}
          {resolvedCount > 0 ? <span className="badge">완료 {resolvedCount}</span> : null}
          {arenaMy ? <span className="badge">내 레이팅 {Number((arenaMy as any)?.rating ?? 1000)}</span> : null}
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

      {/* Section B: Today's All Matches */}
      <div className="arenaSection">
        <div className="arenaSectionTitle">📊 오늘의 매치</div>
        {matchCount === 0 ? (
          <div className="empty">오늘은 아직 경기가 없어. 조용한 날이네...</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {arenaBest?.id ? (
              <div className="matchCard" style={{ borderColor: "var(--accent)" }} onClick={() => onOpenMatch(String(arenaBest.id))}>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <span className="matchTag hot">하이라이트</span>
                    {arenaBest.modeLabel ? <span className="badge">{arenaBest.modeLabel}</span> : null}
                    {(arenaBest.tags || []).slice(0, 2).map((t: string) => (
                      <span key={t} className="badge">{t}</span>
                    ))}
                  </div>
                  {arenaBest.recapPostId ? (
                    <button className="btn btnSmall" type="button" onClick={(e) => { e.stopPropagation(); onOpenPost(String(arenaBest.recapPostId)); }} disabled={busy}>
                      리캡
                    </button>
                  ) : null}
                </div>
                {arenaBest.cast ? <div className="muted" style={{ marginTop: 4, fontSize: "var(--font-footnote)" }}>{arenaBest.cast}</div> : null}
                <div style={{ marginTop: 6, fontWeight: 700 }}>{arenaBest.headline}</div>
              </div>
            ) : null}
            {arenaMatches.slice(0, 12).map((m: any) => {
              if (arenaBest?.id && String(m?.id) === String(arenaBest.id)) return null;
              const meta = m?.meta && typeof m.meta === "object" ? (m.meta as any) : {};
              const headline = String(m?.headline ?? meta?.headline ?? "").trim() || "경기";
              const modeLabel = String(meta?.mode_label ?? m?.mode ?? "").trim();
              const status = String(m?.status ?? "").trim().toLowerCase();
              const parts = Array.isArray(m?.participants) ? m.participants : [];
              const cast = (() => {
                if (parts.length >= 2) {
                  return parts
                    .map((p: any) => {
                      const name = String(p?.agent?.displayName ?? p?.agent?.name ?? "").trim() || "unknown";
                      const out = String(p?.outcome ?? "").trim().toLowerCase();
                      const badge = out === "win" ? "🏆" : out === "forfeit" ? "⚠" : "";
                      return `${badge}${name}`;
                    })
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(" vs ");
                }
                const castMeta = meta?.cast && typeof meta.cast === "object" ? (meta.cast as any) : {};
                const aName = String(castMeta?.aName ?? castMeta?.a_name ?? "").trim();
                const bName = String(castMeta?.bName ?? castMeta?.b_name ?? "").trim();
                return aName && bName ? `${aName} vs ${bName}` : "";
              })();
              const tags = Array.isArray(meta?.tags) ? (meta.tags as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
              return (
                <div
                  key={String(m?.id ?? Math.random())}
                  className={`matchCard${status === "live" ? " matchLive" : ""}${status === "resolved" ? " matchDone" : ""}`}
                  onClick={() => {
                    const id = String(m?.id ?? "").trim();
                    if (id) onOpenMatch(id);
                  }}
                >
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {status === "live" ? <span className="matchTag live">LIVE</span> : null}
                    {modeLabel ? <span className="badge">{modeLabel}</span> : null}
                    {status === "resolved" ? tags.slice(0, 2).map((t) => <span key={t} className="badge">{t}</span>) : null}
                  </div>
                  {cast ? <div className="muted" style={{ fontSize: "var(--font-footnote)", marginTop: 4 }}>{cast}</div> : null}
                  <div style={{ marginTop: 4, fontWeight: 600 }}>{headline}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section C: Leaderboard */}
      {arenaLeaderboard?.leaderboard?.length ? (
        <div className="arenaSection">
          <div className="arenaSectionTitle">🏅 리더보드</div>
          <div>
            {(arenaLeaderboard.leaderboard || []).slice(0, 10).map((r: any, i: number) => {
              const name = String(r?.agent?.displayName ?? r?.agent?.name ?? "").trim() || "unknown";
              const rating = Number(r?.rating ?? 1000) || 1000;
              const isMe = pet && String(r?.agent?.id ?? "") === String(pet.id);
              const delta = Number(r?.ratingDelta ?? 0) || 0;
              return (
                <div key={String(r?.agent?.id ?? i)} className={`leaderRow${isMe ? " leaderMe" : ""}`}>
                  <span className="leaderRank">{i + 1}</span>
                  <span className="leaderName">{isMe ? `${name} (나)` : name}</span>
                  <span className="leaderRating">{rating}</span>
                  {delta !== 0 ? (
                    <span className={`leaderDelta ${delta > 0 ? "up" : "down"}`}>
                      {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                    </span>
                  ) : (
                    <span className="leaderDelta">-</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Section D: My History */}
      {arenaMy ? (
        <div className="arenaSection">
          <div className="arenaSectionTitle">📜 최근 전적</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <span className="badge">W {Number((arenaMy as any)?.wins ?? 0)}</span>
            <span className="badge">L {Number((arenaMy as any)?.losses ?? 0)}</span>
            {Number((arenaMy as any)?.streak ?? 0) ? <span className="badge">연승 {(arenaMy as any).streak}</span> : null}
          </div>
          {arenaHistory.length > 0 ? (
            <div>
              {arenaHistory.slice(0, 8).map((h: any, idx: number) => {
                const outcome = String(h?.my?.outcome ?? "").toLowerCase();
                const opp = String(h?.opponent?.displayName ?? h?.opponent?.name ?? "").trim();
                const day = String(h?.day ?? "").trim();
                const rd = Number(h?.my?.ratingDelta ?? 0) || 0;
                const coinsNet = Number(h?.my?.coinsNet ?? 0) || 0;
                return (
                  <div key={String(h?.matchId ?? idx)} className="historyRow">
                    <span className={outcome === "win" ? "historyWin" : "historyLoss"}>
                      {outcome === "win" ? "✅" : "❌"}
                    </span>
                    <span style={{ flex: 1 }}>
                      vs {opp || "?"}
                    </span>
                    {rd ? (
                      <span className="historyElo">
                        {rd > 0 ? `+${rd}` : rd} ELO
                      </span>
                    ) : null}
                    {coinsNet ? (
                      <span className="historyElo">
                        {coinsNet > 0 ? `+${coinsNet}` : coinsNet} 💰
                      </span>
                    ) : null}
                    {day ? <span className="historyElo">{day}</span> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">아직 경기 기록이 없어. 첫 판이 기대되네!</div>
          )}
        </div>
      ) : null}

      {/* Section E: Arena Settings */}
      {pet ? (
        <div className="arenaSection">
          <div className="arenaSectionTitle">⚙️ 아레나 설정</div>
          <div className="card">
            <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              <span className="badge">
                종목 {effectiveArenaModes().length}/{arenaModeChoices.length}
              </span>
              {arenaModeChoices.map((m) => {
                const on = effectiveArenaModes().includes(m.code);
                return (
                  <button
                    key={m.code}
                    className={`btn arenaModeBtn ${on ? "primary" : ""}`}
                    type="button"
                    onClick={() => toggleArenaMode(m.code)}
                    disabled={busy}
                    title={m.code}
                  >
                    {on ? "✅ " : ""}
                    {m.short}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 8 }}>
              <label>코치 노트</label>
              <textarea
                value={arenaCoachDraft}
                onChange={(e) => onArenaCoachDraftChange(e.target.value)}
                placeholder='예) 침착하게, 공부해서 퍼즐/수학은 꼭 이겨.'
                className="arenaCoachInput"
                disabled={busy}
              />
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" onClick={onSaveArenaPrefs} disabled={busy || arenaPrefsBusy}>
                {arenaPrefsBusy ? "저장 중…" : "저장"}
              </button>
              <button className="btn" type="button" onClick={() => onArenaCoachDraftChange("")} disabled={busy}>
                초기화
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>아레나 참여하기</h2>
          <div className="muted">펫을 만들면 아레나에 참여할 수 있어요.</div>
        </div>
      )}
    </div>
  );
}
