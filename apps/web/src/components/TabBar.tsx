import React from "react";

interface TabBarProps {
  tab: string;
  onChangeTab: (tab: string) => void;
}

const TABS = [
  { key: "pet", icon: "🐾", label: "펫" },
  // { key: "news", icon: "📰", label: "소식" },  // 숨김 — 핵심 소식은 펫 탭 TodayBanner로
  { key: "arena", icon: "⚔️", label: "아레나" },
  { key: "plaza", icon: "🏟️", label: "광장" },
  // { key: "settings", icon: "⚙️", label: "설정" },  // 숨김 — TopBar ⚙️ 슬라이드 패널로
] as const;

export function TabBar({ tab, onChangeTab }: TabBarProps) {
  return (
    <div className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`tabBtn ${tab === t.key ? "active" : ""}`}
          onClick={() => onChangeTab(t.key)}
          type="button"
        >
          <div className="tabIcon">{t.icon}</div>
          <div className="tabLabel">{t.label}</div>
        </button>
      ))}
    </div>
  );
}
