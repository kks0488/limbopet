import React from "react";
import { bgHero } from "../assets/index";

interface NewsCardProps {
  day: string;
  summary: any;
  civicLine?: string | null;
  directorView?: boolean;
  featured?: boolean;
}

export function NewsCard({ day, summary, civicLine, directorView = false, featured = false }: NewsCardProps) {
  const rawScenario = String(summary?.scenario ?? "").trim().toUpperCase();
  const scenarioLabel =
    rawScenario === "ROMANCE" ? "로맨스"
    : rawScenario === "DEAL" ? "거래"
    : rawScenario === "TRIANGLE" ? "질투"
    : rawScenario === "BEEF" ? "신경전"
    : rawScenario === "OFFICE" || rawScenario === "CREDIT" ? "회사"
    : rawScenario ? rawScenario : "";

  const aName = String(summary?.cast?.aName ?? "").trim();
  const bName = String(summary?.cast?.bName ?? "").trim();
  const castLabel = aName && bName ? `${aName} · ${bName}` : "";
  const civic = String(civicLine ?? "").trim();
  const hasNudge = String(summary?.trigger?.kind ?? "").trim() === "nudge";
  const hook = String(summary?.hook ?? "").trim();
  const themeName = String(summary?.theme?.name ?? "").trim();
  const atmosphere = String(summary?.atmosphere ?? "").trim();

  return (
    <div className={`newsCard ${featured ? "newsCardFeatured" : ""}`}>
      {featured ? (
        <div className="newsCardBg" style={{ backgroundImage: `url(${bgHero})` }} aria-hidden />
      ) : null}
      <div className="newsCardContent">
        {themeName ? (
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            시즌 테마: <strong>{themeName}</strong>
          </div>
        ) : null}
        <div className="newsCardTop">
          <span className="badge">{day || "today"}</span>
          {hasNudge ? <span className="badge badgeNudge">🎬 연출</span> : null}
          {scenarioLabel ? <span className="badge">{scenarioLabel}</span> : null}
          {castLabel ? <span className="badge">{castLabel}</span> : null}
        </div>
        <div className="newsCardTitle">{String(summary?.title ?? "오늘의 이야기를 준비 중...")}</div>
        {atmosphere ? (
          <div className="muted newsCardAtmosphere">
            {directorView ? `연출: "${atmosphere}"` : `"${atmosphere}"`}
          </div>
        ) : null}
        {hook ? (
          <div className="muted" style={{ marginTop: 8 }}>
            {hook.length > 140 ? `${hook.slice(0, 140)}...` : hook}
          </div>
        ) : null}
        {civic ? <div className="muted" style={{ marginTop: 8 }}>{civic}</div> : null}
        <div className="newsCardCliff muted">
          다음화 예고: {String(summary?.cliffhanger ?? "...")}
        </div>
      </div>
    </div>
  );
}
