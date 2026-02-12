import { useEffect, useRef, useState } from "react";
import {
  arenaMatchDetail,
  arenaIntervene,
  arenaPredict,
  arenaCheer,
  petArenaVote,
  type ArenaMatchDetail,
  type ArenaMatchMeta,
} from "../lib/api";
import { friendlyError } from "../lib/errorMessages";
import { DebateBoard } from "./arena/DebateBoard";
import { CourtBoard } from "./arena/CourtBoard";

export function ArenaWatchModal({
  token,
  matchId,
  viewerAgentId,
  onClose,
  onOpenPost,
}: {
  token: string;
  matchId: string;
  viewerAgentId?: string | null;
  onClose: () => void;
  onOpenPost: (postId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<ArenaMatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interveneBusy, setInterveneBusy] = useState(false);
  const [interveneMsg, setInterveneMsg] = useState<string | null>(null);
  const [predictBusy, setPredictBusy] = useState(false);
  const [myPick, setMyPick] = useState<"a" | "b" | null>(null);
  const [cheerBusy, setCheerBusy] = useState(false);
  const [courtVote, setCourtVote] = useState<string | null>(null);
  const [courtVoteResult, setCourtVoteResult] = useState<{ fair_count: number; unfair_count: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [revealedRound, setRevealedRound] = useState(0);
  const [skipReveal, setSkipReveal] = useState(false);
  const [verdictRevealed, setVerdictRevealed] = useState(false);
  const matchRef = useRef<ArenaMatchDetail | null>(null);
  const revealBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  const isLiveForPolling = (() => {
    const current = match;
    if (!current) return false;
    const meta = current?.meta && typeof current.meta === "object" ? (current.meta as any) : {};
    const live = meta?.live && typeof meta.live === "object" ? (meta.live as any) : null;
    const endsAtMs = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
    return String(current?.status ?? "").trim().toLowerCase() === "live" && Number.isFinite(endsAtMs);
  })();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMatch(null);
    setInterveneMsg(null);
    setMyPick(null);
    setCourtVote(null);
    setCourtVoteResult(null);
    arenaMatchDetail(token, matchId)
      .then((res) => {
        if (cancelled) return;
        setMatch(res.match);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(friendlyError(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, matchId]);

  useEffect(() => {
    if (!isLiveForPolling) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [isLiveForPolling]);

  useEffect(() => {
    if (!isLiveForPolling) return;

    let cancelled = false;
    const tick = async () => {
      if (!matchRef.current) return;
      try {
        const res = await arenaMatchDetail(token, matchId);
        if (cancelled) return;
        setMatch(res.match);
      } catch {
        // ignore
      }
    };
    const h = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(h);
    };
  }, [token, matchId, isLiveForPolling]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Sequential round reveal for resolved matches; instant for live/pending
  useEffect(() => {
    if (!match || loading) return;
    const r = Array.isArray((match?.meta as any)?.rounds) ? ((match.meta as any).rounds as any[]) : [];
    const st = String(match?.status ?? "").trim().toLowerCase();

    if (st !== "resolved" || r.length === 0) {
      // In-progress or no rounds: show everything immediately
      setSkipReveal(true);
      setVerdictRevealed(true);
      setRevealedRound(r.length);
      return;
    }

    // Resolved: sequential reveal animation
    setSkipReveal(false);
    setVerdictRevealed(false);
    setRevealedRound(0);

    const timers: number[] = [];
    r.forEach((_: any, idx: number) => {
      timers.push(window.setTimeout(() => setRevealedRound(idx + 1), (idx + 1) * 800));
    });
    // 1.5s after last round -> reveal verdict
    timers.push(window.setTimeout(() => setVerdictRevealed(true), r.length * 800 + 1500));

    return () => timers.forEach(t => window.clearTimeout(t));
  }, [match, loading]);

  const meta = match?.meta && typeof match.meta === "object" ? (match.meta as ArenaMatchMeta) : {};
  const modeLabel = String(meta?.mode_label ?? match?.mode ?? "").trim();
  const headline = String(match?.headline ?? meta?.headline ?? "").trim();
  const recapPostId = String(meta?.recap_post_id ?? "").trim();
  const nearMiss = String(meta?.near_miss ?? meta?.nearMiss ?? "").trim();
  const tags = Array.isArray(meta?.tags) ? (meta.tags as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const rounds = Array.isArray(meta?.rounds) ? (meta.rounds as any[]) : [];
  const predict = meta?.predict && typeof meta.predict === "object" ? (meta.predict as any) : null;
  const cheer = meta?.cheer && typeof meta.cheer === "object" ? (meta.cheer as any) : null;
  const cheerA = Number(cheer?.a_count ?? 0) || 0;
  const cheerB = Number(cheer?.b_count ?? 0) || 0;
  const cheerBuff = cheer?.buff_applied && typeof cheer.buff_applied === "object" ? (cheer.buff_applied as any) : null;
  const cheerDeltaA = Number(cheerBuff?.delta_a ?? cheerBuff?.deltaA ?? 0) || 0;

  const status = String(match?.status ?? "").trim().toLowerCase();
  const live = meta?.live && typeof meta.live === "object" ? (meta.live as any) : null;
  const endsAtMs = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
  const remainingMs = Number.isFinite(endsAtMs) ? Math.max(0, endsAtMs - nowMs) : null;

  const partsRaw = Array.isArray((match as any)?.participants) ? (((match as any).participants as any[]) ?? []) : [];
  const cast = meta?.cast && typeof meta.cast === "object" ? (meta.cast as any) : {};
  const castAId = String(cast?.aId ?? cast?.a_id ?? "").trim();
  const castBId = String(cast?.bId ?? cast?.b_id ?? "").trim();
  const castAName = String(cast?.aName ?? cast?.a_name ?? "").trim();
  const castBName = String(cast?.bName ?? cast?.b_name ?? "").trim();

  const parts =
    partsRaw.length >= 2
      ? partsRaw
      : castAId && castBId
        ? [
            { agent: { id: castAId, name: castAName || "A", displayName: castAName || null } },
            { agent: { id: castBId, name: castBName || "B", displayName: castBName || null } },
          ]
        : partsRaw;
  const a = parts?.[0] ?? null;
  const b = parts?.[1] ?? null;

  const aName = String(castAName || a?.agent?.displayName || a?.agent?.name || "A");
  const bName = String(castBName || b?.agent?.displayName || b?.agent?.name || "B");
  const trainingInfluence = meta?.training_influence && typeof meta.training_influence === "object"
    ? (meta.training_influence as any)
    : {};

  const viewerId = viewerAgentId ? String(viewerAgentId) : "";
  const canIntervene =
    status === "live" &&
    remainingMs !== null &&
    remainingMs > 0 &&
    Boolean(viewerId && (viewerId === castAId || viewerId === castBId));
  const canPredict =
    status === "live" && remainingMs !== null && remainingMs > 0 && Boolean(viewerId && castAId && castBId);
  const canCheer = canPredict;
  const mode = String(match?.mode ?? "").trim();

  // T1: Round reveal logic
  const effectiveReveal = skipReveal ? rounds.length : revealedRound;
  const allRoundsRevealed = status === "resolved" && rounds.length > 0 && effectiveReveal >= rounds.length;

  useEffect(() => {
    if (revealedRound > 0 && revealBottomRef.current) {
      revealBottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [revealedRound]);

  const handleIntervene = async (action: string) => {
    setInterveneBusy(true);
    setInterveneMsg(null);
    try {
      await arenaIntervene(token, matchId, action as any);
      setInterveneMsg(`개입: ${action}`);
      const res = await arenaMatchDetail(token, matchId);
      setMatch(res.match);
    } catch (e: any) {
      setInterveneMsg(friendlyError(e));
    } finally {
      setInterveneBusy(false);
    }
  };

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modalHeader">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="awm-title">경기 관전</div>
            <div className="row" style={{ gap: 8 }}>
              <span className="kbdHint">ESC</span>
              <button className="btn" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>

          {match ? (
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              {modeLabel ? <span className="badge">{modeLabel}</span> : null}
              {status ? <span className="badge">{status === "live" ? "진행 중" : status}</span> : null}
              {status === "live" && remainingMs !== null ? (
                <span className="badge">개입 {Math.ceil(remainingMs / 1000)}s</span>
              ) : null}
              {recapPostId ? (
                <button className="btn" type="button" onClick={() => onOpenPost(recapPostId)} disabled={loading}>
                  리캡 글 보기
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="modalBody">
          {error ? <div className="toast bad">{error}</div> : null}
          {interveneMsg ? <div className="toast warn">{interveneMsg}</div> : null}

          {loading ? (
            <div className="arenaLoadingSkeleton">
              <div className="skeletonLine skeletonWide" />
              <div className="skeletonLine skeletonMedium" />
              <div className="skeletonLine skeletonShort" />
              <div className="skeletonBlock" />
            </div>
          ) : !match ? (
            <div className="emptyStateBox">
              <div className="emptyStateEmoji">{"\uD83D\uDD0D"}</div>
              <div className="emptyStateDesc">경기를 찾지 못했어요.</div>
            </div>
          ) : (
            <>
              {headline ? <div style={{ fontWeight: 800, marginBottom: 12 }}>{headline}</div> : null}

              {/* 판결 카운트다운 */}
              {(() => {
                if (status !== "resolved" || verdictRevealed) return null;
                if (!allRoundsRevealed) return null;
                return (
                  <div className="verdictCountdown">
                    <div className="verdictCountdownText">판결 중...</div>
                    <div className="verdictCountdownDots">
                      <span className="verdictDot verdictDot1" />
                      <span className="verdictDot verdictDot2" />
                      <span className="verdictDot verdictDot3" />
                    </div>
                  </div>
                );
              })()}

              {/* 승패 감정 연출 — viewer가 참가자일 때만 */}
              {(() => {
                if (status !== "resolved" || !viewerId || !verdictRevealed) return null;
                const result = (meta as any)?.result && typeof (meta as any).result === "object" ? ((meta as any).result as any) : {};
                const winnerId = String(result?.winnerId ?? result?.winner_id ?? "").trim();
                const loserId = String(result?.loserId ?? result?.loser_id ?? "").trim();
                const isViewer = viewerId === castAId || viewerId === castBId;
                if (!isViewer) return null;

                const isWinner = viewerId === winnerId;
                const isLoser = viewerId === loserId;
                const condition = (meta as any)?.condition && typeof (meta as any).condition === "object" ? ((meta as any).condition as any) : {};
                const mySide = viewerId === castAId ? "a" : "b";
                const ratingBefore = Number(condition?.[`${mySide}_before`] ?? 0) || 0;
                const ratingAfter = Number(condition?.[`${mySide}_after`] ?? 0) || 0;
                const ratingDelta = ratingAfter - ratingBefore;
                const stake = meta?.stake && typeof meta.stake === "object" ? (meta.stake as any) : {};
                const coinsWon = Number(stake?.to_winner ?? 0) || 0;

                if (isWinner) {
                  return (
                    <div className="arenaResultBanner arenaResultWin">
                      <div className="arenaResultConfetti" />
                      <div className="arenaResultTitle">승리!</div>
                      <div className="arenaResultDetail">
                        +{coinsWon} 코인 · 레이팅 {ratingDelta >= 0 ? "+" : ""}{ratingDelta}
                      </div>
                    </div>
                  );
                }
                if (isLoser) {
                  const penalty = Number(stake?.loss_penalty_coins ?? 0) || 0;
                  const encouragements = [
                    "다음엔 더 강해질 거야. 코칭을 계속하면 달라져!",
                    "지금의 경험이 내일의 승리를 만들어.",
                    "아까웠어! 한 끗 차이였는데...",
                    "이 패배가 성장의 시작이야.",
                  ];
                  const encouragement = encouragements[Math.floor(Math.abs(ratingDelta) % encouragements.length)];
                  return (
                    <div className="arenaResultBanner arenaResultLose">
                      <div className="arenaResultLoseIcon">{"\uD83D\uDCAA"}</div>
                      <div className="arenaResultTitle">아쉬워...</div>
                      <div className="arenaResultDetail">
                        -{penalty} 코인 · 레이팅 {ratingDelta >= 0 ? "+" : ""}{ratingDelta}
                      </div>
                      <div className="arenaResultGrowth">{encouragement}</div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* 공유 카드 */}
              {(() => {
                if (status !== "resolved" || !verdictRevealed) return null;
                const result = (meta as any)?.result && typeof (meta as any).result === "object" ? ((meta as any).result as any) : {};
                const winnerId = String(result?.winnerId ?? result?.winner_id ?? "").trim();
                const winnerName = winnerId === castAId ? aName : winnerId === castBId ? bName : "?";
                const loserName = winnerId === castAId ? bName : winnerId === castBId ? aName : "?";
                const ct = (meta as any)?.court_trial ?? {};
                const caseTitle = String(ct?.case_title ?? ct?.title ?? headline ?? "").trim();
                const modeIcon = mode === "COURT_TRIAL" ? "\u2696\uFE0F" : "\u2694\uFE0F";
                const modeName = mode === "COURT_TRIAL" ? "\uBAA8\uC758\uC7AC\uD310" : "\uC124\uC804";

                const shareText = `${modeIcon} \uB9BC\uBCF4\uD3AB ${modeName}\n\n${caseTitle ? `"${caseTitle}"\n\n` : ""}${winnerName} vs ${loserName}\n\uD310\uACB0: ${winnerName} \uC2B9\uB9AC!\n\nlimbopet.com`;

                const handleShare = async () => {
                  if (navigator.share) {
                    try {
                      await navigator.share({ text: shareText });
                    } catch { /* user cancelled */ }
                  } else {
                    try {
                      await navigator.clipboard.writeText(shareText);
                      const el = document.querySelector('.shareCardCopied');
                      if (el) { el.classList.add('shareCardCopied--show'); setTimeout(() => el.classList.remove('shareCardCopied--show'), 2000); }
                    } catch { /* fallback */ }
                  }
                };

                return (
                  <div className="shareCard">
                    <div className="shareCardInner">
                      <div className="shareCardIcon">{modeIcon}</div>
                      <div className="shareCardTitle">{"\uB9BC\uBCF4\uD3AB"} {modeName}</div>
                      {caseTitle ? <div className="shareCardCase">{caseTitle}</div> : null}
                      <div className="shareCardVs">
                        <span className={winnerId === castAId ? "shareCardWinner" : "shareCardLoser"}>{aName}</span>
                        <span className="shareCardVsText">vs</span>
                        <span className={winnerId === castBId ? "shareCardWinner" : "shareCardLoser"}>{bName}</span>
                      </div>
                      <div className="shareCardResult">{winnerName} {"\uC2B9\uB9AC!"}</div>
                    </div>
                    <button className="btn primary shareCardBtn" type="button" onClick={handleShare}>
                      {"\uD83D\uDCE4"} {"\uACB0\uACFC \uACF5\uC720\uD558\uAE30"}
                    </button>
                    <div className="shareCardCopied">{"\uBCF5\uC0AC\uB428!"}</div>
                  </div>
                );
              })()}

              {/* 코칭 영향 서사 — 1줄 축소 */}
              {(() => {
                if (status !== "resolved" || !verdictRevealed) return null;
                const mySide = viewerId === castAId ? "a" : viewerId === castBId ? "b" : null;
                if (!mySide) return null;
                const t = trainingInfluence?.[mySide];
                const narrative = String(t?.coaching_narrative ?? (meta as any)?.coaching_narrative ?? "").trim();
                if (!narrative) return null;
                return (
                  <div className="arenaCoachingNarrativeCompact">{narrative}</div>
                );
              })()}

              {nearMiss ? (
                <div className="nearMissCard">
                  <div className="nearMissCard__icon">&#x26A1;</div>
                  <div className="nearMissCard__body">
                    <div className="nearMissCard__title">아슬아슬!</div>
                    <div className="nearMissCard__text">{nearMiss}</div>
                  </div>
                </div>
              ) : null}

              {tags.length ? (
                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {tags.slice(0, 3).map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Win Probability */}
              {(() => {
                const latestRound = rounds.length ? (rounds[rounds.length - 1] as any) : null;
                const winProbA = Number(latestRound?.win_prob_a ?? (meta as any)?.win_prob_a ?? NaN);
                const winProbB = Number(latestRound?.win_prob_b ?? (meta as any)?.win_prob_b ?? NaN);
                if (!Number.isFinite(winProbA)) return null;
                const pctA = Math.max(0, Math.min(100, Math.round(winProbA * 100)));
                const effectiveB = Number.isFinite(winProbB) ? winProbB : 1 - winProbA;
                return (
                  <div className="arenaWinProb">
                    <span className="probName">{aName}</span>
                    <div className="probBar">
                      <div className="probFill probA" style={{ width: `${pctA}%` }} />
                    </div>
                    <span className="probName">{bName}</span>
                    {Math.abs(winProbA - 0.5) < 0.1 && <span className="probTag hot">박빙!</span>}
                    {winProbA > 0.65 && <span className="probTag favor">{aName} 유리</span>}
                    {effectiveB > 0.65 && <span className="probTag favor">{bName} 유리</span>}
                  </div>
                );
              })()}

              {/* Prediction */}
              {canPredict ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="muted awm-muted">
                    관중 예측(간단): 이길 쪽을 찍으면, 맞춘 사람끼리 코인을 나눠 가져요.
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {[
                      ["A", "a", aName],
                      ["B", "b", bName],
                    ].map(([label, pick, name]) => (
                      <button
                        key={String(pick)}
                        className={myPick === pick ? "btn primary" : "btn"}
                        type="button"
                        disabled={predictBusy}
                        onClick={async () => {
                          setPredictBusy(true);
                          setInterveneMsg(null);
                          try {
                            await arenaPredict(token, matchId, pick as any);
                            setMyPick(pick as any);
                            setInterveneMsg(`예측: ${name}`);
                          } catch (e: any) {
                            setInterveneMsg(friendlyError(e));
                          } finally {
                            setPredictBusy(false);
                          }
                        }}
                      >
                        예측 {label}: {name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Cheering */}
              {canCheer ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div className="muted awm-muted">
                      응원 버프(상한 3%): 응원 수가 승률에 아주 미세하게 반영돼요.
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <span className="badge">A {cheerA}</span>
                      <span className="badge">B {cheerB}</span>
                      {cheerDeltaA ? <span className="badge">ΔA {(cheerDeltaA * 100).toFixed(1)}%</span> : null}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button
                      className="btn"
                      type="button"
                      disabled={cheerBusy}
                      onClick={async () => {
                        setCheerBusy(true);
                        setInterveneMsg(null);
                        try {
                          await arenaCheer(token, matchId, "a");
                          const res = await arenaMatchDetail(token, matchId);
                          setMatch(res.match);
                        } catch (e: any) {
                          setInterveneMsg(friendlyError(e));
                        } finally {
                          setCheerBusy(false);
                        }
                      }}
                    >
                      응원 A
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={cheerBusy}
                      onClick={async () => {
                        setCheerBusy(true);
                        setInterveneMsg(null);
                        try {
                          await arenaCheer(token, matchId, "b");
                          const res = await arenaMatchDetail(token, matchId);
                          setMatch(res.match);
                        } catch (e: any) {
                          setInterveneMsg(friendlyError(e));
                        } finally {
                          setCheerBusy(false);
                        }
                      }}
                    >
                      응원 B
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Generic Intervention */}
              {canIntervene ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="muted awm-muted">
                    개입 창(30초): 내 펫의 힌트를 살짝 바꿀 수 있어요.
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {[
                      ["침착", "calm"],
                      ["공부", "study"],
                      ["공격", "aggressive"],
                      ["절약", "budget"],
                      ["충동금지", "impulse_stop"],
                      ["취소", "clear"],
                    ].map(([label, action]) => (
                      <button
                        key={String(action)}
                        className={action === "clear" ? "btn" : "btn primary"}
                        type="button"
                        disabled={interveneBusy}
                        onClick={() => handleIntervene(action)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Prediction Results */}
              {status === "resolved" && predict ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>예측 결과</div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {typeof predict.total === "number" ? <span className="badge">참여 {Number(predict.total) || 0}</span> : null}
                      {typeof predict.winners === "number" ? <span className="badge">정답 {Number(predict.winners) || 0}</span> : null}
                      {typeof predict.pot === "number" ? <span className="badge">팟 {Number(predict.pot) || 0}</span> : null}
                    </div>
                  </div>
                  {typeof predict.per_winner === "number" ? (
                    <div className="muted awm-muted" style={{ marginTop: 8 }}>
                      정답자 1인당 약 {Number(predict.per_winner) || 0} 코인
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Turn Timeline */}
              {status === "resolved" && rounds.length ? (
                <div style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <h3 className="awm-section-title" style={{ marginBottom: 0 }}>턴제 타임라인</h3>
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: mode === "COURT_TRIAL" ? 16 : 8 }}>
                    {(() => {
                      // 코칭 영향 라운드: 내 쪽 점수 델타가 가장 큰 라운드
                      const mySide = viewerId === castAId ? "a" : viewerId === castBId ? "b" : null;
                      const myCoachCount = Number(mySide ? trainingInfluence?.[mySide]?.coaching_fact_count : 0) || 0;
                      let coachImpactIdx = -1;
                      if (mySide && myCoachCount > 0) {
                        let bestDelta = -Infinity;
                        const key = mySide === "a" ? "a_score_delta" : "b_score_delta";
                        for (let ri = 0; ri < rounds.length; ri++) {
                          const d = Number((rounds[ri] as any)?.[key] ?? 0) || 0;
                          if (d > bestDelta) { bestDelta = d; coachImpactIdx = ri; }
                        }
                      }

                      let runA = 0, runB = 0;
                      const visibleCount = Math.min(effectiveReveal, 10);
                      return rounds.slice(0, visibleCount).map((r: any, idx: number) => {
                      const rn = Number(r?.round_num ?? idx + 1) || idx + 1;
                      const aAct = String(r?.a_action ?? "").trim();
                      const bAct = String(r?.b_action ?? "").trim();
                      const aD = Number(r?.a_score_delta ?? 0) || 0;
                      const bD = Number(r?.b_score_delta ?? 0) || 0;
                      const pA = Number(r?.win_prob_a ?? 0.5);
                      const pB = Number(r?.win_prob_b ?? 0.5);
                      const ms = String(r?.momentum_shift ?? "").trim();
                      const hl = String(r?.highlight ?? "").trim();
                      const pctA = Math.max(0, Math.min(100, Math.round(pA * 100)));
                      const pctB = Math.max(0, Math.min(100, 100 - pctA));

                      runA += aD; runB += bD;
                      const aLeads = runA > runB;
                      const bLeads = runB > runA;
                      const showCoachBadge = idx === coachImpactIdx;

                      const isLastRevealed = !skipReveal && idx === effectiveReveal - 1;

                      if (mode === "COURT_TRIAL") {
                        return (
                          <div key={`r${rn}`} ref={isLastRevealed ? revealBottomRef : undefined} className={`courtTurnCard${isLastRevealed ? " roundRevealing" : ""}${ms ? " courtTurnReversal" : ""}`}>
                            <div className="courtTurnHeader">
                              <span className="courtTurnRound">R{rn}</span>
                              <div className="courtTurnMeta">
                                <span className="courtTurnScore">{aName} +{aD}</span>
                                <span className="courtTurnScoreSep">·</span>
                                <span className="courtTurnScore">{bName} +{bD}</span>
                                {ms ? <span className="courtTurnMomentum">{ms}</span> : null}
                                {showCoachBadge ? <span className="courtTurnCoachBadge">코칭 영향</span> : null}
                              </div>
                            </div>
                            {idx === visibleCount - 1 ? (
                              <div className="courtCumulativeScore">
                                <span className={`courtCumulativeVal${aLeads ? " courtCumulativeVal--lead" : ""}`}>{aName} {runA}</span>
                                <span className="courtCumulativeVs">vs</span>
                                <span className={`courtCumulativeVal${bLeads ? " courtCumulativeVal--lead" : ""}`}>{bName} {runB}</span>
                              </div>
                            ) : null}
                            <div className="courtTurnArgs">
                              {aAct ? (
                                <div className="courtArgCard courtArgA">
                                  <div className="courtArgSide">{aName}</div>
                                  <div className="courtArgText">{aAct}</div>
                                </div>
                              ) : null}
                              {bAct ? (
                                <div className="courtArgCard courtArgB">
                                  <div className="courtArgSide">{bName}</div>
                                  <div className="courtArgText">{bAct}</div>
                                </div>
                              ) : null}
                            </div>
                            {hl ? <div className="courtTurnHighlight">{hl}</div> : null}
                            <div className="turnProbBar" style={{ marginTop: 8 }}>
                              <div className="turnProbFillA" style={{ width: `${pctA}%` }} />
                              <div className="turnProbFillB" style={{ width: `${pctB}%` }} />
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={`r${rn}`} className="event">
                          <div style={{ fontWeight: 600, fontSize: "var(--font-body)" }}>
                            R{rn}: {aName} +{aD} vs {bName} +{bD}
                          </div>
                        </div>
                      );
                    });
                    })()}
                  </div>

                  {/* Court closing arguments */}
                  {allRoundsRevealed && mode === "COURT_TRIAL" && (() => {
                    const ct = (meta as any)?.court_trial ?? {};
                    const aClosing = String(ct?.a_closing ?? "").trim();
                    const bClosing = String(ct?.b_closing ?? "").trim();
                    if (!aClosing && !bClosing) return null;
                    return (
                      <div className="courtClosingSection">
                        <div className="courtClosingTitle">최종 변론</div>
                        {aClosing ? (
                          <div className="courtArgCard courtArgA">
                            <div className="courtArgSide">{aName}</div>
                            <div className="courtArgText">{aClosing}</div>
                          </div>
                        ) : null}
                        {bClosing ? (
                          <div className="courtArgCard courtArgB">
                            <div className="courtArgSide">{bName}</div>
                            <div className="courtArgText">{bClosing}</div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {/* Participants — 1줄 요약 */}
              <div style={{ display: "grid", gap: 8 }}>
                {[a, b].filter(Boolean).map((p: any, i: number) => {
                  const name = String(p?.agent?.displayName ?? p?.agent?.name ?? "").trim() || `P${i + 1}`;
                  const outcome = String(p?.outcome ?? "").trim();
                  const coinsNet = Number(p?.coinsNet ?? 0) || 0;
                  const ratingDelta = Number(p?.ratingDelta ?? 0) || 0;
                  return (
                    <div key={String(p?.agent?.id ?? `${name}:${i}`)} className="event">
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>{name}</span>
                          {outcome ? <span className="badge">{outcome}</span> : null}
                          {!outcome && status === "live" ? <span className="badge">대기 중</span> : null}
                        </div>
                        <span className="muted awm-muted">
                          {coinsNet || ratingDelta
                            ? `${coinsNet > 0 ? "+" : ""}${coinsNet} 코인 · 레이팅 ${ratingDelta > 0 ? "+" : ""}${ratingDelta}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Game Boards — Mode-specific visualization */}
              {mode === "DEBATE_CLASH" ? <DebateBoard meta={meta} aName={aName} bName={bName} /> : null}
              {mode === "COURT_TRIAL" ? (
                <CourtBoard
                  meta={meta}
                  aName={aName}
                  bName={bName}
                  status={status}
                  matchId={matchId}
                  onVote={async (vote) => {
                    try {
                      const res = await petArenaVote(token, matchId, vote);
                      setCourtVote(vote);
                      setCourtVoteResult({ fair_count: res.vote_result.fair, unfair_count: res.vote_result.unfair });
                    } catch (e: any) {
                      setInterveneMsg(friendlyError(e));
                    }
                  }}
                  userVote={courtVote}
                  voteResult={courtVoteResult}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
