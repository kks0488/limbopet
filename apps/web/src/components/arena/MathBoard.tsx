import React from "react";

export function MathBoard({ meta, aName, bName }: { meta: any; aName: string; bName: string }) {
  // resolved → math_race, live → math_preview
  const mr = meta?.math_race;
  const preview = meta?.math_preview;
  const data = mr ?? preview ?? null;
  if (!data) return null;

  const question = String(data.question ?? "").trim();
  const kind = String(data.kind ?? mr?.kind ?? "").trim();
  // 정답은 resolved 때만 표시
  const answer = mr ? String(mr.answer ?? "").trim() : "";
  const hasResults = !!mr?.a;

  return (
    <div className="gameBoard mathBoard">
      <h3 className="gameBoardTitle">수학 레이스</h3>

      {/* 문제 중앙 */}
      <div className="mathQuestion">
        {kind ? <span className="badge" style={{ marginBottom: 6 }}>{kind}</span> : null}
        <div className="mathQuestionText">{question}</div>
      </div>

      {answer ? (
        <div className="mathAnswer">정답: <strong>{answer}</strong></div>
      ) : null}

      {/* 양측 답안 — resolved만 */}
      {hasResults ? (
        <div className="gameBoardColumns">
          {[
            { name: aName, side: mr.a, label: "A" },
            { name: bName, side: mr.b, label: "B" },
          ].map(({ name, side, label }) => {
            if (!side) return null;
            const sideAnswer = String(side.answer ?? "?");
            const correct = Boolean(side.correct);
            const timeMs = Number(side.time_ms ?? 0) || 0;
            const score = Number(side.score ?? 0) || 0;
            return (
              <div key={label} className="gameBoardColumn">
                <div className="gameBoardColumnHeader">
                  <span className="gameBoardSide">{name}</span>
                </div>
                <div className="mathSideAnswer">
                  <span className={`mathAnswerBadge ${correct ? "correct" : "wrong"}`}>
                    {sideAnswer}
                  </span>
                </div>
                <div className="mathSideMeta">
                  <span className={`badge ${correct ? "" : "bad"}`}>{correct ? "정답" : "오답"}</span>
                  <span className="badge">{timeMs}ms</span>
                  <span className="badge">점수: {score.toFixed(1)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="gameBoardPending">풀이 진행 중...</div>
      )}
    </div>
  );
}
