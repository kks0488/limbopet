import React, { useEffect, useRef, useState, useMemo } from "react";

/* ------------------------------------------------------------------ */
/*  Color palette                                                     */
/* ------------------------------------------------------------------ */
const C = {
  j1: "#c9b8f0",
  j2: "#ddd0f8",
  j3: "#b49de6",
  j4: "#9a82d4",
  j5: "#e8dffc",
  g1: "#f0c6e8",
  g2: "#d9aee0",
  e1: "#2d2345",
  e2: "#ffffff",
  ck: "#f7b8d4",
  m1: "#c9a0d0",
  s1: "#ffe8b8",
  s2: "#b8e8ff",
} as const;

const T = "transparent";

/* ------------------------------------------------------------------ */
/*  Sprite frames  (18x18)                                            */
/* ------------------------------------------------------------------ */

const idle1: string[][] = [
  [T,T,T,T,T,T,T,T,T,T,T,T,T,C.s2,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,T,T,T,T,T,T,C.j4,C.j4,C.j4,C.j4,T,T,T,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j3,C.j2,C.j5,C.j5,C.j2,C.j3,C.j4,T,T,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j1,C.j2,C.j5,C.j5,C.j2,C.j1,C.j3,C.j4,T,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j2,C.j2,C.j2,C.j2,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j2,C.j2,C.j1,C.j1,C.j1,C.j1,C.j4,T,T,T],
  [T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.g2,C.g2,C.j1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.e1,C.e1,C.j1,C.g1,C.g1,C.j1,C.e1,C.e1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.e1,C.e2,C.j1,C.g2,C.g2,C.j1,C.e1,C.e2,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j3,C.j1,C.ck,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.ck,C.j1,C.j3,C.j4,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.m1,C.m1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j3,C.j1,C.j1,C.j1,C.j1,C.j3,C.j3,C.j4,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j4,C.j3,C.j3,C.j3,C.j3,C.j4,C.j4,T,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,C.s1,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
];

// Blink frame: eyes become horizontal lines
const idle2: string[][] = [
  [T,T,T,T,T,T,T,T,T,T,T,T,T,C.s2,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,T,T,T,T,T,T,C.j4,C.j4,C.j4,C.j4,T,T,T,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j3,C.j2,C.j5,C.j5,C.j2,C.j3,C.j4,T,T,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j1,C.j2,C.j5,C.j5,C.j2,C.j1,C.j3,C.j4,T,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j2,C.j2,C.j2,C.j2,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j2,C.j2,C.j1,C.j1,C.j1,C.j1,C.j4,T,T,T],
  [T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.g2,C.g2,C.j1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j1,C.g1,C.g1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.e1,C.e1,C.j1,C.g2,C.g2,C.j1,C.e1,C.e1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j3,C.j1,C.ck,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.ck,C.j1,C.j3,C.j4,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.m1,C.m1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j3,C.j1,C.j1,C.j1,C.j1,C.j3,C.j3,C.j4,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j4,C.j3,C.j3,C.j3,C.j3,C.j4,C.j4,T,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,C.s1,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
];

// Happy: brighter glow, big smile, more sparkles
const happy: string[][] = [
  [T,T,T,T,C.s2,T,T,T,T,T,T,T,T,C.s1,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,C.s2,T],
  [T,T,T,T,T,T,T,C.j4,C.j4,C.j4,C.j4,T,T,T,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j3,C.j2,C.j5,C.j5,C.j2,C.j3,C.j4,T,T,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j1,C.j2,C.j5,C.j5,C.j2,C.j1,C.j3,C.j4,T,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j2,C.j2,C.j2,C.j2,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j2,C.j2,C.j1,C.j1,C.j1,C.j1,C.j4,T,T,T],
  [T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.g1,C.g1,C.j1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.e1,C.e1,C.j1,C.g1,C.g1,C.j1,C.e1,C.e1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.e1,C.e2,C.j1,C.g1,C.g1,C.j1,C.e1,C.e2,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j3,C.j1,C.ck,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.ck,C.j1,C.j3,C.j4,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.m1,C.m1,C.m1,C.m1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.g1,C.g1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j3,C.j1,C.j1,C.j1,C.j1,C.j3,C.j3,C.j4,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j4,C.j3,C.j3,C.j3,C.j3,C.j4,C.j4,T,T,T,T,T],
  [T,C.s1,T,T,T,T,T,T,T,T,T,T,T,T,T,C.s2,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
];

// Sleepy: closed eyes (lines), small mouth, no sparkles
const sleepy: string[][] = [
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,T,T,T,T,T,T,C.j4,C.j4,C.j4,C.j4,T,T,T,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j3,C.j2,C.j5,C.j5,C.j2,C.j3,C.j4,T,T,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j1,C.j2,C.j5,C.j5,C.j2,C.j1,C.j3,C.j4,T,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j2,C.j2,C.j2,C.j2,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j2,C.j2,C.j1,C.j1,C.j1,C.j1,C.j4,T,T,T],
  [T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.g2,C.g2,C.j1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j1,C.g2,C.g2,C.j1,C.j1,C.j1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.e1,C.e1,C.j1,C.g2,C.g2,C.j1,C.e1,C.e1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j3,C.j1,C.ck,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.ck,C.j1,C.j3,C.j4,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.m1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j3,C.j1,C.j1,C.j1,C.j1,C.j3,C.j3,C.j4,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j4,C.j3,C.j3,C.j3,C.j3,C.j4,C.j4,T,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
];

// Love: heart eyes, big smile, sparkles
const love: string[][] = [
  [T,T,T,T,C.s1,T,T,T,T,T,T,T,C.s2,T,T,T,C.s1,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,T,T,T,T,T,T,C.j4,C.j4,C.j4,C.j4,T,T,T,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j3,C.j2,C.j5,C.j5,C.j2,C.j3,C.j4,T,T,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j1,C.j2,C.j5,C.j5,C.j2,C.j1,C.j3,C.j4,T,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j2,C.j2,C.j2,C.j2,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j2,C.j2,C.j1,C.j1,C.j1,C.j1,C.j4,T,T,T],
  [T,T,C.j4,C.j3,C.j1,C.ck,C.j1,C.j1,C.g1,C.g1,C.j1,C.j1,C.ck,C.j1,C.j3,C.j4,T,T],
  [T,T,C.j4,C.j1,C.ck,C.ck,C.ck,C.j1,C.g1,C.g1,C.j1,C.ck,C.ck,C.ck,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.ck,C.j1,C.j1,C.g1,C.g1,C.j1,C.j1,C.ck,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.j4,T,T],
  [T,T,C.j4,C.j3,C.j1,C.ck,C.j1,C.j1,C.j1,C.j1,C.j1,C.j1,C.ck,C.j1,C.j3,C.j4,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.m1,C.m1,C.m1,C.m1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,C.j4,C.j3,C.j1,C.j1,C.j1,C.g1,C.g1,C.j1,C.j1,C.j1,C.j3,C.j4,T,T,T],
  [T,T,T,T,C.j4,C.j3,C.j3,C.j1,C.j1,C.j1,C.j1,C.j3,C.j3,C.j4,T,T,T,T],
  [T,T,T,T,T,C.j4,C.j4,C.j3,C.j3,C.j3,C.j3,C.j4,C.j4,T,T,T,T,T],
  [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
  [T,C.s2,T,T,T,T,T,T,T,T,T,T,T,T,T,C.s1,T,T],
];

const SPRITES = { idle1, idle2, happy, sleepy, love };

type SpriteKey = keyof typeof SPRITES;

/* ------------------------------------------------------------------ */
/*  Mood to sprite mapping                                            */
/* ------------------------------------------------------------------ */
function moodToSprite(mood: string): SpriteKey {
  switch (mood) {
    case "bright":
      return "happy";
    case "okay":
      return "idle1";
    case "low":
    case "gloomy":
      return "sleepy";
    default:
      return "idle1";
  }
}

/* ------------------------------------------------------------------ */
/*  Animation mapping                                                 */
/* ------------------------------------------------------------------ */
function moodToDefaultAnim(mood: string): string {
  switch (mood) {
    case "bright":
      return "gentleFloat";
    case "low":
    case "gloomy":
      return "sleepyDrift";
    default:
      return "gentleFloat";
  }
}

function animClassToAnim(animClass: string): string {
  switch (animClass) {
    case "petEatAnim":
      return "happyBounce";
    case "petPlayAnim":
      return "jellyWiggle";
    case "petSleepAnim":
      return "sleepyDrift";
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Sparkle particle positions (random-ish)                           */
/* ------------------------------------------------------------------ */
interface Sparkle {
  x: number;
  y: number;
  color: string;
  delay: number;
  size: number;
}

function generateSparkles(): Sparkle[] {
  const sparkles: Sparkle[] = [];
  const positions = [
    { x: 10, y: 5 },
    { x: 85, y: 8 },
    { x: 15, y: 80 },
    { x: 90, y: 75 },
    { x: 50, y: 2 },
  ];
  for (let i = 0; i < positions.length; i++) {
    sparkles.push({
      x: positions[i].x,
      y: positions[i].y,
      color: i % 2 === 0 ? C.s1 : C.s2,
      delay: i * 0.7,
      size: 3 + (i % 2),
    });
  }
  return sparkles;
}

/* ------------------------------------------------------------------ */
/*  Injected CSS (once)                                               */
/* ------------------------------------------------------------------ */
const STYLE_ID = "pixelpet-keyframes";

function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const css = `
@keyframes gentleFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}
@keyframes happyBounce {
  0%, 100% { transform: translateY(0) scaleX(1) scaleY(1); }
  20% { transform: translateY(-12px) scaleX(0.94) scaleY(1.06); }
  40% { transform: translateY(0) scaleX(1.06) scaleY(0.94); }
  60% { transform: translateY(-8px) scaleX(0.97) scaleY(1.03); }
  80% { transform: translateY(0) scaleX(1.03) scaleY(0.97); }
}
@keyframes jellyWiggle {
  0%, 100% { transform: scaleX(1) scaleY(1) rotate(0deg); }
  15% { transform: scaleX(1.08) scaleY(0.93) rotate(-2deg); }
  30% { transform: scaleX(0.93) scaleY(1.06) rotate(2deg); }
  45% { transform: scaleX(1.05) scaleY(0.95) rotate(-1deg); }
  60% { transform: scaleX(0.96) scaleY(1.04) rotate(1deg); }
  75% { transform: scaleX(1.03) scaleY(0.97) rotate(0deg); }
}
@keyframes sleepyDrift {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(3px) rotate(-2deg); }
  75% { transform: translateY(3px) rotate(2deg); }
}
@keyframes sparkleFlicker {
  0%, 100% { opacity: 0; transform: scale(0); }
  50% { opacity: 1; transform: scale(1); }
}
`;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Grid size                                                         */
/* ------------------------------------------------------------------ */
const GRID = 18;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

interface PixelPetProps {
  mood: string; // "bright" | "okay" | "low" | "gloomy"
  size?: number; // default 120
  animClass?: string; // "petEatAnim" | "petPlayAnim" | "petSleepAnim" | etc
  forceSparkle?: boolean; // 기억 인용 시 sparkle 강제 표시
}

export function PixelPet({ mood, size = 120, animClass = "", forceSparkle = false }: PixelPetProps) {
  const [blinking, setBlinking] = useState(false);
  const blinkTimerRef = useRef<number | null>(null);
  const sparkles = useMemo(generateSparkles, []);

  // Inject keyframes CSS once
  useEffect(() => {
    ensureStyles();
  }, []);

  // Blink loop for idle/okay mood
  useEffect(() => {
    const shouldBlink = mood === "okay" || mood === "bright";
    if (!shouldBlink) {
      setBlinking(false);
      return;
    }

    let cancelled = false;
    const innerTimerRef = { current: null as number | null };

    function scheduleBlink() {
      const interval = 3000 + Math.random() * 1500; // 3-4.5s
      blinkTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        innerTimerRef.current = window.setTimeout(() => {
          if (cancelled) return;
          setBlinking(false);
          scheduleBlink();
        }, 200);
      }, interval);
    }

    scheduleBlink();

    return () => {
      cancelled = true;
      if (blinkTimerRef.current !== null) {
        clearTimeout(blinkTimerRef.current);
      }
      if (innerTimerRef.current !== null) {
        clearTimeout(innerTimerRef.current);
      }
    };
  }, [mood]);

  // Determine which sprite to render
  let spriteKey: SpriteKey = moodToSprite(mood);
  if (blinking && (spriteKey === "idle1" || spriteKey === "happy")) {
    spriteKey = "idle2";
  }

  const sprite = SPRITES[spriteKey];

  // Determine animation
  const overrideAnim = animClass ? animClassToAnim(animClass) : "";
  const defaultAnim = moodToDefaultAnim(mood);
  const activeAnim = overrideAnim || defaultAnim;

  const pixelSize = size / GRID;

  // Show sparkles for bright/happy states or when forced (memory citation)
  const showSparkles = forceSparkle || mood === "bright";

  const containerStyle: React.CSSProperties = {
    position: "relative",
    width: size,
    height: size,
    display: "inline-block",
  };

  const gridWrapStyle: React.CSSProperties = {
    width: size,
    height: size,
    animation: `${activeAnim} ${activeAnim === "happyBounce" ? "0.8s" : activeAnim === "jellyWiggle" ? "0.7s" : activeAnim === "sleepyDrift" ? "4s" : "3s"} ease-in-out ${activeAnim === "happyBounce" || activeAnim === "jellyWiggle" ? "2" : "infinite"}`,
    position: "relative",
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${GRID}, ${pixelSize}px)`,
    gridTemplateRows: `repeat(${GRID}, ${pixelSize}px)`,
    width: size,
    height: size,
    imageRendering: "pixelated" as React.CSSProperties["imageRendering"],
  };

  return (
    <div style={containerStyle}>
      <div style={gridWrapStyle}>
        <div style={gridStyle}>
          {sprite.map((row, ri) =>
            row.map((color, ci) => (
              <div
                key={`${ri}-${ci}`}
                style={{
                  width: pixelSize,
                  height: pixelSize,
                  backgroundColor: color,
                  borderRadius: color !== T ? 2 : 0,
                }}
              />
            )),
          )}
        </div>

        {/* Sparkle particles */}
        {showSparkles &&
          sparkles.map((s, i) => (
            <div
              key={`sparkle-${i}`}
              style={{
                position: "absolute",
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.size,
                height: s.size,
                borderRadius: "50%",
                backgroundColor: s.color,
                animation: `sparkleFlicker 2s ease-in-out ${s.delay}s infinite`,
                pointerEvents: "none",
              }}
            />
          ))}
      </div>
    </div>
  );
}
