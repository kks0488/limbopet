import { useEffect } from "react";
import { AiConnectPanel } from "./AiConnectPanel";
import { BrainSettings } from "./BrainSettings";

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
  busy,
}: SettingsPanelProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

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
          {/* 1순위: API 키 직접 입력 */}
          <div className="card">
            <div className="settings-card__header">
              <h2 className="settings-card__title">API 키로 연결하기</h2>
              <span className="badge settings-badge--accent">추천</span>
            </div>
            <div className="muted settings-card__desc">
              AI 서비스에서 API 키를 발급받아 입력해요
            </div>
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
              busy={busy}
            />
          </div>

          {/* 구분선 */}
          {userToken ? (
            <div className="settings-divider">
              <span className="settings-divider__line" />
              <span className="settings-divider__text">또는</span>
              <span className="settings-divider__line" />
            </div>
          ) : null}

          {/* 2순위: 구독으로 연결 (OAuth) — PC 전용 */}
          {userToken ? (
            <div className="card">
              <div className="settings-card__header">
                <h2 className="settings-card__title">내 구독으로 연결하기</h2>
                <span className="badge settings-badge--muted">PC 전용</span>
              </div>
              <div className="muted settings-card__desc">
                이 PC에서 구독 계정으로 바로 로그인해요 (모바일 미지원)
              </div>
              <AiConnectPanel
                token={userToken}
                brainProfile={brainProfile}
                onBrainProfileChange={onBrainProfileChange}
              />
            </div>
          ) : null}

          <div className="card">
            <div className="settings-card__header">
              <h2 className="settings-card__title">대화 프롬프트 커스텀</h2>
            </div>
            <div className="muted settings-card__desc">
              프롬프트가 AI의 말투와 성격을 결정해요. 버전 {promptVersion}
              {promptUpdatedAt ? ` · ${new Date(promptUpdatedAt).toLocaleString()}` : ""}
            </div>
            <div className="settings-prompt__tip">
              💡 팁: 말투, 성격, 답변 스타일을 구체적으로 쓸수록 효과가 좋아요.
            </div>
            <div className="row settings-row--wrap">
              <label className="settings-checkbox-label">
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
              placeholder={"예시:\n• 차분하고 논리적인 법정 변호사 톤으로 말해\n• 핵심을 먼저 말하고 근거를 2개 제시해\n• 반말로 짧게 답해"}
              className="settings-prompt__textarea"
              disabled={promptBusy}
              aria-label="커스텀 프롬프트"
            />
            <div className="row settings-row--wrap">
              <button className="btn primary" type="button" onClick={onSavePrompt} disabled={promptBusy}>
                {promptBusy ? "저장 중..." : "저장"}
              </button>
              <button className="btn danger" type="button" onClick={() => { if (window.confirm("프롬프트를 초기화할까요?")) onDeletePrompt(); }} disabled={promptBusy}>
                초기화
              </button>
            </div>
          </div>

          {failedJobs.length > 0 ? (
            <div className="card">
              <h2>실패 작업 재시도</h2>
              <div className="settings-jobs__grid">
                {failedJobs.map((j) => (
                  <div key={j.id} className="row settings-jobs__row">
                    <div className="settings-jobs__info">
                      <div>
                        <strong>{j.job_type}</strong>
                        {j.last_error_code ? <span className="badge settings-badge--ml">{j.last_error_code}</span> : null}
                      </div>
                      {j.error ? (
                        <div className="muted settings-jobs__error">
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
            </div>
          ) : null}

          <div className="card">
            <h2>계정</h2>
            <div className="settings-account__actions">
              <button className="btn danger" type="button" onClick={() => { if (window.confirm("로그아웃할까요?")) onSignOut(); }} disabled={busy}>
                로그아웃
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
