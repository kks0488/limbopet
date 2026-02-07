import React, { useEffect, useRef, useState } from "react";
import {
  brainProxyConnect,
  brainProxyStatus,
  brainProxyComplete,
  brainProxyAuthFiles,
  brainProxyDisconnect,
  type UserBrainProfile,
} from "../lib/api";

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
  { key: "antigravity", icon: "", name: "Antigravity", color: "#BF5AF2" },
  { key: "qwen", icon: "", name: "Qwen", color: "#FF453A" },
  { key: "iflow", icon: "", name: "iFlow", color: "#8E8E93" },
];

const POLL_INTERVAL = 2000;
const POLL_MAX_MS = 5 * 60 * 1000;

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
  const [authFiles, setAuthFiles] = useState<Array<{ provider: string; connected_at?: string }>>([]);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    loadAuthFiles();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [token]);

  async function loadAuthFiles() {
    setLoadError(null);
    try {
      const res = await brainProxyAuthFiles(token);
      setAuthFiles(res.files || []);
    } catch (e: any) {
      setLoadError(e?.message ?? "연결 정보를 불러올 수 없습니다.");
    }
  }

  async function handleDisconnect(providerKey: string) {
    if (disconnecting) return;
    setDisconnecting(providerKey);
    setError(null);
    try {
      await brainProxyDisconnect(token, providerKey);
      await loadAuthFiles();
      onBrainProfileChange();
    } catch (e: any) {
      setError(e?.message ?? "연결 해제에 실패했습니다.");
    } finally {
      setDisconnecting(null);
    }
  }

  function isConnected(providerKey: string): boolean {
    return authFiles.some((f) => f.provider === providerKey);
  }

  async function handleConnect(providerKey: string) {
    if (connectingProvider) return;
    setError(null);
    setConnectingProvider(providerKey);
    setConnectStatus("연결 준비 중...");

    try {
      const res = await brainProxyConnect(token, providerKey);
      if (!res.url) throw new Error("OAuth URL을 받지 못했습니다.");

      // Open OAuth window
      const popup = window.open(res.url, "_blank", "width=600,height=700");

      setConnectStatus("인증 대기 중...");
      startTimeRef.current = Date.now();
      setElapsedSec(0);

      // Start elapsed timer
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Start polling
      pollRef.current = setInterval(async () => {
        if (Date.now() - startTimeRef.current > POLL_MAX_MS) {
          stopPolling();
          setError("인증 시간이 초과되었습니다. 다시 시도해주세요.");
          setConnectingProvider(null);
          setConnectStatus(null);
          return;
        }

        try {
          const statusRes = await brainProxyStatus(token, res.state);
          if (statusRes.status === "ok") {
            stopPolling();
            setConnectStatus("프로필 저장 중...");
            try {
              await brainProxyComplete(token, providerKey);
              setConnectStatus(null);
              setConnectingProvider(null);
              await loadAuthFiles();
              onBrainProfileChange();
            } catch (e: any) {
              setError(e?.message ?? "프로필 저장 실패");
              setConnectStatus(null);
              setConnectingProvider(null);
            }
          } else if (statusRes.status === "error") {
            stopPolling();
            setError("인증에 실패했습니다. 다시 시도해주세요.");
            setConnectingProvider(null);
            setConnectStatus(null);
          }
        } catch {
          // polling error, continue
        }
      }, POLL_INTERVAL);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setConnectingProvider(null);
      setConnectStatus(null);
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedSec(0);
  }

  function cancelConnect() {
    stopPolling();
    setConnectingProvider(null);
    setConnectStatus(null);
    setError(null);
  }

  const isProfileConnected = Boolean(brainProfile?.connected || brainProfile?.provider);

  return (
    <div className="aiConnectPanel">
      <h2 style={{ margin: 0 }}>AI 연결</h2>

      {/* Current brain profile */}
      {isProfileConnected ? (
        <div className="aiConnectCurrent">
          <span className="aiConnectCurrentDot" />
          <span>
            현재 두뇌: <strong>{brainProfile?.provider}</strong>
            {brainProfile?.model ? ` (${brainProfile.model})` : ""}
          </span>
        </div>
      ) : null}

      {/* Provider grid */}
      <div className="aiConnectGrid">
        {PROVIDERS.map((p) => {
          const connected = isConnected(p.key);
          const connecting = connectingProvider === p.key;
          return (
            <button
              key={p.key}
              className={`aiConnectBtn${connected ? " aiConnectBtnDone" : ""}${connecting ? " aiConnectBtnBusy" : ""}`}
              type="button"
              onClick={() => connected ? null : handleConnect(p.key)}
              disabled={!!connectingProvider}
              style={{ "--provider-color": p.color } as React.CSSProperties}
            >
              <span className="providerDot" style={{ background: p.color }} />
              <span className="aiConnectBtnName">{p.name}</span>
              {connected ? (
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

      {/* Load error */}
      {loadError ? (
        <div className="toast warn" style={{ marginTop: 12 }}>
          {loadError}
          <button className="btn btnSmall" type="button" onClick={loadAuthFiles} style={{ marginLeft: 8 }}>
            재시도
          </button>
        </div>
      ) : null}

      {/* Connecting status */}
      {connectStatus ? (
        <div className="aiConnectPolling">
          <div className="aiConnectPollingDot" />
          <span>{connectStatus}</span>
          {elapsedSec > 0 ? (
            <span className="badge" style={{ marginLeft: 4 }}>{elapsedSec}초 경과</span>
          ) : null}
          <button className="btn btnSmall" type="button" onClick={cancelConnect}>
            취소
          </button>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="toast warn" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}

      {/* Connected accounts list */}
      {authFiles.length > 0 ? (
        <div className="aiConnectList">
          <div className="aiConnectListTitle">연결된 계정</div>
          {authFiles.map((f) => {
            const pDef = PROVIDERS.find((p) => p.key === f.provider);
            const isDisconnecting = disconnecting === f.provider;
            return (
              <div key={f.provider} className="aiConnectListItem">
                <span className="providerDot" style={{ background: pDef?.color ?? "#8E8E93" }} />
                <span className="aiConnectListName">{pDef?.name ?? f.provider}</span>
                {f.connected_at ? (
                  <span className="aiConnectListDate">{formatRelative(f.connected_at)}</span>
                ) : null}
                <button
                  className="btn btnSmall danger"
                  type="button"
                  onClick={() => handleDisconnect(f.provider)}
                  disabled={!!disconnecting}
                  style={{ marginLeft: "auto", padding: "2px 8px", minHeight: 28 }}
                >
                  {isDisconnecting ? "해제 중..." : "해제"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* 암호화 저장 안내 제거 */}
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
