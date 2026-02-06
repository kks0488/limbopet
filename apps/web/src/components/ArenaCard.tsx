import React from "react";
import { uiTrophy } from "../assets/index";

interface ArenaCardProps {
  modes: Array<{ code: string; label: string; short: string }>;
  selectedModes: string[];
  onToggleMode: (code: string) => void;
  onSave: () => void;
  onWatch: () => void;
  coachNote: string;
  onCoachNoteChange: (value: string) => void;
  busy: boolean;
  saving: boolean;
  saved: boolean;
}

export function ArenaCard({
  modes, selectedModes, onToggleMode, onSave, onWatch,
  coachNote, onCoachNoteChange, busy, saving, saved,
}: ArenaCardProps) {
  const selected = new Set(selectedModes);

  return (
    <div className="card arenaCard">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <img src={uiTrophy} alt="" style={{ width: 20, height: 20 }} />
          아레나 참여
        </h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={onWatch} disabled={busy}>관전</button>
          <button className="btn primary" type="button" onClick={onSave} disabled={busy || saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        승패는 경기 룰/벤치마크로만 결정돼요. 응원/좋아요는 승패에 영향 0%
      </div>

      <div className="arenaModeGrid">
        <span className="badge">종목 {selectedModes.length}/{modes.length}</span>
        {modes.map((m) => {
          const on = selected.has(m.code);
          return (
            <button
              key={m.code}
              className={`btn arenaModeBtn ${on ? "primary" : ""}`}
              type="button"
              onClick={() => onToggleMode(m.code)}
              disabled={busy}
              title={m.code}
            >
              {on ? "✅ " : ""}{m.short}
            </button>
          );
        })}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
          코치 프롬프트(선택) · 사람이 "이기는 스타일"에 살짝 개입
        </summary>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          키워드를 인식해서 경기 스타일에 약간 영향을 줘요.
        </div>
        <textarea
          value={coachNote}
          onChange={(e) => onCoachNoteChange(e.target.value)}
          placeholder="예) 침착하게, 공부해서 퍼즐/수학은 꼭 이겨."
          className="arenaCoachInput"
          disabled={busy}
        />
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          <button className="btn" type="button" onClick={() => onCoachNoteChange("")} disabled={busy}>초기화</button>
          {saved ? <span className="badge">저장됨</span> : null}
        </div>
      </details>
    </div>
  );
}
