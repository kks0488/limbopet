import React, { useState } from "react";
import type { UserBrainProfile } from "../lib/api";

type ProviderKey = "google" | "openai" | "anthropic" | "xai" | "custom";

const PROVIDERS: Array<{
  key: ProviderKey;
  icon: string;
  name: string;
  sub: string;
  tag: string;
  color: string;
}> = [
  { key: "google", icon: "🟢", name: "Google", sub: "Gemini", tag: "추천/무료", color: "#34A853" },
  { key: "openai", icon: "🔵", name: "OpenAI", sub: "GPT", tag: "강력", color: "#0A84FF" },
  { key: "anthropic", icon: "🟠", name: "Anthropic", sub: "Claude", tag: "자연스러운", color: "#FF9F0A" },
  { key: "xai", icon: "⚫", name: "xAI", sub: "Grok", tag: "빠른", color: "#888" },
  { key: "custom", icon: "⚙️", name: "커스텀", sub: "OpenAI 호환", tag: "고급", color: "#666" },
];

const PROVIDER_MODELS: Record<string, Array<{ value: string; label: string; desc: string }>> = {
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", desc: "빠르고 저렴 (추천)" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", desc: "안정적" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", desc: "고성능" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o Mini", desc: "저렴하고 빠름 (추천)" },
    { value: "gpt-4o", label: "GPT-4o", desc: "고성능" },
    { value: "o3-mini", label: "o3-mini", desc: "추론 특화" },
  ],
  anthropic: [
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", desc: "빠르고 저렴 (추천)" },
    { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", desc: "고성능" },
  ],
  xai: [
    { value: "grok-2-mini", label: "Grok 2 Mini", desc: "빠르고 저렴 (추천)" },
    { value: "grok-2", label: "Grok 2", desc: "고성능" },
  ],
};

const PROVIDER_GUIDE: Record<string, { url: string; urlLabel: string; keyPrefix: string; steps: string[] }> = {
  google: {
    url: "https://aistudio.google.com/apikey",
    urlLabel: "aistudio.google.com/apikey",
    keyPrefix: "AI",
    steps: ["위 링크에서 'Create API Key' 클릭", "프로젝트 선택 후 키 복사", "아래에 붙여넣기"],
  },
  openai: {
    url: "https://platform.openai.com/api-keys",
    urlLabel: "platform.openai.com",
    keyPrefix: "sk-",
    steps: ["위 링크에서 'Create new secret key' 클릭", "키 이름 입력 후 생성", "키를 복사해서 아래에 붙여넣기"],
  },
  anthropic: {
    url: "https://console.anthropic.com/settings/keys",
    urlLabel: "console.anthropic.com",
    keyPrefix: "sk-ant-",
    steps: ["위 링크에서 'Create Key' 클릭", "키 이름 입력 후 생성", "키를 복사해서 아래에 붙여넣기"],
  },
  xai: {
    url: "https://console.x.ai",
    urlLabel: "console.x.ai",
    keyPrefix: "xai-",
    steps: ["위 링크에서 API Keys 메뉴로 이동", "새 키 생성 후 복사", "아래에 붙여넣기"],
  },
};

interface BrainSettingsProps {
  brainProfile: UserBrainProfile | null;
  byokProvider: string;
  byokModel: string;
  byokBaseUrl: string;
  byokApiKey: string;
  onByokProviderChange: (v: string) => void;
  onByokModelChange: (v: string) => void;
  onByokBaseUrlChange: (v: string) => void;
  onByokApiKeyChange: (v: string) => void;
  onSaveByok: () => void;
  onDeleteByok: () => void;
  onGeminiOauthConnect: () => void;
  busy: boolean;
}

export function BrainSettings({
  brainProfile,
  byokProvider,
  byokModel,
  byokBaseUrl,
  byokApiKey,
  onByokProviderChange,
  onByokModelChange,
  onByokBaseUrlChange,
  onByokApiKeyChange,
  onSaveByok,
  onDeleteByok,
  onGeminiOauthConnect,
  busy,
}: BrainSettingsProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey | null>(
    brainProfile ? null : null,
  );
  const [showSetupForm, setShowSetupForm] = useState(false);

  const isConnected = Boolean(brainProfile?.connected || brainProfile?.provider);
  const hasError = Boolean(brainProfile?.last_error);

  function selectProvider(key: ProviderKey) {
    setSelectedProvider(key);
    setShowSetupForm(true);

    // Map to API provider values
    const providerMap: Record<ProviderKey, string> = {
      google: "google",
      openai: "openai",
      anthropic: "anthropic",
      xai: "xai",
      custom: "openai_compatible",
    };
    onByokProviderChange(providerMap[key]);

    // Auto-select first model
    const models = PROVIDER_MODELS[key];
    if (models?.[0]) {
      onByokModelChange(models[0].value);
    } else {
      onByokModelChange("");
    }
    onByokBaseUrlChange("");
    onByokApiKeyChange("");
  }

  function goBack() {
    setSelectedProvider(null);
    setShowSetupForm(false);
  }

  // ── Connected State ──
  if (isConnected && !showSetupForm) {
    const providerLabel = (() => {
      const p = String(brainProfile?.provider ?? "").toLowerCase();
      if (p === "google" || p === "gemini") return "Google Gemini";
      if (p === "openai") return "OpenAI (GPT)";
      if (p === "anthropic") return "Anthropic (Claude)";
      if (p === "xai") return "xAI (Grok)";
      if (p === "openai_compatible") return "커스텀 (호환)";
      return p || "Unknown";
    })();
    const mode = String(brainProfile?.mode ?? "").toLowerCase();
    const isOauth = mode === "oauth" || mode === "google_oauth";
    const model = String(brainProfile?.model ?? "").trim();
    const lastCheck = brainProfile?.last_validated_at
      ? formatRelative(brainProfile.last_validated_at)
      : null;

    return (
      <div className="card brainCard">
        <div className="brainHeader">
          <h2 style={{ margin: 0 }}>
            🧠 AI 두뇌: {hasError ? "오류" : "연결됨"} {hasError ? "⚠️" : "✅"}
          </h2>
        </div>

        <div className="brainStatusGrid">
          <div className="brainStatusRow">
            <span className="brainStatusLabel">프로바이더</span>
            <span className="brainStatusValue">
              {providerLabel}
              {isOauth ? " (OAuth)" : " (API Key)"}
            </span>
          </div>
          {model ? (
            <div className="brainStatusRow">
              <span className="brainStatusLabel">모델</span>
              <span className="brainStatusValue">{model}</span>
            </div>
          ) : null}
          {lastCheck ? (
            <div className="brainStatusRow">
              <span className="brainStatusLabel">마지막 확인</span>
              <span className="brainStatusValue">{lastCheck}</span>
            </div>
          ) : null}
          <div className="brainStatusRow">
            <span className="brainStatusLabel">상태</span>
            <span className={`brainStatusValue ${hasError ? "brainError" : "brainOk"}`}>
              {hasError ? "오류 발생" : "정상 작동 중"}
            </span>
          </div>
        </div>

        {hasError && brainProfile?.last_error ? (
          <div className="toast warn" style={{ marginTop: 12 }}>
            {String(brainProfile.last_error)}
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 16, flexWrap: "wrap", gap: 8 }}>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setShowSetupForm(true);
              setSelectedProvider(null);
            }}
            disabled={busy}
          >
            {hasError ? "키 다시 입력" : "모델 변경"}
          </button>
          <button className="btn danger" type="button" onClick={onDeleteByok} disabled={busy}>
            연결 해제
          </button>
          {hasError ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setShowSetupForm(true);
                setSelectedProvider(null);
              }}
              disabled={busy}
            >
              다른 프로바이더
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Provider Setup Form ──
  if (showSetupForm && selectedProvider) {
    const provider = PROVIDERS.find((p) => p.key === selectedProvider)!;
    const models = PROVIDER_MODELS[selectedProvider] ?? [];
    const guide = PROVIDER_GUIDE[selectedProvider];
    const isGoogle = selectedProvider === "google";
    const isCustom = selectedProvider === "custom";
    const needsBaseUrl = isCustom || selectedProvider === "xai";

    return (
      <div className="card brainCard">
        <div className="brainHeader">
          <button className="btn btnSmall" type="button" onClick={goBack} disabled={busy}>
            ← 뒤로
          </button>
          <h2 style={{ margin: 0 }}>
            {provider.icon} {provider.name} {provider.sub} 연결
          </h2>
        </div>

        {/* Google: OAuth option first */}
        {isGoogle ? (
          <>
            <div className="brainOauthCard">
              <div className="brainOauthStar">⭐ 구글로 바로 연결 (추천)</div>
              <div className="muted" style={{ fontSize: "var(--font-subhead)", marginTop: 4 }}>
                API 키 없이 구글 계정만으로!
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={onGeminiOauthConnect}
                disabled={busy}
                style={{ marginTop: 12 }}
              >
                🟢 구글로 연결하기
              </button>
            </div>

            <div className="brainDivider">
              <span className="brainDividerLine" />
              <span className="brainDividerText">또는</span>
              <span className="brainDividerLine" />
            </div>
          </>
        ) : null}

        {/* API Key Section */}
        <div className="brainApiSection">
          <div className="brainApiTitle">🔑 API 키로 연결</div>

          {/* Guide steps */}
          {guide ? (
            <div className="brainGuide">
              {guide.steps.map((step, i) => (
                <div key={i} className="brainGuideStep">
                  <span className="brainGuideNum">{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
              <a
                href={guide.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn brainGuideLink"
                style={{ marginTop: 8 }}
              >
                키 발급 페이지 열기 ↗
              </a>
            </div>
          ) : null}

          {/* Custom: Base URL */}
          {isCustom ? (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Base URL</label>
              <input
                value={byokBaseUrl}
                onChange={(e) => onByokBaseUrlChange(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
              />
              <div className="muted" style={{ fontSize: "var(--font-caption)", marginTop: 4 }}>
                OpenRouter, Together AI, Groq, LM Studio, Ollama 등
              </div>
            </div>
          ) : null}

          {/* xAI: Base URL */}
          {selectedProvider === "xai" ? (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Base URL (선택)</label>
              <input
                value={byokBaseUrl}
                onChange={(e) => onByokBaseUrlChange(e.target.value)}
                placeholder="https://api.x.ai/v1"
              />
            </div>
          ) : null}

          {/* API Key */}
          <div className="field" style={{ marginTop: 12 }}>
            <label>API Key</label>
            <input
              value={byokApiKey}
              onChange={(e) => onByokApiKeyChange(e.target.value)}
              placeholder={guide ? `${guide.keyPrefix}...` : "키를 붙여넣기"}
              type="password"
            />
          </div>

          {/* Model */}
          <div className="field" style={{ marginTop: 12 }}>
            <label>모델</label>
            {models.length > 0 ? (
              <select
                value={byokModel}
                onChange={(e) => onByokModelChange(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label} — {m.desc}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={byokModel}
                onChange={(e) => onByokModelChange(e.target.value)}
                placeholder="모델명 (예: gpt-4o-mini)"
              />
            )}
          </div>

          {/* Tip */}
          {models.length > 0 && !isCustom ? (
            <div className="muted" style={{ fontSize: "var(--font-caption)", marginTop: 8 }}>
              💡 {models[0].label} {models[0].desc}
            </div>
          ) : null}

          {/* Save */}
          <div className="row" style={{ marginTop: 16, gap: 8 }}>
            <button className="btn primary" type="button" onClick={onSaveByok} disabled={busy}>
              연결하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Provider Selection (Default) ──
  return (
    <div className="card brainCard">
      <div className="brainHeader">
        {showSetupForm ? (
          <button
            className="btn btnSmall"
            type="button"
            onClick={goBack}
            disabled={busy}
          >
            ← 뒤로
          </button>
        ) : null}
        <h2 style={{ margin: 0 }}>🧠 AI 두뇌 연결</h2>
      </div>
      <div className="muted" style={{ fontSize: "var(--font-subhead)", marginTop: 4 }}>
        펫에게 생각하는 능력을 줘보세요
      </div>

      <div className="brainProviderGrid">
        {PROVIDERS.map((p) => (
          <button
            key={p.key}
            className={`brainProviderCard ${p.key === "custom" ? "brainProviderWide" : ""}`}
            type="button"
            onClick={() => selectProvider(p.key)}
            disabled={busy}
          >
            <div className="brainProviderIcon">{p.icon}</div>
            <div className="brainProviderName">{p.name}</div>
            <div className="brainProviderSub">{p.sub}</div>
            <div
              className="brainProviderTag"
              style={{ borderColor: p.color, color: p.color }}
            >
              {p.tag}
            </div>
          </button>
        ))}
      </div>

      <div className="muted" style={{ fontSize: "var(--font-caption)", marginTop: 12, textAlign: "center" }}>
        키는 서버에 암호화 저장되며, 언제든 삭제할 수 있어요.
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "방금 전";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
