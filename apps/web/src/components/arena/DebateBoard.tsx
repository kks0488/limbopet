

export function DebateBoard({ meta, aName, bName }: { meta: any; aName: string; bName: string }) {
  const debate = meta?.debate;
  const debateBase = meta?.debate_base;
  const topic = String(debate?.topic ?? debateBase?.topic ?? "").trim();
  const rule = String(debate?.rule ?? debateBase?.rule ?? "").trim();
  const judge = String(debate?.judge ?? debateBase?.judge ?? "").trim();
  const isResolved = !!debate;

  // 라이브+해결 둘 다 topic이 없으면 표시할 게 없음
  if (!topic && !isResolved) return null;

  const aPerf = debate?.a && typeof debate.a === "object" ? debate.a : null;
  const bPerf = debate?.b && typeof debate.b === "object" ? debate.b : null;

  return (
    <div className="gameBoard debateBoard">
      <h3 className="gameBoardTitle">설전</h3>

      {topic ? <div className="gameBoardTopic">{topic}</div> : null}

      <div className="gameBoardMeta">
        {rule ? <span className="gameBoardMetaItem">규칙: {rule}</span> : null}
        {judge ? <span className="gameBoardMetaItem">심사: {judge}</span> : null}
      </div>

      {isResolved ? (
        <div className="gameBoardColumns">
          {[
            { name: aName, perf: aPerf, side: "A" },
            { name: bName, perf: bPerf, side: "B" },
          ].map(({ name, perf, side }) => {
            const pts = perf?.points && typeof perf.points === "object" ? perf.points : {};
            const claims = Array.isArray(perf?.claims) ? perf.claims : [];
            return (
              <div key={side} className="gameBoardColumn">
                <div className="gameBoardColumnHeader">
                  <span className="gameBoardSide">{name}</span>
                  {perf?.stance ? <span className="badge">{String(perf.stance)}</span> : null}
                </div>

                <div className="scoreBarGroup">
                  <ScoreBar label="논리" value={Number(pts.logic ?? 0)} max={10} color="var(--system-blue)" />
                  <ScoreBar label="침착" value={Number(pts.composure ?? 0)} max={10} color="var(--system-green)" />
                  <ScoreBar label="임팩트" value={Number(pts.punch ?? 0)} max={10} color="var(--system-orange)" />
                </div>

                <div className="gameBoardTotal">총점: {String(perf?.total ?? "?")}</div>

                {claims.length ? (
                  <div className="gameBoardClaims">
                    {claims.slice(0, 3).map((c: any, j: number) => (
                      <div key={j} className="gameBoardClaim">
                        {String(c)}
                      </div>
                    ))}
                  </div>
                ) : null}

                {perf?.closer ? <div className="gameBoardCloser">{String(perf.closer)}</div> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="gameBoardPending">양측이 논점을 준비 중이에요...</div>
      )}
    </div>
  );
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="scoreBarRow">
      <span className="scoreBarLabel">{label}</span>
      <div className="scoreBarTrack">
        <div className="scoreBarFill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="scoreBarValue">{value.toFixed(1)}</span>
    </div>
  );
}
