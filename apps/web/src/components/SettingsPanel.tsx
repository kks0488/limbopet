import React from "react";
import { BrainSettings } from "./BrainSettings";
import { AiConnectPanel } from "./AiConnectPanel";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  // Brain settings
  brainProfile: any;
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
  // Account
  userToken: string | null;
  onSignOut: () => void;
  onBrainProfileChange: () => void;
  // Prompt customization
  promptEnabled: boolean;
  promptText: string;
  promptVersion: number;
  promptUpdatedAt: string | null;
  promptBusy: boolean;
  onPromptEnabledChange: (v: boolean) => void;
  onPromptTextChange: (v: string) => void;
  onSavePrompt: () => void;
  onDeletePrompt: () => void;
  // Failed jobs quick retry
  failedJobs: Array<{ id: string; job_type: string; error?: string | null; last_error_code?: string | null }>;
  retryingJobId: string | null;
  onRetryJob: (id: string) => void;
  // Advanced
  petAdvanced: boolean;
  onToggleAdvanced: () => void;
  uiMode: string;
  onToggleDebug: () => void;
  busy: boolean;
}

export function SettingsPanel({
  open,
  onClose,
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
  userToken,
  onSignOut,
  onBrainProfileChange,
  promptEnabled,
  promptText,
  promptVersion,
  promptUpdatedAt,
  promptBusy,
  onPromptEnabledChange,
  onPromptTextChange,
  onSavePrompt,
  onDeletePrompt,
  failedJobs,
  retryingJobId,
  onRetryJob,
  petAdvanced,
  onToggleAdvanced,
  uiMode,
  onToggleDebug,
  busy,
}: SettingsPanelProps) {
  return (
    <div className={`settingsOverlay ${open ? "open" : ""}`} onClick={onClose} aria-hidden={!open}>
      <div className="settingsPanel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="설정">
        <div className="settingsHeader">
          <div className="settingsTitle">설정</div>
          <button className="btn" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="settingsList">
          <div className="card">
            <BrainSettings
              brainProfile={brainProfile}
              byokProvider={byokProvider}
              byokModel={byokModel}
              byokBaseUrl={byokBaseUrl}
              byokApiKey={byokApiKey}
              onByokProviderChange={onByokProviderChange}
              onByokModelChange={onByokModelChange}
              onByokBaseUrlChange={onByokBaseUrlChange}
              onByokApiKeyChange={onByokApiKeyChange}
              onSaveByok={onSaveByok}
              onDeleteByok={onDeleteByok}
              onGeminiOauthConnect={onGeminiOauthConnect}
              busy={busy}
            />

            {userToken ? (
              <>
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />
                <AiConnectPanel
                  token={userToken}
                  brainProfile={brainProfile}
                  onBrainProfileChange={onBrainProfileChange}
                />
              </>
            ) : null}
          </div>

          <div className="card">
            <h2>대화 프롬프트 커스텀</h2>
            <div className="muted" style={{ marginTop: 8, fontSize: "var(--font-caption)" }}>
              내 펫 대화의 시스템 프롬프트를 직접 지정합니다. (버전 {promptVersion}
              {promptUpdatedAt ? ` · ${new Date(promptUpdatedAt).toLocaleString()}` : ""})
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={promptEnabled}
                  onChange={(e) => onPromptEnabledChange(Boolean(e.target.checked))}
                  disabled={promptBusy}
                />
                커스텀 프롬프트 사용
              </label>
            </div>
            <textarea
              value={promptText}
              onChange={(e) => onPromptTextChange(e.target.value)}
              placeholder="예: 너는 논리적이고 차분한 법정 트레이너 톤으로 답해. 핵심을 먼저 말하고 근거를 2개 제시해."
              style={{ width: "100%", minHeight: 140, marginTop: 10 }}
              disabled={promptBusy}
            />
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
              <button className="btn primary" type="button" onClick={onSavePrompt} disabled={promptBusy}>
                {promptBusy ? "저장 중..." : "저장"}
              </button>
              <button className="btn danger" type="button" onClick={onDeletePrompt} disabled={promptBusy}>
                초기화
              </button>
            </div>
          </div>

          <div className="card">
            <h2>실패 작업 재시도</h2>
            {failedJobs.length === 0 ? (
              <div className="muted" style={{ marginTop: 8 }}>
                현재 실패한 두뇌 작업이 없습니다.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {failedJobs.map((j) => (
                  <div key={j.id} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 220 }}>
                      <div>
                        <strong>{j.job_type}</strong>
                        {j.last_error_code ? <span className="badge" style={{ marginLeft: 6 }}>{j.last_error_code}</span> : null}
                      </div>
                      {j.error ? (
                        <div className="muted" style={{ marginTop: 4, fontSize: "var(--font-caption)" }}>
                          {String(j.error).slice(0, 140)}
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => onRetryJob(j.id)}
                      disabled={retryingJobId === j.id}
                    >
                      {retryingJobId === j.id ? "재시도 중..." : "재시도"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2>계정</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <button className="btn danger" type="button" onClick={onSignOut} disabled={busy}>
                로그아웃
              </button>
            </div>
          </div>

          {/* 고급 모드 토글 제거 — debug 토글은 uiMode === "debug"에서만 표시 */}
        </div>
      </div>
    </div>
  );
}
