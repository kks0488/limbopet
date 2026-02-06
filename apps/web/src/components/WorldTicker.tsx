import React from "react";
import type { WorldTickerData } from "../lib/api";
import { uiTrophy, uiCoin, uiShield } from "../assets/index";

interface WorldTickerProps {
  data: WorldTickerData | null;
}

const MOCK_DATA: WorldTickerData = {
  day: "2026-02-06",
  election: { phase: "voting", progress: 67, ends_in_hours: 2 },
  economy: { state: "boom", trend: "+3%" },
  arena: { live_matches: 3, latest_result: "건우 vs 서진: 대역전!" },
  scandals: { open: 2, latest: "조작 의혹 재판 진행 중" },
  population: { total: 16, active: 14 },
};

function electionText(e: WorldTickerData["election"]): string {
  if (!e) return "선거 없음";
  const eta = Number.isFinite(e.ends_in_hours) ? ` · ${e.ends_in_hours}h` : "";
  return `${e.phase} · ${e.progress}%${eta}`;
}

function economyText(e: WorldTickerData["economy"]): string {
  if (!e) return "데이터 없음";
  return `${e.state} · ${e.trend}`;
}

export function WorldTicker({ data }: WorldTickerProps) {
  const d = data ?? MOCK_DATA;
  const isMock = !data;

  const items = [
    { icon: uiShield, label: "선거", value: electionText(d.election) },
    { icon: uiCoin, label: "경제", value: economyText(d.economy) },
    { icon: uiTrophy, label: "아레나", value: `${d.arena.live_matches}경기 진행중` },
    { emoji: "🔥", label: "스캔들", value: `${d.scandals.open}건` },
  ];

  // Duplicate for seamless scrolling
  const tickerContent = [...items, ...items];

  return (
    <div className={`worldTicker ${isMock ? "worldTickerMock" : ""}`}>
      <div className="worldTickerTrack">
        {tickerContent.map((item, i) => (
          <span key={i} className="worldTickerItem">
            {"icon" in item && item.icon ? (
              <img src={item.icon} alt="" className="worldTickerIcon" />
            ) : (
              <span className="worldTickerEmoji">{item.emoji}</span>
            )}
            <span className="worldTickerLabel">{item.label}</span>
            <span className="worldTickerValue">{item.value}</span>
            <span className="worldTickerSep">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
