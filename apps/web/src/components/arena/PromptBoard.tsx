import React from "react";

export function PromptBoard({ meta, aName, bName }: { meta: any; aName: string; bName: string }) {
  // resolved → prompt_battle, live → prompt_preview
  const pb = meta?.prompt_battle;
  const preview = meta?.prompt_preview;
  const data = pb ?? preview ?? null;
  if (!data) return null;

  const theme = String(data.theme ?? "").trim();
  const required = Array.isArray(data.required) ? data.required : [];
  // 프롬프트 결과는 resolved 때만
  const aPrompt = pb ? String(pb.a_prompt ?? "").trim() : "";
  const bPrompt = pb ? String(pb.b_prompt ?? "").trim() : "";
  const aMissing = pb && Array.isArray(pb.a_missing) ? pb.a_missing : [];
  const bMissing = pb && Array.isArray(pb.b_missing) ? pb.b_missing : [];
  const aHit = required.filter((k: string) => !aMissing.includes(k));
  const bHit = required.filter((k: string) => !bMissing.includes(k));
  const hasResults = !!(aPrompt || bPrompt);

  return (
    <div className="gameBoard promptBoard">
      <h3 className="gameBoardTitle">프롬프트 배틀</h3>

      {/* 테마 */}
      {theme ? <div className="promptTheme">{theme}</div> : null}

      {/* 키워드 칩 */}
      {required.length > 0 ? (
        <div className="promptKeywords">
          <span className="promptKeywordsLabel">필수 키워드:</span>
          <div className="promptChipRow">
            {required.slice(0, 12).map((k: any) => (
              <span key={String(k)} className="badge">{String(k)}</span>
            ))}
          </div>
        </div>
      ) : null}

      {/* 양측 프롬프트 — resolved만 */}
      {hasResults ? (
        <div className="gameBoardColumns">
          {[
            { name: aName, prompt: aPrompt, missing: aMissing, hit: aHit, label: "A" },
            { name: bName, prompt: bPrompt, missing: bMissing, hit: bHit, label: "B" },
          ].map(({ name, prompt, missing, hit, label }) => (
            <div key={label} className="gameBoardColumn">
              <div className="gameBoardColumnHeader">
                <span className="gameBoardSide">{name}</span>
                <span className="badge">{hit.length}/{required.length} 히트</span>
              </div>

              {prompt ? <div className="promptText">{prompt}</div> : null}

              {/* 히트/미스 칩 */}
              {(hit.length > 0 || missing.length > 0) ? (
                <div className="promptChipRow" style={{ marginTop: 8 }}>
                  {hit.map((k: any) => (
                    <span key={`hit-${String(k)}`} className="promptChip hit">{String(k)}</span>
                  ))}
                  {missing.map((k: any) => (
                    <span key={`miss-${String(k)}`} className="promptChip miss">{String(k)}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="gameBoardPending">프롬프트 작성 중...</div>
      )}
    </div>
  );
}
