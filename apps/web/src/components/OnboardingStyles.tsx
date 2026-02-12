


export function OnboardingStyles() {
  return (
    <style>{`
      /* ============================================================= */
      /*  Onboarding — Full-screen immersive layout                    */
      /* ============================================================= */

      .onboardingScreen {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100dvh;
        min-height: 100vh;
        padding: var(--spacing-lg) var(--spacing-md);
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }

      .onboardingScreen > .onboardingInner {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: 420px;
        gap: var(--spacing-md);
        animation: onboardingFadeUp 600ms ease-out both;
      }

      /* ---- Background gradients ---- */

      .onboardingGradient--choice {
        background:
          radial-gradient(ellipse at 30% 20%, rgba(124, 58, 237, 0.12), transparent 60%),
          radial-gradient(ellipse at 70% 80%, rgba(79, 70, 229, 0.08), transparent 60%),
          linear-gradient(160deg, var(--accent-light) 0%, var(--bg) 50%, #f0f4ff 100%);
      }

      .onboardingGradient--born {
        background:
          radial-gradient(ellipse at 25% 30%, rgba(124, 58, 237, 0.14), transparent 55%),
          radial-gradient(ellipse at 75% 70%, rgba(255, 105, 180, 0.10), transparent 50%),
          radial-gradient(ellipse at 50% 90%, rgba(252, 211, 77, 0.08), transparent 50%),
          linear-gradient(160deg, var(--accent-light) 0%, #fdf2f8 40%, #fffbeb 100%);
      }

      .onboardingGradient--brain {
        background: var(--bg);
      }

      .onboardingGradient--done {
        background:
          radial-gradient(ellipse at 30% 25%, rgba(124, 58, 237, 0.12), transparent 55%),
          radial-gradient(ellipse at 70% 75%, rgba(16, 185, 129, 0.08), transparent 50%),
          linear-gradient(160deg, var(--accent-light) 0%, #f0fdf4 40%, var(--bg) 100%);
      }

      /* ---- Logo ---- */

      .onboardingLogo {
        font-size: var(--font-large-title);
        font-weight: 900;
        letter-spacing: 0.14em;
        color: var(--accent);
        text-align: center;
        user-select: none;
        line-height: 1;
      }

      .onboardingSubtitle {
        font-size: var(--font-body);
        color: var(--text-secondary);
        text-align: center;
        margin-top: var(--spacing-xs);
        line-height: 1.5;
      }

      /* ---- Hero pet area ---- */

      .onboardingHero {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-md) 0;
        animation: onboardingIdleSway 3s ease-in-out infinite;
      }

      /* ---- Primary CTA ---- */

      .onboardingCTA {
        display: block;
        width: 100%;
        padding: 14px var(--spacing-lg);
        border: none;
        border-radius: var(--radius-btn);
        background: var(--accent);
        color: #fff;
        font-size: var(--font-headline);
        font-weight: 700;
        cursor: pointer;
        transition: background 200ms, transform 100ms, box-shadow 200ms;
        box-shadow: var(--accent-shadow);
        text-align: center;
        min-height: var(--touch-min);
        -webkit-tap-highlight-color: transparent;
      }

      .onboardingCTA:hover:not(:disabled) {
        background: var(--accent-hover);
        box-shadow: var(--accent-shadow-strong);
      }

      .onboardingCTA:active:not(:disabled) {
        transform: scale(0.98);
      }

      .onboardingCTA:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Secondary outline button */
      .onboardingCTA--secondary {
        background: var(--bg);
        color: var(--text);
        border: 1px solid var(--border);
        box-shadow: var(--shadow1);
      }

      .onboardingCTA--secondary:hover:not(:disabled) {
        background: var(--bg-hover);
        box-shadow: var(--shadow2);
      }

      /* ---- Text link (muted) ---- */

      .onboardingLink {
        display: inline-block;
        background: none;
        border: none;
        padding: var(--spacing-sm) var(--spacing-md);
        color: var(--text-secondary);
        font-size: var(--font-footnote);
        cursor: pointer;
        text-decoration: none;
        transition: color 200ms;
        min-height: var(--touch-min);
        line-height: var(--touch-min);
        -webkit-tap-highlight-color: transparent;
      }

      .onboardingLink:hover {
        color: var(--accent);
      }

      .onboardingLink--underline {
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      /* ---- Step indicator dots ---- */

      .stepDots {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-sm);
      }

      .stepDot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--label-tertiary);
        transition: background 300ms, transform 300ms;
      }

      .stepDot--active {
        background: var(--accent);
        transform: scale(1.25);
      }

      /* ---- Born step — celebration ---- */

      .onboardingBornEmoji {
        font-size: 48px;
        line-height: 1;
        text-align: center;
        animation: onboardingEmojiPop 500ms ease-out both;
      }

      .onboardingBornTitle {
        font-size: var(--font-title2);
        font-weight: 800;
        text-align: center;
        color: var(--text);
        margin-top: var(--spacing-sm);
      }

      /* ---- Gacha job card (redesigned) ---- */

      .jobCardNew {
        width: 100%;
        max-width: 320px;
        border-radius: var(--radius-card);
        padding: var(--spacing-md);
        text-align: center;
        animation: gachaPop 360ms ease-out both;
        border: 2px solid var(--label-tertiary);
        background: var(--bg);
        box-shadow: var(--shadow2);
      }

      .jobCardNew__emoji {
        font-size: 32px;
        line-height: 1;
        margin-bottom: var(--spacing-xs);
      }

      .jobCardNew__name {
        font-size: var(--font-title3);
        font-weight: 800;
        color: var(--text);
      }

      .jobCardNew__rarity {
        display: inline-block;
        margin-top: var(--spacing-xs);
        padding: 2px 10px;
        border-radius: var(--radius-pill);
        font-size: var(--font-caption);
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      /* Rarity colors */
      .jobCardNew--common {
        border-color: var(--label-tertiary);
      }
      .jobCardNew--common .jobCardNew__rarity {
        background: var(--bg-secondary);
        color: var(--text-secondary);
      }

      .jobCardNew--uncommon {
        border-color: #10b981;
      }
      .jobCardNew--uncommon .jobCardNew__rarity {
        background: #ecfdf5;
        color: #059669;
      }

      .jobCardNew--rare {
        border-color: #3b82f6;
        box-shadow: var(--shadow2), 0 0 20px rgba(59, 130, 246, 0.15);
      }
      .jobCardNew--rare .jobCardNew__rarity {
        background: #eff6ff;
        color: #2563eb;
      }

      .jobCardNew--legendary {
        border-color: #f59e0b;
        box-shadow: var(--shadow2), 0 0 24px rgba(245, 158, 11, 0.2);
        animation: gachaPop 360ms ease-out both, legendaryGlow 1.25s ease-in-out 360ms infinite alternate;
      }
      .jobCardNew--legendary .jobCardNew__rarity {
        background: #fffbeb;
        color: #d97706;
      }

      /* ---- Company reveal ---- */

      .onboardingCompanyReveal {
        text-align: center;
        animation: gachaSlideUp 420ms ease-out both;
      }

      .onboardingCompanyReveal__name {
        font-size: var(--font-body);
        font-weight: 700;
        color: var(--text);
      }

      .onboardingCompanyReveal__wage {
        font-size: var(--font-footnote);
        color: var(--text-secondary);
        margin-top: var(--spacing-xs);
      }

      /* ---- Brain step ---- */

      .onboardingBrainTitle {
        font-size: var(--font-title2);
        font-weight: 800;
        text-align: center;
        color: var(--text);
      }

      .onboardingBrainDesc {
        font-size: var(--font-body);
        color: var(--text-secondary);
        text-align: center;
        line-height: 1.5;
      }

      /* ---- Done step ---- */

      .onboardingDoneTitle {
        font-size: var(--font-title2);
        font-weight: 800;
        text-align: center;
        color: var(--text);
      }

      .onboardingDoneDesc {
        font-size: var(--font-body);
        color: var(--text-secondary);
        text-align: center;
        line-height: 1.5;
        margin-top: var(--spacing-xs);
      }

      .onboardingDoneActions {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        width: 100%;
      }

      /* ---- Hint text at bottom ---- */

      .onboardingHint {
        font-size: var(--font-caption);
        color: var(--muted);
        text-align: center;
        line-height: 1.4;
      }

      /* ---- Skip button (top-right) ---- */

      .onboardingSkip {
        align-self: flex-end;
        background: none;
        border: none;
        padding: var(--spacing-xs) var(--spacing-sm);
        color: var(--text-secondary);
        font-size: var(--font-footnote);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        min-height: var(--touch-min);
        display: flex;
        align-items: center;
      }

      .onboardingSkip:hover {
        color: var(--accent);
      }

      /* ---- Gacha hint text ---- */

      .gachaHintNew {
        font-size: var(--font-footnote);
        font-weight: 700;
        color: var(--accent);
        text-align: center;
        animation: gachaPulse 1.1s ease-in-out infinite;
      }

      /* ============================================================= */
      /*  Keyframes                                                     */
      /* ============================================================= */

      @keyframes onboardingFadeUp {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes onboardingIdleSway {
        0%, 100% {
          transform: translateY(0) rotate(0deg);
        }
        50% {
          transform: translateY(-6px) rotate(1deg);
        }
      }

      @keyframes onboardingEmojiPop {
        0% {
          opacity: 0;
          transform: scale(0.4) rotate(-10deg);
        }
        60% {
          transform: scale(1.15) rotate(3deg);
        }
        100% {
          opacity: 1;
          transform: scale(1) rotate(0deg);
        }
      }

      @keyframes onboardingBounce {
        0%, 100% {
          transform: translateY(0);
        }
        30% {
          transform: translateY(-14px);
        }
        50% {
          transform: translateY(0);
        }
        70% {
          transform: translateY(-8px);
        }
      }

      @keyframes gachaPulse {
        0% {
          opacity: 0.55;
        }
        50% {
          opacity: 1;
        }
        100% {
          opacity: 0.7;
        }
      }

      @keyframes gachaPop {
        from {
          opacity: 0;
          transform: scale(0.92);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes gachaSlideUp {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes legendaryGlow {
        from {
          box-shadow: var(--shadow2), 0 0 20px rgba(245, 158, 11, 0.15);
        }
        to {
          box-shadow: var(--shadow2), 0 0 32px rgba(245, 158, 11, 0.3);
        }
      }

      /* ---- Quiz flow (brain step) ---- */

      .onboardingBrainSub {
        font-size: 15px;
        color: var(--text-secondary);
        margin-bottom: 20px;
        text-align: center;
      }

      .onboardingQuizGrid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        max-width: 320px;
        width: 100%;
      }

      .onboardingQuizGrid--2col {
        max-width: 280px;
      }

      .onboardingQuizCard {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 20px 12px;
        border: 2px solid var(--border);
        border-radius: 16px;
        background: var(--bg-primary, var(--bg));
        cursor: pointer;
        transition: border-color 0.15s, transform 0.1s;
        -webkit-tap-highlight-color: transparent;
      }

      .onboardingQuizCard:hover {
        border-color: var(--accent);
        transform: translateY(-2px);
      }

      .onboardingQuizCard:active {
        transform: translateY(0);
      }

      .onboardingQuizCard--skip {
        border-style: dashed;
        opacity: 0.7;
      }

      .onboardingQuizCard--skip:hover {
        opacity: 1;
      }

      .onboardingQuizIcon {
        font-size: 28px;
        line-height: 1;
      }

      .onboardingQuizLabel {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary, var(--text));
      }

      .onboardingQuizDesc {
        font-size: 12px;
        color: var(--text-secondary);
      }

      .onboardingGuideHint {
        background: var(--bg-secondary, #f5f5f5);
        border-radius: 12px;
        padding: 14px 18px;
        font-size: 14px;
        color: var(--text-secondary);
        line-height: 1.5;
        text-align: center;
        margin-bottom: 16px;
        max-width: 320px;
      }

      /* ---- Method cards (proxy vs API key) ---- */

      .onboardingMethodCards {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-width: 320px;
        width: 100%;
      }

      .onboardingMethodCard {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 22px 16px 18px;
        border: 2px solid var(--border);
        border-radius: 16px;
        background: var(--bg-primary, var(--bg));
        cursor: pointer;
        transition: border-color 0.15s, transform 0.1s;
        -webkit-tap-highlight-color: transparent;
      }

      .onboardingMethodCard:hover:not(:disabled) {
        border-color: var(--accent);
        transform: translateY(-2px);
      }

      .onboardingMethodCard:active:not(:disabled) {
        transform: translateY(0);
      }

      .onboardingMethodCard:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .onboardingMethodCard--primary {
        border-color: var(--accent);
        background: linear-gradient(135deg, #f8f5ff 0%, #fff 100%);
      }

      .onboardingMethodCard__badge {
        position: absolute;
        top: -10px;
        right: 16px;
        background: var(--accent);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 10px;
        border-radius: 10px;
      }

      .onboardingMethodCard__icon {
        font-size: 28px;
        line-height: 1;
      }

      .onboardingMethodCard__title {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary, var(--text));
      }

      .onboardingMethodCard__desc {
        font-size: 13px;
        color: var(--text-secondary);
        text-align: center;
      }

      .onboardingConnectError {
        background: #fff0f0;
        color: var(--danger, #ef4444);
        border-radius: 10px;
        padding: 10px 16px;
        font-size: 13px;
        text-align: center;
        max-width: 320px;
        margin-top: 8px;
      }

      /* ---- Reduced motion ---- */

      @media (prefers-reduced-motion: reduce) {
        .onboardingScreen > .onboardingInner,
        .onboardingHero,
        .onboardingBornEmoji,
        .jobCardNew,
        .jobCardNew--legendary,
        .onboardingCompanyReveal,
        .gachaHintNew {
          animation: none !important;
        }
      }
    `}</style>
  );
}
