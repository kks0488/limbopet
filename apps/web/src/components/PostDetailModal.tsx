import { useEffect, useRef, useState } from "react";
import {
  plazaPostDetail,
  plazaPostComments,
  plazaCreateComment,
  type PlazaPostDetail,
  type PlazaComment,
} from "../lib/api";
import { friendlyError } from "../lib/errorMessages";
import { parseArenaRecap, modeLabel, type ParsedArenaRecap } from "../lib/arenaRecapParser";

function formatShortTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

/* ── Arena structured detail renderer ── */

function ArenaDetailContent({ recap, meta }: { recap: ParsedArenaRecap; meta: Record<string, unknown> }) {
  const { participantA, participantB, courtTrial, debateClash, rounds, cheer, stake, nearMiss, revenge, spotlightTags } = recap;
  const nameA = participantA || "A";
  const nameB = participantB || "B";
  const winner = String(meta?.winner ?? "").trim();
  const modeName = modeLabel(recap.mode);

  return (
    <div className="arenaDetailWrap">
      {/* Result banner */}
      <div className="arenaDetailBanner">
        <div className="arenaDetailBannerMode">{modeName}</div>
        <div className="arenaDetailBannerResult">
          {winner ? (
            <><span className="arenaDetailWinnerName">{winner}</span> 승리</>
          ) : (
            "결과 집계중"
          )}
        </div>
        <div className="arenaDetailBannerVs">
          <span className={`arenaDetailPlayerTag${winner === nameA ? " winner" : ""}`}>{nameA}</span>
          <span className="arenaDetailVsLabel">vs</span>
          <span className={`arenaDetailPlayerTag${winner === nameB ? " winner" : ""}`}>{nameB}</span>
        </div>
      </div>

      {/* Stake info */}
      {stake && (stake.wager > 0 || stake.toWinner > 0) ? (
        <div className="arenaDetailStake">
          {stake.wager > 0 ? <span>판돈 {stake.wager}</span> : null}
          {stake.toWinner > 0 ? <span>승자 보상 {stake.toWinner}</span> : null}
          {stake.feeBurn > 0 ? <span>수수료 {stake.feeBurn}</span> : null}
        </div>
      ) : null}

      {/* Near miss */}
      {nearMiss ? <div className="arenaDetailNearMiss">아슬아슬: {nearMiss}</div> : null}

      {/* Spotlight tags */}
      {spotlightTags.length > 0 ? (
        <div className="arenaDetailSpotlight">
          {spotlightTags.map((t) => (
            <span key={t} className="arenaFeedTag">{t}</span>
          ))}
        </div>
      ) : null}

      {/* Court Trial detail */}
      {courtTrial ? (
        <div className="arenaDetailSection">
          <div className="arenaDetailSectionTitle">재판 내용</div>
          {courtTrial.caseTitle ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">무슨 일이냐면</span>
              <span>{courtTrial.caseTitle}</span>
            </div>
          ) : null}
          {courtTrial.charge ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">쟁점</span>
              <span>{courtTrial.charge}</span>
            </div>
          ) : null}
          {courtTrial.facts.length > 0 ? (
            <div className="arenaDetailRow arenaDetailRowBlock">
              <span className="arenaDetailLabel">상황 정리</span>
              <ul className="arenaDetailFactList">
                {courtTrial.facts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {courtTrial.statute ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">판단 기준</span>
              <span>{courtTrial.statute}</span>
            </div>
          ) : null}
          {courtTrial.correctVerdict ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">정답</span>
              <span className="arenaDetailCorrectAnswer">{courtTrial.correctVerdict}</span>
            </div>
          ) : null}
          {courtTrial.aLine ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">{nameA}</span>
              <span>{formatTrialPerf(courtTrial.aLine, nameA)}</span>
            </div>
          ) : null}
          {courtTrial.bLine ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">{nameB}</span>
              <span>{formatTrialPerf(courtTrial.bLine, nameB)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Debate Clash detail */}
      {debateClash ? (
        <div className="arenaDetailSection">
          <div className="arenaDetailSectionTitle">설전 내용</div>
          {debateClash.topic ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">주제</span>
              <span>{debateClash.topic}</span>
            </div>
          ) : null}
          {debateClash.rule ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">규칙</span>
              <span>{debateClash.rule}</span>
            </div>
          ) : null}
          {debateClash.judge ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">판정</span>
              <span>{debateClash.judge}</span>
            </div>
          ) : null}

          {/* Score comparison */}
          <div className="arenaDetailScoreGrid">
            <div className="arenaDetailScoreHeader">
              <span></span>
              <span>{nameA}</span>
              <span>{nameB}</span>
            </div>
            <div className="arenaDetailScoreRow">
              <span className="arenaDetailLabel">입장</span>
              <span>{debateClash.aStance || "-"}</span>
              <span>{debateClash.bStance || "-"}</span>
            </div>
            <div className="arenaDetailScoreRow">
              <span className="arenaDetailLabel">논리력</span>
              <span>{debateClash.aLogic}</span>
              <span>{debateClash.bLogic}</span>
            </div>
            <div className="arenaDetailScoreRow">
              <span className="arenaDetailLabel">침착함</span>
              <span>{debateClash.aCalm}</span>
              <span>{debateClash.bCalm}</span>
            </div>
            <div className="arenaDetailScoreRow">
              <span className="arenaDetailLabel">임팩트</span>
              <span>{debateClash.aImpact}</span>
              <span>{debateClash.bImpact}</span>
            </div>
            <div className="arenaDetailScoreRow arenaDetailScoreTotal">
              <span className="arenaDetailLabel">종합</span>
              <span>{debateClash.aTotal}</span>
              <span>{debateClash.bTotal}</span>
            </div>
          </div>

          {/* Claims */}
          {debateClash.aClaims.length > 0 ? (
            <div className="arenaDetailClaims">
              <div className="arenaDetailClaimsTitle">{nameA} 핵심 주장</div>
              <ul>
                {debateClash.aClaims.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          ) : null}
          {debateClash.bClaims.length > 0 ? (
            <div className="arenaDetailClaims">
              <div className="arenaDetailClaimsTitle">{nameB} 핵심 주장</div>
              <ul>
                {debateClash.bClaims.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          ) : null}

          {/* Closers */}
          {debateClash.aCloser ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">{nameA} 결정타</span>
              <span>{debateClash.aCloser}</span>
            </div>
          ) : null}
          {debateClash.bCloser ? (
            <div className="arenaDetailRow">
              <span className="arenaDetailLabel">{nameB} 결정타</span>
              <span>{debateClash.bCloser}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Rounds — collapsible */}
      {rounds.length > 0 ? (
        <details className="arenaDetailRoundsToggle">
          <summary className="arenaDetailRoundsSummary">
            라운드별 하이라이트 ({rounds.length}라운드)
          </summary>
          <div className="arenaDetailRoundsList">
            {rounds.map((r) => (
              <div key={r.roundNum} className="arenaDetailRoundItem">
                <div className="arenaDetailRoundNum">R{r.roundNum}</div>
                <div className="arenaDetailRoundBody">
                  <div className="arenaDetailRoundScore">
                    {r.lead} <span className="mono">({r.scoreA}:{r.scoreB})</span>
                  </div>
                  {r.highlight ? <div className="arenaDetailRoundHighlight">{r.highlight}</div> : null}
                  {r.momentum ? <div className="arenaDetailRoundMomentum">{r.momentum}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/* Cheer data */}
      {cheer && (cheer.aCount > 0 || cheer.bCount > 0) ? (
        <div className="arenaDetailCheer">
          <div className="arenaDetailSectionTitle">응원</div>
          <div className="arenaDetailCheerCounts">
            <span>{nameA} {cheer.aCount}표</span>
            <span>{nameB} {cheer.bCount}표</span>
          </div>
          {cheer.bestCheer ? (
            <div className="arenaDetailBestCheer">베스트 응원: {cheer.bestCheer}</div>
          ) : null}
        </div>
      ) : null}

      {/* Revenge */}
      {revenge ? (
        <div className="arenaDetailRevenge">복수전: {revenge}</div>
      ) : null}
    </div>
  );
}

function formatTrialPerf(line: string, _name: string): string {
  // "Name: verdict (정답/오답, Xms)" -> "verdict (정답, Xms)"
  const colonIdx = line.indexOf(": ");
  if (colonIdx >= 0) {
    return line.slice(colonIdx + 2);
  }
  return line;
}

/* ── Main modal component ── */

export function PostDetailModal({
  token,
  postId,
  onClose,
  onUpvote,
  onOpenMatch,
  onAfterMutate,
}: {
  token: string;
  postId: string;
  onClose: () => void;
  onUpvote: ((postId: string) => void) | null;
  onOpenMatch: (matchId: string) => void;
  onAfterMutate?: (() => void | Promise<void>) | null;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => { modalRef.current?.focus(); });
    return () => {
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, []);

  const [loading, setLoading] = useState(true);
  const [post, setPost] = useState<PlazaPostDetail | null>(null);
  const [viewer, setViewer] = useState<{ has_pet: boolean; my_vote: number | null } | null>(null);
  const [comments, setComments] = useState<PlazaComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; author: string } | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  async function reloadPost() {
    const d = await plazaPostDetail(token, postId);
    setPost(d.post);
    setViewer(d.viewer);
  }

  async function reloadComments() {
    const res = await plazaPostComments(token, postId, { sort: "top", limit: 200 });
    setComments(res.comments || []);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPost(null);
    setViewer(null);
    setComments([]);

    Promise.all([plazaPostDetail(token, postId), plazaPostComments(token, postId, { sort: "top", limit: 200 })])
      .then(([d, c]) => {
        if (cancelled) return;
        setPost(d.post);
        setViewer(d.viewer);
        setComments(c.comments || []);
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
  }, [token, postId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const meta = post?.meta && typeof post.meta === "object" ? (post.meta as any) : {};
  const refType = String(meta?.ref_type ?? "").trim();
  const refId = String(meta?.ref_id ?? "").trim();
  const canWatch = refType === "arena_match" && Boolean(refId);

  const author = post?.author_display_name || post?.author_name || "unknown";
  const ts = post?.created_at ? formatShortTime(post.created_at) : "";
  const score = Number(post?.score ?? 0) || 0;
  const commentCount = Number(post?.comment_count ?? 0) || 0;

  const canComment = Boolean(viewer?.has_pet);
  const canUpvote = Boolean(viewer?.has_pet && onUpvote);

  const isArena = post?.post_type === "arena";
  const arenaRecap = isArena ? parseArenaRecap(String(post?.content ?? "")) : null;

  return (
    <div
      ref={modalRef}
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="글 상세"
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modalHeader">
          <div className="post-detail-header-row">
            <div className="post-detail-title">{post?.title || "\uAE00"}</div>
            <div className="post-detail-close-group">
              <span className="kbdHint">ESC</span>
              <button className="btn" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>

          <div className="post-detail-meta-row">
            <span className="badge">{author}</span>
            {ts ? <span className="badge">{ts}</span> : null}
            <span className="badge">👍 {score}</span>
            <span className="badge">💬 {commentCount}</span>
            {canWatch ? (
              <button className="btn" type="button" onClick={() => onOpenMatch(refId)} disabled={loading}>
                경기 관전
              </button>
            ) : null}
            {post?.id ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (!post?.id || !canUpvote) return;
                  void (async () => {
                    setVoteBusy(true);
                    setError(null);
                    try {
                      await Promise.resolve(onUpvote?.(post.id));
                      await reloadPost();
                    } catch (e: any) {
                      setError(friendlyError(e));
                    } finally {
                      setVoteBusy(false);
                    }
                  })();
                }}
                disabled={loading || !canUpvote || voteBusy}
              >
                좋아요
              </button>
            ) : null}
          </div>
        </div>

        <div className="modalBody">
          {error ? <div className="toast bad">{error}</div> : null}

          {loading ? (
            <div className="arenaLoadingSkeleton">
              <div className="skeletonLine skeletonWide" />
              <div className="skeletonLine skeletonMedium" />
              <div className="skeletonBlock" />
              <div className="skeletonLine skeletonShort" />
            </div>
          ) : (
            <>
              {isArena && arenaRecap ? (
                <ArenaDetailContent recap={arenaRecap} meta={meta} />
              ) : (
                <div className="post-detail-content">{String(post?.content ?? "")}</div>
              )}

              <div className="post-detail-comments">
                <div className="post-detail-comments-header">
                  <h3 className="post-detail-comments-title">댓글</h3>
                  <span className="post-detail-comments-count">
                    {comments.length}개
                  </span>
                </div>

                <div className="post-detail-comments-list">
                  {comments.length === 0 ? (
                    <div className="emptyStateBox" style={{ padding: "20px 16px" }}>
                      <div className="emptyStateEmoji">{"\uD83D\uDCAC"}</div>
                      <div className="emptyStateDesc">&#xC544;&#xC9C1; &#xB313;&#xAE00;&#xC774; &#xC5C6;&#xC5B4;&#xC694;. &#xCCAB; &#xB9C8;&#xB514;&#xB97C; &#xB0A8;&#xACA8; &#xBCF4;&#xC138;&#xC694;!</div>
                    </div>
                  ) : (
                    (() => {
                      const nodes: React.ReactNode[] = [];
                      const walk = (c: PlazaComment) => {
                        const cAuthor = c.author_display_name || c.author_name || "unknown";
                        const cTs = formatShortTime(c.created_at);
                        nodes.push(
                          <div key={c.id} className={`comment post-detail-comment-depth-${Math.min(Number(c.depth ?? 0) || 0, 10)}`}>
                            <div className="meta">
                              <span>{cAuthor}</span>
                              <span>{cTs}</span>
                            </div>
                            <div className="post-detail-comment-body">{c.content}</div>
                            <div className="post-detail-comment-actions">
                              <span className="badge">👍 {Number(c.score ?? 0) || 0}</span>
                              {canComment ? (
                                <button
                                  className="btn btnSmall"
                                  type="button"
                                  onClick={() => {
                                    setReplyTo({ id: c.id, author: cAuthor });
                                    setReplyDraft("");
                                  }}
                                  disabled={commentBusy}
                                >
                                  답글
                                </button>
                              ) : null}
                            </div>
                            {replyTo?.id === c.id ? (
                              <div className="post-detail-reply-form">
                                <textarea
                                  className="post-detail-reply-textarea"
                                  value={replyDraft}
                                  onChange={(e) => setReplyDraft(e.target.value)}
                                  placeholder={`${cAuthor}에게 답글...`}
                                  disabled={commentBusy}
                                  rows={2}
                                  aria-label={`${cAuthor}에게 답글`}
                                />
                                <button
                                  className="btn primary btnSmall"
                                  type="button"
                                  onClick={async () => {
                                    const content = replyDraft.trim();
                                    if (!content) return;
                                    setCommentBusy(true);
                                    setError(null);
                                    try {
                                      await plazaCreateComment(token, postId, { content, parent_id: c.id });
                                      setReplyDraft("");
                                      setReplyTo(null);
                                      await reloadComments();
                                      await reloadPost();
                                      await Promise.resolve(onAfterMutate?.());
                                    } catch (e: any) {
                                      setError(friendlyError(e));
                                    } finally {
                                      setCommentBusy(false);
                                    }
                                  }}
                                  disabled={commentBusy || !replyDraft.trim()}
                                >
                                  등록
                                </button>
                                <button
                                  className="btn btnSmall"
                                  type="button"
                                  onClick={() => setReplyTo(null)}
                                  disabled={commentBusy}
                                >
                                  취소
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                        for (const r of c.replies || []) walk(r);
                      };
                      for (const c of comments) walk(c);
                      return nodes;
                    })()
                  )}
                </div>

                <div className="post-detail-write-section">
                  <div className="post-detail-write-label">
                    댓글 작성 (최상단)
                  </div>
                  {!canComment ? (
                    <div className="post-detail-write-hint">
                      댓글을 쓰려면 펫이 필요해요.
                    </div>
                  ) : null}
                  <div className="post-detail-write-form">
                    <textarea
                      className="post-detail-write-textarea"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="한마디 남겨볼까?"
                      disabled={!canComment || commentBusy}
                      aria-label="댓글 작성"
                    />
                    <button
                      className="btn primary"
                      type="button"
                      onClick={async () => {
                        if (!canComment) return;
                        const content = commentDraft.trim();
                        if (!content) return;
                        setCommentBusy(true);
                        setError(null);
                        try {
                          await plazaCreateComment(token, postId, { content });
                          setCommentDraft("");
                          await reloadComments();
                          await reloadPost();
                          await Promise.resolve(onAfterMutate?.());
                        } catch (e: any) {
                          setError(friendlyError(e));
                        } finally {
                          setCommentBusy(false);
                        }
                      }}
                      disabled={!canComment || commentBusy || !commentDraft.trim()}
                    >
                      등록
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
