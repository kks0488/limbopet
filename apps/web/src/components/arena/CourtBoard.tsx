import React from "react";

interface CourtBoardProps {
  meta: any;
  aName: string;
  bName: string;
  status: string;
  matchId?: string;
  onVote?: (vote: "fair" | "unfair") => void;
  userVote?: string | null;
  voteResult?: { fair_count: number; unfair_count: number } | null;
}

export function CourtBoard({ meta, aName, bName, status, matchId, onVote, userVote, voteResult }: CourtBoardProps) {
  // resolved → court_trial, live → court_preview
  const ct = meta?.court_trial ?? meta?.court_preview ?? null;
  if (!ct) return null;

  const title = String(ct.title ?? "").trim();
  const charge = String(ct.charge ?? "").trim();
  const facts = Array.isArray(ct.facts) ? ct.facts : [];
  const statute = String(ct.statute ?? "").trim();
  const correctVerdict = String(ct.correct_verdict ?? "").trim();
  const isResolved = status === "resolved";

  // Phase 3: 실제 판례 기반 필드
  const category = String(ct.category ?? "").trim();
  const difficulty = Number(ct.difficulty ?? 0) || 0;
  const actualVerdict = String(ct.actual_verdict ?? "").trim();
  const actualReasoning = String(ct.actual_reasoning ?? "").trim();
  const learningPoints = Array.isArray(ct.learning_points) ? ct.learning_points : [];
  const isRealCase = Boolean(ct.is_real_case);

  return (
    <div className="gameBoard courtBoard">
      <h3 className="gameBoardTitle">
        재판
        {isRealCase ? <span className="badge" style={{ marginLeft: 8, background: "rgba(10, 132, 255, 0.3)", borderColor: "rgba(10, 132, 255, 0.5)", color: "#7ac4ff" }}>실제 판례</span> : null}
      </h3>

      {/* 실제 판례 면책조항 — 항상 표시 */}
      {isRealCase ? (
        <div className="courtDisclaimer" style={{ marginBottom: 12 }}>
          실제 판례 기반 교육 콘텐츠입니다. 법률 자문을 대체하지 않습니다.
        </div>
      ) : null}

      {/* 사건 브리핑 */}
      <div className="courtBriefing">
        <div className="courtCaseTitle">{title}</div>
        <div className="courtCharge">혐의: {charge}</div>
        {category ? <span className="badge">{category}</span> : null}
        {difficulty ? (
          <span className="badge">{"★".repeat(difficulty)}{"☆".repeat(Math.max(0, 3 - difficulty))}</span>
        ) : null}
      </div>

      {/* 증거 카드 */}
      {facts.length > 0 ? (
        <div className="courtEvidence">
          <div className="courtEvidenceTitle">증거/사실관계</div>
          {facts.slice(0, 12).map((f: any, i: number) => (
            <div key={i} className="courtEvidenceCard">
              <span className="courtEvidenceNum">#{i + 1}</span>
              <span>{String(f)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {statute ? (
        <div className="courtStatute">
          <span className="courtStatuteLabel">적용 법률/규칙:</span> {statute}
        </div>
      ) : null}

      {/* 양측 판결 — resolved만 */}
      {isResolved && (meta?.court_trial?.a || meta?.court_trial?.b) ? (
        <>
          <div className="gameBoardColumns">
            {[
              { name: aName, side: meta.court_trial.a, label: "A" },
              { name: bName, side: meta.court_trial.b, label: "B" },
            ].map(({ name, side, label }) => {
              const verdict = String(side?.verdict ?? "?");
              const correct = Boolean(side?.correct);
              const timeMs = Number(side?.time_ms ?? 0) || 0;
              return (
                <div key={label} className="gameBoardColumn">
                  <div className="gameBoardColumnHeader">
                    <span className="gameBoardSide">{name}</span>
                  </div>
                  <div className="courtVerdict">
                    <span className={`courtVerdictBadge ${correct ? "correct" : "wrong"}`}>
                      {verdict}
                    </span>
                    <span className={`badge ${correct ? "" : "bad"}`}>{correct ? "정답" : "오답"}</span>
                    <span className="badge">{timeMs}ms</span>
                  </div>
                </div>
              );
            })}
          </div>

          {correctVerdict ? (
            <div className="courtCorrectVerdict">
              정답 판결: <strong>{correctVerdict}</strong>
            </div>
          ) : null}

          {/* 실제 판례 비교 (Phase 3) */}
          {isRealCase && actualVerdict ? (
            <div className="courtRealComparison">
              <div className="courtRealTitle">실제 법원 판결</div>
              <div className="courtRealVerdict">{actualVerdict}</div>
              {actualReasoning ? (
                <div className="courtRealReasoning">{actualReasoning}</div>
              ) : null}
            </div>
          ) : null}

          {/* 학습 포인트 (Phase 3) */}
          {learningPoints.length > 0 ? (
            <div className="courtLearning">
              <div className="courtLearningTitle">학습 포인트</div>
              {learningPoints.map((lp: any, i: number) => (
                <div key={i} className="courtLearningItem">
                  {String(lp)}
                </div>
              ))}
            </div>
          ) : null}

          {/* 공정성 투표 (Phase 3) */}
          {isRealCase && isResolved && onVote ? (
            <div className="courtVoteSection">
              <div className="courtVoteTitle">이 판결이 공정했다고 생각하시나요?</div>
              <div className="row" style={{ gap: 8, justifyContent: "center" }}>
                <button
                  className={`btn courtVoteBtn ${userVote === "fair" ? "active" : ""}`}
                  onClick={() => onVote("fair")}
                  disabled={!!userVote}
                >
                  👍 공정하다
                </button>
                <button
                  className={`btn courtVoteBtn ${userVote === "unfair" ? "active" : ""}`}
                  onClick={() => onVote("unfair")}
                  disabled={!!userVote}
                >
                  👎 불공정하다
                </button>
              </div>
              {voteResult ? (
                <div className="courtVoteResult">
                  공정 {voteResult.fair_count} · 불공정 {voteResult.unfair_count}
                </div>
              ) : null}
            </div>
          ) : null}

        </>
      ) : !isResolved ? (
        <div className="gameBoardPending">양측이 판결을 준비 중입니다...</div>
      ) : null}
    </div>
  );
}
