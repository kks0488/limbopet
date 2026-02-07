import React, { useState } from "react";

interface TodayBannerProps {
  hook: {
    stage?: string;
    tease?: { headline?: string; details?: string[]; reveal_at?: string };
    reveal?: { headline?: string; details?: string[] };
  } | null;
}

export function TodayBanner({ hook }: TodayBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!hook) return null;

  const stage = String(hook.stage ?? "").trim();
  const tease = hook.tease && typeof hook.tease === "object" ? hook.tease : null;
  const reveal = hook.reveal && typeof hook.reveal === "object" ? hook.reveal : null;

  const headline =
    stage === "reveal"
      ? String(reveal?.headline ?? "").trim()
      : String(tease?.headline ?? "").trim();

  const details =
    stage === "reveal"
      ? Array.isArray(reveal?.details) ? reveal!.details.map((x) => String(x ?? "").trim()).filter(Boolean) : []
      : Array.isArray(tease?.details) ? tease!.details.map((x) => String(x ?? "").trim()).filter(Boolean) : [];

  if (!headline) return null;

  return (
    <>
      <button
        className="todayBanner"
        type="button"
        onClick={() => setExpanded(true)}
      >
        <span className="todayBannerIcon">{stage === "reveal" ? "💥" : "🔥"}</span>
        <span className="todayBannerText">{headline}</span>
      </button>

      {expanded ? (
        <div className="todayBannerModal" onClick={() => setExpanded(false)}>
          <div className="todayBannerModalContent" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>{stage === "reveal" ? "💥 오늘의 결과" : "🔥 오늘의 관전 포인트"}</h2>
              <button className="btn" type="button" onClick={() => setExpanded(false)}>닫기</button>
            </div>
            <div style={{ marginTop: 12, fontWeight: 800, whiteSpace: "pre-wrap" }}>
              "{headline}"
            </div>
            {details.length > 0 ? (
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {details.slice(0, 5).map((t, i) => (
                  <div key={`${i}-${t}`} className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {t}
                  </div>
                ))}
              </div>
            ) : null}
            {stage !== "reveal" && tease?.reveal_at ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                결과 {tease.reveal_at} 공개
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
