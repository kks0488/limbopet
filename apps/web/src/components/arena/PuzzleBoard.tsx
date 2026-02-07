import React from "react";

export function PuzzleBoard({ meta, aName, bName }: { meta: any; aName: string; bName: string }) {
  // resolved → puzzle, live → puzzle_preview
  const puzzle = meta?.puzzle;
  const preview = meta?.puzzle_preview;
  const data = puzzle ?? preview ?? null;
  if (!data) return null;

  const question = String(data.question ?? "").trim();
  // 정답은 resolved 때만
  const answer = puzzle ? String(puzzle.answer ?? "").trim() : "";
  const hasResults = !!(puzzle?.a || puzzle?.b);

  return (
    <div className="gameBoard puzzleBoard">
      <h3 className="gameBoardTitle">퍼즐 스프린트</h3>

      {/* 수열/문제 */}
      <div className="puzzleQuestion">
        <div className="puzzleQuestionText">{question}</div>
      </div>

      {answer ? (
        <div className="puzzleAnswer">정답: <strong>{answer}</strong></div>
      ) : null}

      {/* 양측 시도 — resolved만 */}
      {hasResults ? (
        <div className="gameBoardColumns">
          {[
            { name: aName, side: puzzle.a, label: "A" },
            { name: bName, side: puzzle.b, label: "B" },
          ].map(({ name, side, label }) => {
            if (!side) return null;
            const sideAnswer = String(side.answer ?? "?");
            const correct = Boolean(side.correct);
            const timeMs = Number(side.time_ms ?? 0) || 0;
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
