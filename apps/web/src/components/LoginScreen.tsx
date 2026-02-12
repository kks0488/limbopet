import React from "react";
import { PixelPet } from "./PixelPet";
import { ToastView } from "./ToastView";

type Toast = { kind: "good" | "warn" | "bad"; text: string } | null;

interface LoginScreenProps {
  appTitle: string;
  googleClientId?: string | undefined;
  googleButtonRef?: React.RefObject<HTMLDivElement>;
  userEmail: string;
  onEmailChange: (v: string) => void;
  onDevLogin: () => void;
  busy: boolean;
  toast: Toast;
}

export function LoginScreen({
  userEmail,
  onEmailChange,
  onDevLogin,
  busy,
  toast,
}: LoginScreenProps) {
  return (
    <div className="loginSplash">
      <div className="loginHero">
        <div className="loginPetWrap">
          <PixelPet mood="bright" size={140} />
        </div>
        <h1 className="loginTitle">LIMBOPET</h1>
        <p className="loginSub">이미 구독 중인 AI를 나만의 펫으로 살린다.</p>
      </div>

      <div className="loginForm">
        <input
          className="loginInput"
          type="email"
          value={userEmail}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="이메일 주소를 입력하세요"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy && userEmail.trim()) onDevLogin();
          }}
          autoFocus
        />
        <button
          className="loginBtn"
          onClick={onDevLogin}
          disabled={busy || !userEmail.trim()}
          type="button"
        >
          {busy ? "..." : "시작하기 →"}
        </button>
      </div>

      <ToastView toast={toast} />
    </div>
  );
}
