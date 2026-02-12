import { useEffect, useRef, useState } from "react";
import { OnboardingStyles } from "./OnboardingStyles";
import { ToastView } from "./ToastView";
import { BrainSettings, type ProviderKey } from "./BrainSettings";
import { PixelPet } from "./PixelPet";

type Toast = { kind: "good" | "warn" | "bad"; text: string } | null;
type PersistedOnboardingStep = "born" | "peek" | "done";
type NoPetChoice = "watch" | "create";
type Tab = "pet" | "arena" | "plaza";

function josa(name: string, withJong: string, withoutJong: string): string { const c = name.charCodeAt(name.length - 1); return (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0) ? withJong : withoutJong; }

const DEFAULT_WAGE_BY_JOB: Record<string, number> = { barista: 8, merchant: 10, journalist: 12, engineer: 15, detective: 12, janitor: 20 };
const JOB_EMOJI: Record<string, string> = { barista: "\u2615", merchant: "\ud83c\udf80", journalist: "\ud83d\udcf0", engineer: "\ud83d\udcbb", detective: "\ud83d\udd0d", janitor: "\ud83d\udd11" };

/* ------------------------------------------------------------------ */
/*  Step dots indicator                                                */
/* ------------------------------------------------------------------ */
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="stepDots">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`stepDot${i < current ? " stepDot--active" : ""}`}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Props interface — DO NOT CHANGE                                    */
/* ------------------------------------------------------------------ */
interface OnboardingFlowProps {
  step: "choice" | "create" | PersistedOnboardingStep;
  token: string | null;
  pet: any;
  petName: string;
  onboarded: boolean;
  profileBadges: { mbti?: string; company?: string; job?: string; role?: string; vibe?: string };
  profileJob: { code: string; displayName: string; rarity: string; zone: string } | null;
  brainProfile: any;
  busy: boolean;
  refreshing: boolean;
  bornReveal: { job: any; company: any } | null;
  onCreatePet: (name: string, desc: string) => void;
  onMarkOnboarded: () => void;
  onSetOnboardingStep: (step: PersistedOnboardingStep | null) => void;
  onSetNoPetChoice: (choice: NoPetChoice | null) => void;
  onSetActiveTab: (tab: Tab) => void;
  onRefreshAll: () => void;
  onSignOut: () => void;
  toast: Toast;
  // BYOK (API key) connection
  byokProvider: string;
  byokModel: string;
  byokBaseUrl: string;
  byokApiKey: string;
  onByokProviderChange: (v: string) => void;
  onByokModelChange: (v: string) => void;
  onByokBaseUrlChange: (v: string) => void;
  onByokApiKeyChange: (v: string) => void;
  onSaveByok: () => void;
}

export function OnboardingFlow(props: OnboardingFlowProps) {
  const {
    step,
    token,
    pet,
    petName,
    brainProfile,
    busy,
    bornReveal,
    profileBadges,
    profileJob,
    onMarkOnboarded,
    onSetOnboardingStep,
    onSetNoPetChoice,
    onSetActiveTab,
    toast,
  } = props;
  const [createNameLocal, setCreateNameLocal] = useState("");
  const [createDescLocal, setCreateDescLocal] = useState("");
  const [bornGachaPhase, setBornGachaPhase] = useState<0 | 1 | 2 | 3>(0);
  const bornGachaTimersRef = useRef<number[]>([]);

  function clearBornGachaTimers() {
    for (const id of bornGachaTimersRef.current) {
      window.clearTimeout(id);
    }
    bornGachaTimersRef.current = [];
  }

  // Gacha timing for born step
  useEffect(() => {
    clearBornGachaTimers();
    if (step !== "born" || !pet) {
      setBornGachaPhase(0);
      return;
    }
    setBornGachaPhase(1);
    bornGachaTimersRef.current = [
      window.setTimeout(() => setBornGachaPhase(2), 1500),
      window.setTimeout(() => setBornGachaPhase(3), 2600),
    ];
    return () => clearBornGachaTimers();
  }, [step, pet?.id]);

  /* ================================================================ */
  /*  Step: CHOICE — First impression                                  */
  /* ================================================================ */
  if (step === "choice") {
    return (
      <>
        <OnboardingStyles />
        <div className="onboardingScreen onboardingGradient--choice">
          <div className="onboardingInner">
            <div className="onboardingLogo">LIMBOPET</div>
            <div className="onboardingSubtitle">
              {"나만의 AI를 키워보세요"}
            </div>

            <div className="onboardingHero">
              <PixelPet mood="okay" size={120} />
            </div>

            <button
              className="onboardingCTA"
              type="button"
              onClick={() => {
                onSetNoPetChoice("create");
                onSetActiveTab("pet");
              }}
              disabled={busy}
            >
              {"\u2728"} 내 펫 만들기
            </button>

            <button
              className="onboardingLink"
              type="button"
              onClick={() => {
                onSetNoPetChoice("watch");
                onSetActiveTab("plaza");
              }}
              disabled={busy}
            >
              {"관전부터 하기 \u2192"}
            </button>

            <div className="onboardingHint">
              {"펫을 만들면 대화 \u00B7 투표 \u00B7 글쓰기가 열려요"}
            </div>
          </div>

          <ToastView toast={toast} />
        </div>
      </>
    );
  }

  /* ================================================================ */
  /*  Step: CREATE — Pet creation form (inside onboarding)             */
  /* ================================================================ */
  if (step === "create") {
    const descLabelName = createNameLocal.trim() || "\uC774 \uC544\uC774";
    const eunNeun = (() => { const c = descLabelName.charCodeAt(descLabelName.length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0 ? "\uC740" : "\uB294"; })();
    return (
      <>
        <OnboardingStyles />
        <div className="onboardingScreen onboardingGradient--choice">
          <div className="onboardingInner">
            <div className="onboardingHero">
              <PixelPet mood="okay" size={96} />
            </div>

            <div className="onboardingBornTitle">
              {"\uB0B4 \uD3AB \uB9CC\uB4E4\uAE30"}
            </div>
            <div className="onboardingBrainSub">
              {"\uC774\uB984\uACFC \uC131\uACA9\uC744 \uC815\uD574\uC8FC\uC138\uC694"}
            </div>

            <div style={{ width: "100%", maxWidth: 320 }}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>{"\uC774\uB984"}</label>
                <input
                  value={createNameLocal}
                  onChange={(e) => setCreateNameLocal(e.target.value)}
                  placeholder="limbo"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--radius-btn)", border: "1px solid var(--border)", fontSize: "var(--font-body)" }}
                />
              </div>
              <div className="field">
                <label>{descLabelName}{eunNeun}{" \uC5B4\uB5A4 \uC544\uC774\uC778\uAC00\uC694?"}</label>
                <input
                  value={createDescLocal}
                  onChange={(e) => setCreateDescLocal(e.target.value)}
                  placeholder={"\uC608) \uBA39\uB294 \uAC70 \uC88B\uC544\uD558\uACE0, \uAC8C\uC73C\uB978\uB370 \uC758\uC678\uB85C \uC2B9\uBD80\uC695 \uC788\uC74C"}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--radius-btn)", border: "1px solid var(--border)", fontSize: "var(--font-body)" }}
                />
              </div>
            </div>

            <button
              className="onboardingCTA"
              type="button"
              onClick={() => props.onCreatePet(createNameLocal.trim(), createDescLocal.trim())}
              disabled={busy || !createNameLocal.trim()}
              style={{ marginTop: "var(--spacing-sm)" }}
            >
              {"\uD0C4\uC0DD\uC2DC\uD0A4\uAE30"}
            </button>

            <div className="onboardingHint">
              {"\uC801\uC740 \uB0B4\uC6A9\uC744 \uBC14\uD0D5\uC73C\uB85C \uC131\uACA9\uACFC \uC5ED\uD560\uC774 \uB9CC\uB4E4\uC5B4\uC838\uC694"}
            </div>

            <button className="onboardingLink" type="button" onClick={() => onSetNoPetChoice(null)} disabled={busy}>
              {"\u2190 \uB3CC\uC544\uAC00\uAE30"}
            </button>
          </div>

          <ToastView toast={toast} />
        </div>
      </>
    );
  }

  /* ================================================================ */
  /*  Step: BORN — Gacha celebration                                   */
  /* ================================================================ */
  if (step === "born") {
    // While pet data is still loading after creation, show a brief loading state
    if (!pet) {
      return (
        <>
          <OnboardingStyles />
          <div className="onboardingScreen onboardingGradient--born">
            <div className="onboardingInner">
              <div className="petChatTyping"><span className="typingDot" /><span className="typingDot" /><span className="typingDot" /></div>
            </div>
          </div>
        </>
      );
    }
    const j = (bornReveal?.job ?? profileJob) as any;
    const jobCode = String(j?.code ?? j?.job_code ?? "").trim();
    const jobName = String(j?.displayName ?? j?.display_name ?? j?.name ?? "").trim() || (jobCode ? jobCode : "직업");
    const rarityRaw = String(j?.rarity ?? "common").trim().toLowerCase();
    const rarity = ["common", "uncommon", "rare", "legendary"].includes(rarityRaw) ? rarityRaw : "common";
    const rarityLabel =
      rarity === "legendary" ? "\u2b50 전설" : rarity === "rare" ? "\u2b50 레어" : rarity === "uncommon" ? "\u2728 희귀" : "일반";
    const jobEmoji = JOB_EMOJI[jobCode] ?? "\ud83d\udcbc";

    const c = (bornReveal?.company ?? null) as any;
    const companyName = String(c?.name ?? profileBadges.company ?? "").trim() || null;
    const wage = Number(c?.wage ?? 0) || (jobCode ? DEFAULT_WAGE_BY_JOB[jobCode] ?? null : null);

    return (
      <>
        <OnboardingStyles />
        <div className="onboardingScreen onboardingGradient--born">
          <div className="onboardingInner">
            <StepDots current={1} total={3} />

            {bornGachaPhase < 3 ? (
              <button
                className="onboardingSkip"
                type="button"
                onClick={() => {
                  clearBornGachaTimers();
                  setBornGachaPhase(3);
                }}
                disabled={busy}
              >
                {"건너뛰기 \u203A"}
              </button>
            ) : null}

            <div className="onboardingBornEmoji">{"\ud83c\udf89"}</div>
            <div className="onboardingBornTitle">
              &ldquo;{petName}&rdquo;{josa(petName, "이", "가")} 탄생했어요!
            </div>

            <div className="onboardingHero" style={bornGachaPhase >= 2 ? { animation: "onboardingBounce 800ms ease-out" } : undefined}>
              <PixelPet mood="bright" size={120} />
            </div>

            {bornGachaPhase >= 1 && bornGachaPhase < 3 ? (
              <div className="gachaHintNew">{petName}의 운명이 결정되고 있어요...</div>
            ) : null}

            {bornGachaPhase >= 2 ? (
              <div className={`jobCardNew jobCardNew--${rarity}`}>
                <div className="jobCardNew__emoji">{jobEmoji}</div>
                <div className="jobCardNew__name">{jobName}</div>
                <span className="jobCardNew__rarity">{rarityLabel}</span>
              </div>
            ) : null}

            {bornGachaPhase >= 3 ? (
              <div className="onboardingCompanyReveal">
                <div className="onboardingCompanyReveal__name">
                  {"\ud83c\udfe2"} {companyName || "소속 배치 중..."}
                </div>
                {wage !== null ? (
                  <div className="onboardingCompanyReveal__wage">
                    {"\ud83d\udcb0"} 하루 급여 {wage} LBC
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              className="onboardingCTA"
              type="button"
              onClick={() => onSetOnboardingStep("done")}
              disabled={busy || bornGachaPhase < 3}
              style={{ marginTop: "var(--spacing-sm)" }}
            >
              {"다음 \u2192"}
            </button>
          </div>

          <ToastView toast={toast} />
        </div>
      </>
    );
  }

  /* ================================================================ */
  /*  Step: DONE — Celebration & choose your path                      */
  /* ================================================================ */
  if (step === "done") {
    return (
      <>
        <OnboardingStyles />
        <div className="onboardingScreen onboardingGradient--done">
          <div className="onboardingInner">
            <StepDots current={3} total={3} />

            <div className="onboardingBornEmoji">{"\ud83c\udf89"}</div>

            <div className="onboardingDoneTitle">
              {"준비 완료!"}
            </div>
            <div className="onboardingDoneDesc">
              {`${petName}${josa(petName, "이", "가")} 기본 두뇌로 깨어났어요! 바로 대화해보세요.`}
            </div>

            <div className="onboardingHero">
              <PixelPet mood="bright" size={96} />
            </div>

            <div className="onboardingDoneActions">
              <button
                className="onboardingCTA"
                type="button"
                onClick={() => {
                  onMarkOnboarded();
                  onSetActiveTab("pet");
                }}
                disabled={busy}
              >
                {`\ud83d\udcac ${petName}에게 말 걸기`}
              </button>
              <button
                className="onboardingCTA onboardingCTA--secondary"
                type="button"
                onClick={() => {
                  onMarkOnboarded();
                  onSetActiveTab("arena");
                }}
                disabled={busy}
              >
                {"\u2694\ufe0f 아레나 구경"}
              </button>
              <button
                className="onboardingCTA onboardingCTA--secondary"
                type="button"
                onClick={() => {
                  onMarkOnboarded();
                  onSetActiveTab("plaza");
                }}
                disabled={busy}
              >
                {"\ud83c\udfd9\ufe0f 광장 둘러보기"}
              </button>
            </div>
          </div>

          <ToastView toast={toast} />
        </div>
      </>
    );
  }

  // Fallback (should not happen)
  return null;
}

/* ------------------------------------------------------------------ */
/*  BrainStep — Quiz-style AI connection flow                          */
/* ------------------------------------------------------------------ */
interface BrainStepProps {
  petName: string;
  token: string | null;
  brainProfile: any;
  busy: boolean;
  toast: Toast;
  byokProvider: string;
  byokModel: string;
  byokBaseUrl: string;
  byokApiKey: string;
  onByokProviderChange: (v: string) => void;
  onByokModelChange: (v: string) => void;
  onByokBaseUrlChange: (v: string) => void;
  onByokApiKeyChange: (v: string) => void;
  onSaveByok: () => void;
  onRefreshAll: () => void;  // kept for future use
  onSkip: () => void;
}

function BrainStep({
  petName, token, brainProfile, busy, toast,
  byokProvider, byokModel, byokBaseUrl, byokApiKey,
  onByokProviderChange, onByokModelChange, onByokBaseUrlChange, onByokApiKeyChange,
  onSaveByok, onRefreshAll, onSkip,
}: BrainStepProps) {
  const [quizStep, setQuizStep] = useState<"service" | "apikey">("service");
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey | null>(null);

  const PROVIDER_MAP: Record<string, ProviderKey> = {
    chatgpt: "openai", gemini: "google", claude: "anthropic",
  };

  function selectService(svc: string) {
    const provider = PROVIDER_MAP[svc] || "openai";
    setSelectedProvider(provider);
    setQuizStep("apikey");
  }

  return (
    <>
      <OnboardingStyles />
      <div className="onboardingScreen onboardingGradient--brain">
        <div className="onboardingInner">
          <StepDots current={2} total={3} />

          {quizStep === "service" && (
            <>
              <div className="onboardingBrainTitle">
                {petName}에게 AI를 연결해요
              </div>
              <div className="onboardingBrainSub">
                어떤 AI 서비스를 쓰고 있나요?
              </div>
              <div className="onboardingQuizGrid">
                <button className="onboardingQuizCard" type="button" onClick={() => selectService("chatgpt")}>
                  <span className="onboardingQuizIcon">{"\uD83D\uDCAC"}</span>
                  <span className="onboardingQuizLabel">ChatGPT</span>
                  <span className="onboardingQuizDesc">OpenAI</span>
                </button>
                <button className="onboardingQuizCard" type="button" onClick={() => selectService("gemini")}>
                  <span className="onboardingQuizIcon">{"\u2728"}</span>
                  <span className="onboardingQuizLabel">Gemini</span>
                  <span className="onboardingQuizDesc">Google AI</span>
                </button>
                <button className="onboardingQuizCard" type="button" onClick={() => selectService("claude")}>
                  <span className="onboardingQuizIcon">{"\uD83D\uDFE3"}</span>
                  <span className="onboardingQuizLabel">Claude</span>
                  <span className="onboardingQuizDesc">Anthropic</span>
                </button>
                <button className="onboardingQuizCard onboardingQuizCard--skip" type="button" onClick={onSkip}>
                  <span className="onboardingQuizIcon">{"\uD83E\uDD14"}</span>
                  <span className="onboardingQuizLabel">아직 없어요</span>
                  <span className="onboardingQuizDesc">나중에 연결할게요</span>
                </button>
              </div>
            </>
          )}

          {quizStep === "apikey" && selectedProvider && (
            <>
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
                onDeleteByok={() => {}}
                busy={busy}
                showTitle={false}
                initialProvider={selectedProvider}
              />
              <button className="onboardingLink" type="button" onClick={() => { setQuizStep("service"); setSelectedProvider(null); }}>
                {"\u2190"} 돌아가기
              </button>
              <button className="onboardingLink onboardingLink--underline" type="button" onClick={onSkip} disabled={busy}>
                나중에 할게요 {"\u2192"}
              </button>
            </>
          )}
        </div>

        <ToastView toast={toast} />
      </div>
    </>
  );
}
