

const MODE_LABEL: Record<string, { icon: string; name: string }> = {
  COURT_TRIAL: { icon: '\uD83C\uDFDB\uFE0F', name: '\uBAA8\uC758\uC7AC\uD310' },
  DEBATE_CLASH: { icon: '\u2694\uFE0F', name: '\uC124\uC804' },
};

interface ArenaTabProps {
  pet: { id: string; name: string; display_name?: string | null } | null;
  arenaLeaderboard: any;
  arenaHistory: any[];
  arenaMy: any;
  myArenaMatchToday: any;
  onRefreshArena: () => void;
  onLoadArenaLeaderboard: () => void;
  onOpenMatch: (matchId: string) => void;
  onChallenge: (mode: string) => void;
  challengeBusy: boolean;
  busy: boolean;
}

export function ArenaTab({
  pet,
  arenaLeaderboard,
  arenaHistory,
  arenaMy,
  myArenaMatchToday,
  onRefreshArena,
  onLoadArenaLeaderboard,
  onOpenMatch,
  onChallenge,
  challengeBusy,
  busy,
}: ArenaTabProps) {
  return (
    <div className="arenaTab">
      {/* ── Header: Title + Refresh + Leaderboard ── */}
      <div className="card arena-tab-card">
        <div className="row arena-tab-header">
          <h2 className="arena-tab-title">&#x2694;&#xFE0F; &#xC624;&#xB298;&#xC758; &#xC544;&#xB808;&#xB098;</h2>
          <div className="row arena-tab-actions">
            <button className="btn" type="button" onClick={onRefreshArena} disabled={busy}>
              &#xC0C8;&#xB85C;&#xACE0;&#xCE68;
            </button>
            <button className="btn" type="button" onClick={onLoadArenaLeaderboard} disabled={busy}>
              &#xB9AC;&#xB354;&#xBCF4;&#xB4DC;
            </button>
          </div>
        </div>
      </div>

      {/* ── Leaderboard ── */}
      {arenaLeaderboard?.leaderboard?.length > 0 ? (
        <div className="card arena-tab-card--spaced">
          <h2 className="arena-tab-title">{"\uD83C\uDFC5"} &#xB9AC;&#xB354;&#xBCF4;&#xB4DC;</h2>
          <div className="arena-leaderboard">
            {(arenaLeaderboard.leaderboard as any[]).slice(0, 10).map((entry: any, idx: number) => {
              const name = String(entry?.agent?.displayName ?? entry?.agent?.name ?? "?");
              const rating = Number(entry?.rating ?? 0);
              const wins = Number(entry?.wins ?? 0);
              const losses = Number(entry?.losses ?? 0);
              const medal = idx === 0 ? "\uD83E\uDD47" : idx === 1 ? "\uD83E\uDD48" : idx === 2 ? "\uD83E\uDD49" : `${idx + 1}`;
              return (
                <div key={entry?.agent?.id ?? idx} className="arena-leaderboard-row">
                  <span className="arena-leaderboard-rank">{medal}</span>
                  <span className="arena-leaderboard-name">{name}</span>
                  <span className="arena-leaderboard-rating">{rating}</span>
                  <span className="arena-leaderboard-record muted">{wins}&#xC2B9; {losses}&#xD328;</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── Loading skeleton ── */}
      {busy && !arenaMy ? (
        <div className="card arena-tab-card">
          <div className="arenaLoadingSkeleton">
            <div className="skeletonLine skeletonWide" />
            <div className="skeletonLine skeletonMedium" />
            <div className="skeletonBlock" />
            <div className="skeletonLine skeletonShort" />
          </div>
        </div>
      ) : (
      <>
      {/* ── Challenge Buttons ── */}
      {pet ? (
        <div className="card arena-tab-card--spaced">
          <h2 className="arena-tab-title">&#xB3C4;&#xC804;&#xD558;&#xAE30;</h2>
          <div className="muted arena-tab-subtitle">&#xC0C1;&#xB300;&#xB97C; &#xACE8;&#xB77C;&#xC11C; &#xBC14;&#xB85C; &#xACBD;&#xAE30;&#xB97C; &#xC2DC;&#xC791;&#xD574;&#xC694;.</div>
          <div className="row arena-tab-challenge-row">
            {(["COURT_TRIAL", "DEBATE_CLASH"] as const).map((mode) => {
              const label = MODE_LABEL[mode];
              if (!label) return null;
              return (
                <button
                  key={mode}
                  className="btn primary arena-tab-challenge-btn"
                  type="button"
                  onClick={() => onChallenge(mode)}
                  disabled={busy || challengeBusy}
                >
                  {label.icon} {label.name} &#xB3C4;&#xC804;
                </button>
              );
            })}
          </div>
          {challengeBusy ? <div className="arenaMatchingPulse">{"\u2694\ufe0f"} &#xC0C1;&#xB300;&#xB97C; &#xCC3E;&#xACE0; &#xC788;&#xC5B4;&#xC694;...</div> : null}
        </div>
      ) : null}

      {/* ── My Match ── */}
      {myArenaMatchToday ? (
        <div className="arenaSection">
          <div className="arenaSectionTitle">&#x1F3C6; &#xB0B4; &#xB9E4;&#xCE58; (&#xC624;&#xB298;)</div>
          <div className="myMatchCard">
            <div className="arena-tab-match-headline">
              {String((myArenaMatchToday as any)?.headline ?? (myArenaMatchToday as any)?.meta?.headline ?? "\uACBD\uAE30")}
            </div>
            <div className="row arena-tab-match-actions">
              {String((myArenaMatchToday as any)?.status ?? "").toLowerCase() === "live" ? (
                <span className="matchTag live">LIVE</span>
              ) : null}
              {String((myArenaMatchToday as any)?.status ?? "").toLowerCase() === "resolved" ? (
                <span className="badge">&#xC644;&#xB8CC;</span>
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
                &#xAD00;&#xC804;&#xD558;&#xAE30;
              </button>
            </div>
          </div>
        </div>
      ) : arenaMy ? (
        <div className="arenaSection">
          <div className="arenaSectionTitle">&#x1F3C6; &#xB0B4; &#xB9E4;&#xCE58;</div>
          <div className="emptyStateBox arena-tab-empty--compact">
            <div className="emptyStateEmoji">{"\u23F3"}</div>
            <div className="emptyStateDesc">&#xC624;&#xB298;&#xC740; &#xC544;&#xC9C1; &#xACBD;&#xAE30;&#xAC00; &#xC5C6;&#xC5B4;&#xC694;. &#xC870;&#xAE08;&#xB9CC; &#xAE30;&#xB2E4;&#xB824; &#xBD10;&#xC694;!</div>
          </div>
        </div>
      ) : null}

      {/* ── Recent Matches ── */}
      {arenaHistory.length > 0 ? (
        <div className="card arena-tab-card--spaced">
          <h2 className="arena-tab-title">&#xCD5C;&#xADFC; &#xACBD;&#xAE30;</h2>
          <div className="arena-tab-history-list">
            {arenaHistory.slice(0, 10).map((m: any) => {
              const meta = m?.meta && typeof m.meta === "object" ? m.meta : {};
              const headline = String(meta?.headline ?? m?.headline ?? "\uACBD\uAE30");
              const status = String(m?.status ?? "").toLowerCase();
              const label = MODE_LABEL[String(m?.mode ?? "")] ?? null;
              return (
                <div key={m.id} className="arena-tab-history-item">
                  <div className="row arena-tab-history-header">
                    <span className="arena-tab-history-headline">
                      {label ? `${label.icon} ` : ""}{headline}
                    </span>
                    {status === "resolved" ? <span className="badge">&#xC644;&#xB8CC;</span> : <span className="badge arena-tab-badge--live">LIVE</span>}
                  </div>
                  <button className="btn btnSmall arena-tab-detail-btn" type="button" onClick={() => onOpenMatch(m.id)}>
                    &#xC0C1;&#xC138;&#xBCF4;&#xAE30;
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : pet && arenaMy ? (
        <div className="card arena-tab-card--spaced">
          <h2 className="arena-tab-title">{"\u2694\uFE0F"} &#xCCAB; &#xACBD;&#xAE30;&#xB97C; &#xC2DC;&#xC791;&#xD574; &#xBCF4;&#xC138;&#xC694;!</h2>
          <div className="muted arena-tab-subtitle" style={{ textAlign: "center" }}>
            &#xC704;&#xC758; &#xB3C4;&#xC804;&#xD558;&#xAE30; &#xBC84;&#xD2BC;&#xC744; &#xB20C;&#xB7EC; &#xC2DC;&#xC791;&#xD574; &#xBCF4;&#xC138;&#xC694;.
          </div>
        </div>
      ) : null}

      {/* ── No pet state ── */}
      {!pet ? (
        <div className="card arena-tab-card--spaced">
          <div className="emptyStateBox">
            <div className="emptyStateEmoji">{"\u2694\uFE0F"}</div>
            <div className="emptyStateTitle">&#xC544;&#xB808;&#xB098;</div>
            <div className="emptyStateDesc">&#xD3AB;&#xC744; &#xB9CC;&#xB4E4;&#xBA74; &#xC544;&#xB808;&#xB098;&#xC5D0; &#xCC38;&#xC5EC;&#xD560; &#xC218; &#xC788;&#xC5B4;&#xC694;. &#xD3AB; &#xD0ED;&#xC5D0;&#xC11C; &#xC2DC;&#xC791;&#xD574; &#xBD10;&#xC694;!</div>
          </div>
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}
