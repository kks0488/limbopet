import React, { useEffect, useState } from "react";
import {
  arenaMatchDetail,
  arenaIntervene,
  arenaPredict,
  arenaCheer,
  petArenaVote,
  type ArenaMatchDetail,
  type ArenaMatchMeta,
} from "../lib/api";
import { DebateBoard } from "./arena/DebateBoard";
import { CourtBoard } from "./arena/CourtBoard";
import { AuctionBoard } from "./arena/AuctionBoard";
import { MathBoard } from "./arena/MathBoard";
import { PuzzleBoard } from "./arena/PuzzleBoard";
import { PromptBoard } from "./arena/PromptBoard";
import { StrategyBriefing } from "./arena/StrategyBriefing";

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
        setError(String((e as any)?.message ?? e));
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
    const t = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!match) return;
    const meta = match?.meta && typeof match.meta === "object" ? (match.meta as any) : {};
    const live = meta?.live && typeof meta.live === "object" ? (meta.live as any) : null;
    const endsAtMs = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
    const isLive = String(match?.status ?? "").trim().toLowerCase() === "live" && Number.isFinite(endsAtMs);
    if (!isLive) return;

    let cancelled = false;
    const tick = async () => {
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
  }, [match, token, matchId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
  const recentMemoryInfluence = meta?.recent_memory_influence && typeof meta.recent_memory_influence === "object"
    ? (meta.recent_memory_influence as any)
    : {};
  const promptProfile = meta?.prompt_profile && typeof meta.prompt_profile === "object"
    ? (meta.prompt_profile as any)
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

  const handleIntervene = async (action: string) => {
    setInterveneBusy(true);
    setInterveneMsg(null);
    try {
      await arenaIntervene(token, matchId, action as any);
      setInterveneMsg(`개입: ${action}`);
      const res = await arenaMatchDetail(token, matchId);
      setMatch(res.match);
    } catch (e: any) {
      setInterveneMsg(String(e?.message ?? e));
    } finally {
      setInterveneBusy(false);
    }
  };

  const handleModeIntervene = async (action: string, _boosts: Record<string, number>) => {
    setInterveneBusy(true);
    setInterveneMsg(null);
    try {
      await arenaIntervene(token, matchId, action as any);
      setInterveneMsg(`전략: ${action}`);
      const res = await arenaMatchDetail(token, matchId);
      setMatch(res.match);
    } catch (e: any) {
      setInterveneMsg(String(e?.message ?? e));
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
            <div style={{ fontWeight: 800, fontSize: 16 }}>경기 관전</div>
            <div className="row" style={{ gap: 8 }}>
              <span className="kbdHint">ESC</span>
              <button className="btn" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>

          {match ? (
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              {match.day ? <span className="badge">{match.day}</span> : null}
              {match.slot ? <span className="badge">#{match.slot}</span> : null}
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
            <div className="empty">가져오는 중...</div>
          ) : !match ? (
            <div className="empty">경기를 찾지 못했어요.</div>
          ) : (
            <>
              {headline ? <div style={{ fontWeight: 800, marginBottom: 12 }}>{headline}</div> : null}
              {nearMiss || tags.length ? (
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {nearMiss ? <span className="badge">니어미스 {nearMiss}</span> : null}
                  {tags.slice(0, 8).map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}

              {(() => {
                const renderInfluenceCard = (
                  sideName: string,
                  t: any,
                  m: any,
                  p: any,
                ) => {
                  const weights = t?.weights && typeof t.weights === "object" ? (t.weights as any) : {};
                  const dominant = Array.isArray(weights?.dominant)
                    ? (weights.dominant as any[]).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 2)
                    : [];
                  const memoryScore = Number(m?.score ?? 0) || 0;
                  const memoryCount = Number(m?.count ?? 0) || 0;
                  const refs = Array.isArray(m?.refs) ? (m.refs as any[]).slice(0, 2) : [];
                  const promptEnabled = Boolean(p?.enabled);
                  const promptCustom = Boolean(p?.has_custom);
                  const promptVersion = Number(p?.version ?? 0) || 0;
                  const intervention = String(t?.intervention ?? "").trim();

                  return (
                    <div key={sideName} className="event" style={{ minWidth: 260 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>{sideName}</div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          {dominant.length ? <span className="badge">훈련 {dominant.join("·")}</span> : null}
                          <span className="badge">메모리 {memoryCount}개</span>
                          <span className="badge">점수 {memoryScore.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <span className="badge">프롬프트 {promptEnabled ? "ON" : "OFF"}</span>
                        <span className="badge">{promptCustom ? "커스텀" : "기본"}</span>
                        {promptVersion > 0 ? <span className="badge">v{promptVersion}</span> : null}
                        {intervention ? <span className="badge">개입 {intervention}</span> : null}
                      </div>
                      {refs.length ? (
                        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                          {refs.map((r, idx) => {
                            const kind = String(r?.kind ?? "").trim();
                            const text = String(r?.text ?? "").trim();
                            if (!text) return null;
                            return (
                              <div key={`${sideName}:${idx}`} className="muted" style={{ fontSize: 12 }}>
                                {kind ? `[${kind}] ` : ""}{text}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                };

                const hasAny =
                  trainingInfluence?.a ||
                  trainingInfluence?.b ||
                  recentMemoryInfluence?.a ||
                  recentMemoryInfluence?.b ||
                  promptProfile?.a ||
                  promptProfile?.b;
                if (!hasAny) return null;
                return (
                  <div style={{ marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 14 }}>코칭/메모리 영향도</h3>
                    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      {renderInfluenceCard(aName, trainingInfluence?.a, recentMemoryInfluence?.a, promptProfile?.a)}
                      {renderInfluenceCard(bName, trainingInfluence?.b, recentMemoryInfluence?.b, promptProfile?.b)}
                    </div>
                  </div>
                );
              })()}

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
                  <div className="muted" style={{ fontSize: 12 }}>
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
                            setInterveneMsg(String(e?.message ?? e));
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
                    <div className="muted" style={{ fontSize: 12 }}>
                      응원 버프(상한 3%): 응원 수가 승률에 아주 미세하게 반영돼요.
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
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
                          setInterveneMsg(String(e?.message ?? e));
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
                          setInterveneMsg(String(e?.message ?? e));
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
                  <div className="muted" style={{ fontSize: 12 }}>
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

              {/* Strategy Briefing — 라이브 매치 전략 선택 (핵심 개입 UI) */}
              {canIntervene && mode ? (
                <StrategyBriefing
                  mode={mode}
                  meta={meta}
                  remainingMs={remainingMs}
                  busy={interveneBusy}
                  onSelectStrategy={(action) => handleModeIntervene(action, {})}
                />
              ) : null}

              {/* Prediction Results */}
              {status === "resolved" && predict ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>예측 결과</div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {typeof predict.total === "number" ? <span className="badge">참여 {Number(predict.total) || 0}</span> : null}
                      {typeof predict.winners === "number" ? <span className="badge">정답 {Number(predict.winners) || 0}</span> : null}
                      {typeof predict.pot === "number" ? <span className="badge">팟 {Number(predict.pot) || 0}</span> : null}
                    </div>
                  </div>
                  {typeof predict.per_winner === "number" ? (
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      정답자 1인당 약 {Number(predict.per_winner) || 0} 코인
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Turn Timeline */}
              {status === "resolved" && rounds.length ? (
                <div style={{ marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>턴제 타임라인</h3>
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {rounds.slice(0, 10).map((r: any, idx: number) => {
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
                      return (
                        <div key={`r${rn}`} className="event">
                          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <span className="badge">R{rn}</span>
                              {ms ? <span className="badge">{ms}</span> : null}
                              {hl ? <span className="badge">{hl}</span> : null}
                            </div>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <span className="badge">A +{aD}</span>
                              <span className="badge">B +{bD}</span>
                            </div>
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <div
                              style={{
                                height: 10,
                                borderRadius: 999,
                                overflow: "hidden",
                                background: "rgba(255,255,255,0.08)",
                                display: "flex",
                              }}
                            >
                              <div style={{ width: `${pctA}%`, background: "rgba(80,180,255,0.85)" }} />
                              <div style={{ width: `${pctB}%`, background: "rgba(255,120,120,0.75)" }} />
                            </div>
                            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                A {pctA}% · {aAct || "—"}
                              </div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                B {Math.round(pB * 100)}% · {bAct || "—"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Participants */}
              <div style={{ display: "grid", gap: 10 }}>
                {[a, b].filter(Boolean).map((p: any, i: number) => {
                  const name = String(p?.agent?.displayName ?? p?.agent?.name ?? "").trim() || `P${i + 1}`;
                  const outcome = String(p?.outcome ?? "").trim();
                  const coinsNet = Number(p?.coinsNet ?? 0) || 0;
                  const ratingDelta = Number(p?.ratingDelta ?? 0) || 0;
                  const wager = Number(p?.wager ?? 0) || 0;
                  const feeBurned = Number(p?.feeBurned ?? 0) || 0;
                  return (
                    <div key={String(p?.agent?.id ?? `${name}:${i}`)} className="event">
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>{name}</span>
                          {outcome ? <span className="badge">{outcome}</span> : null}
                          {!outcome && status === "live" ? <span className="badge">대기 중</span> : null}
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          {partsRaw.length >= 2 ? (
                            <>
                              <span className="badge">coin {coinsNet > 0 ? `+${coinsNet}` : coinsNet}</span>
                              <span className="badge">rating {ratingDelta > 0 ? `+${ratingDelta}` : ratingDelta}</span>
                              <span className="badge">wager {wager}</span>
                              <span className="badge">fee {feeBurned}</span>
                            </>
                          ) : meta?.stake ? (
                            <>
                              <span className="badge">wager {Number(meta?.stake?.wager ?? 0) || 0}</span>
                              <span className="badge">fee {Number(meta?.stake?.fee_burned ?? 0) || 0}</span>
                            </>
                          ) : null}
                        </div>
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
                      setCourtVoteResult({ fair_count: res.fair_count, unfair_count: res.unfair_count });
                    } catch (e: any) {
                      setInterveneMsg(String(e?.message ?? e));
                    }
                  }}
                  userVote={courtVote}
                  voteResult={courtVoteResult}
                />
              ) : null}
              {mode === "AUCTION_DUEL" ? <AuctionBoard meta={meta} aName={aName} bName={bName} /> : null}
              {mode === "MATH_RACE" ? <MathBoard meta={meta} aName={aName} bName={bName} /> : null}
              {mode === "PUZZLE_SPRINT" ? <PuzzleBoard meta={meta} aName={aName} bName={bName} /> : null}
              {mode === "PROMPT_BATTLE" ? <PromptBoard meta={meta} aName={aName} bName={bName} /> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
