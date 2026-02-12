import React, { useRef, useState } from "react";
import {
  brainProxyConnect,
  brainProxyStatus,
  brainProxyComplete,
  type UserBrainProfile,
} from "../lib/api";
import { friendlyError } from "../lib/errorMessages";

type ProviderDef = {
  key: string;
  icon: string;
  name: string;
  color: string;
};

const PROVIDERS: ProviderDef[] = [
  { key: "google", icon: "", name: "Google AI", color: "#34A853" },
  { key: "openai", icon: "", name: "OpenAI", color: "#0A84FF" },
  { key: "anthropic", icon: "", name: "Claude", color: "#FF9F0A" },
];

interface AiConnectPanelProps {
  token: string;
  brainProfile: UserBrainProfile | null;
  onBrainProfileChange: () => void;
}

export function AiConnectPanel({
  token,
  brainProfile,
  onBrainProfileChange,
}: AiConnectPanelProps) {
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  function stopPolling() {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }

  // Check if brain profile is connected via OAuth to this provider
  const connectedProvider = (() => {
    if (!brainProfile?.provider) return null;
    const mode = String(brainProfile?.mode ?? "").toLowerCase();
    if (mode === "oauth" || mode === "google_oauth") return String(brainProfile.provider).toLowerCase();
    return null;
  })();

  async function handleConnect(providerKey: string) {
    if (connectingProvider) return;
    setError(null);
    setConnectingProvider(providerKey);
    setConnectStatus("인증 URL 가져오는 중...");
    stopPolling();

    try {
      const { url, state } = await brainProxyConnect(token, providerKey);
      const popup = window.open(url, "ai_oauth", "popup,width=600,height=700");
      setConnectStatus("팝업에서 로그인해 주세요...");

      let elapsed = 0;
      const POLL_MS = 2000;
      const MAX_MS = 300_000;
      pollRef.current = window.setInterval(async () => {
        elapsed += POLL_MS;
        if (popup && popup.closed) {
          stopPolling();
          setConnectStatus(null);
          setConnectingProvider(null);
          return;
        }
        if (elapsed > MAX_MS) {
          stopPolling();
          setError("시간 초과. 다시 시도해 주세요.");
          setConnectStatus(null);
          setConnectingProvider(null);
          return;
        }
        try {
          const res = await brainProxyStatus(token, state);
          if (res.status === "ok") {
            stopPolling();
            if (popup && !popup.closed) popup.close();
            await brainProxyComplete(token, providerKey);
            setConnectStatus(null);
            setConnectingProvider(null);
            onBrainProfileChange();
          } else if (res.status === "error") {
            stopPolling();
            if (popup && !popup.closed) popup.close();
            setError("인증에 실패했어요. 다시 시도해 주세요.");
            setConnectStatus(null);
            setConnectingProvider(null);
          }
        } catch { /* continue polling */ }
      }, POLL_MS);
    } catch (e: any) {
      setError(friendlyError(e));
      setConnectStatus(null);
      setConnectingProvider(null);
    }
  }

  return (
    <div className="aiConnectPanel">
      {/* Provider grid */}
      <div className="aiConnectGrid">
        {PROVIDERS.map((p) => {
          const isThisConnected = connectedProvider === p.key;
          const connecting = connectingProvider === p.key;
          return (
            <button
              key={p.key}
              className={`aiConnectBtn${isThisConnected ? " aiConnectBtnDone" : ""}${connecting ? " aiConnectBtnBusy" : ""}`}
              type="button"
              onClick={() => isThisConnected ? null : handleConnect(p.key)}
              disabled={!!connectingProvider}
              style={{ "--provider-color": p.color } as React.CSSProperties}
            >
              <span className="providerDot ai-connect-provider-dot" />
              <span className="aiConnectBtnName">{p.name}</span>
              {isThisConnected ? (
                <span className="aiConnectBtnStatus">연결됨 ✓</span>
              ) : connecting ? (
                <span className="aiConnectBtnStatus">인증 중...</span>
              ) : (
                <span className="aiConnectBtnStatus">연결하기</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Connecting status */}
      {connectStatus ? (
        <div className="aiConnectPolling">
          <div className="aiConnectPollingDot" />
          <span>{connectStatus}</span>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="toast warn ai-connect-toast-gap">
          {error}
        </div>
      ) : null}

      <div className="muted" style={{ fontSize: "var(--font-caption2)", marginTop: "var(--spacing-xs)" }}>
        이 PC 브라우저에서만 작동해요. 모바일에서는 API 키를 사용해 주세요.
      </div>
    </div>
  );
}
