import React from "react";

type ErrorBoundaryState = { error: Error | null };

const LS_USER_TOKEN = "limbopet_user_jwt";
const LS_TAB = "limbopet_tab";
const LS_UI_MODE = "limbopet_ui_mode";
const LS_ONBOARDED = "limbopet_onboarded";
const LS_ONBOARDING_STEP = "limbopet_onboarding_step";

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[ui] crashed", error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="container">
        <div className="grid single">
          <div className="card">
            <h2>화면을 불러오지 못했어요</h2>
            <div className="muted" style={{ marginTop: 8 }}>
              새로고침하면 대부분 해결돼요.
            </div>
            <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" onClick={() => window.location.reload()}>
                새로고침
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem(LS_USER_TOKEN);
                    localStorage.removeItem(LS_TAB);
                    localStorage.removeItem(LS_UI_MODE);
                    localStorage.removeItem(LS_ONBOARDED);
                    localStorage.removeItem(LS_ONBOARDING_STEP);
                  } finally {
                    window.location.reload();
                  }
                }}
              >
                세션 초기화
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
