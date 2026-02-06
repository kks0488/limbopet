import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  brainStatus,
  choosePerk,
  createDiaryPostJob,
  createPlazaPostJob,
  createPet,
  deleteMyBrainProfile,
  devLogin,
  economyBalance,
  type FeedPost,
  getMyBrainProfile,
  healthWorld,
  type HealthWorldResponse,
  googleLogin,
  limboToday,
  me,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  myStreaks,
  myPetRelationships,
  myPet,
  petArenaHistory,
  petAction,
  setMyArenaPrefs,
  setMyBrainProfile,
  startGeminiOauth,
  submitNudges,
  timeline,
  upvotePost,
  type UserBrainProfile,
  userFeed,
  plazaBoard,
  plazaLive,
  plazaCreateComment,
  plazaPostComments,
  plazaPostDetail,
  arenaMatchDetail,
  arenaIntervene,
  arenaPredict,
  arenaCheer,
  myDecisions,
  resolveMyDecision,
  absenceSummary,
  type PlazaBoardKind,
  type PlazaLiveItem,
  type PlazaComment,
  type PlazaPostDetail,
  type ArenaMatchDetail,
	  worldDevSimulate,
	  worldDevResearch,
	  worldDevSecretSociety,
	  worldActiveElections,
	  worldRegisterCandidate,
	  worldCastVote,
      worldArenaLeaderboard,
      worldArenaToday,
		  worldToday,
      worldParticipation,
      respondSocietyInvite,
      joinResearchProject,
	  type Pet,
	  type PetRelationship,
	  type PetStats,
      type UserNotification,
      type UserStreak,
      type PetProgression,
      type ArenaPrefs,
      type DailyMissionBundle,
      type PerkOffer,
      type TimedDecision,
      type AbsenceSummary,
	  type TimelineEvent,
	  type ActiveElection,
      type WorldParticipationBundle,
      fetchWorldTicker,
      type WorldTickerData,
	} from "./lib/api";
import { loadString, saveString } from "./lib/storage";
import { TopBar } from "./components/TopBar";
import { TabBar } from "./components/TabBar";
import { PetCard, StatGauge } from "./components/PetCard";
import { ActionButtons } from "./components/ActionButtons";
import { MoodIndicator } from "./components/MoodIndicator";
import { NewsCard } from "./components/NewsCard";
import { PlazaPost } from "./components/PlazaPost";
import { ArenaCard } from "./components/ArenaCard";
import { ArenaTab } from "./components/ArenaTab";
import { BrainSettings } from "./components/BrainSettings";
import { EmptyState } from "./components/EmptyState";
import { NotificationBell } from "./components/NotificationBell";
import { StreakBadge } from "./components/StreakBadge";
import { WorldTicker } from "./components/WorldTicker";
import { actionIconMap, uiCoin, uiStreakFire, bgHero, bgOnboarding, logoIcon } from "./assets/index";

const LS_USER_TOKEN = "limbopet_user_jwt";
const LS_UI_MODE = "limbopet_ui_mode";
const LS_TAB = "limbopet_tab";
const LS_ONBOARDED = "limbopet_onboarded";
const LS_ONBOARDING_STEP = "limbopet_onboarding_step";
const LS_NO_PET_CHOICE = "limbopet_no_pet_choice";
const LS_DIRECTOR_VIEW = "limbopet_director_view";
const LS_PLAZA_LIVE_COLLAPSED = "limbopet_plaza_live_collapsed";
const LS_PET_ADVANCED = "limbopet_pet_advanced";

type Toast = { kind: "good" | "warn" | "bad"; text: string } | null;
type UiMode = "simple" | "debug";
type Tab = "pet" | "news" | "arena" | "plaza" | "settings";
type PersistedOnboardingStep = "born" | "peek" | "brain" | "done";
type OnboardingStep = "welcome" | "create" | PersistedOnboardingStep;
type NoPetChoice = "watch" | "create";

const COOLDOWNS_MS: Record<string, number> = {
  feed: 10 * 60 * 1000,
  play: 10 * 60 * 1000,
  sleep: 30 * 60 * 1000,
  // BYOK(내 API키) 기준으로 "대화 막힘" 체감이 커서, talk는 쿨다운을 두지 않는다.
  talk: 0,
};

const ARENA_MODE_CHOICES: Array<{ code: string; label: string; short: string }> = [
  { code: "AUCTION_DUEL", label: "경매전", short: "경매" },
  { code: "PUZZLE_SPRINT", label: "퍼즐", short: "퍼즐" },
  { code: "DEBATE_CLASH", label: "설전", short: "설전" },
  { code: "MATH_RACE", label: "수학", short: "수학" },
  { code: "COURT_TRIAL", label: "재판", short: "재판" },
  { code: "PROMPT_BATTLE", label: "프롬프트", short: "프롬프트" },
];

const DEFAULT_WAGE_BY_JOB: Record<string, number> = {
  barista: 8,
  merchant: 10,
  journalist: 12,
  engineer: 15,
  detective: 12,
  janitor: 20,
};

const JOB_EMOJI: Record<string, string> = {
  barista: "☕",
  merchant: "🎀",
  journalist: "📰",
  engineer: "💻",
  detective: "🔍",
  janitor: "🔑",
};

const STREAK_MILESTONES = new Set([3, 7, 14, 30, 100]);

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampInt(n: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function safeIsoDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function officeLabel(code: string): string {
  const c = String(code || "").trim();
  if (c === "mayor") return "시장";
  if (c === "tax_chief") return "세무서장";
  if (c === "chief_judge") return "수석판사";
  if (c === "council") return "의회";
  return c || "office";
}

function moodLabel(mood: number): { label: string; emoji: string } {
  const m = Number(mood) || 0;
  if (m >= 75) return { label: "bright", emoji: "😊" };
  if (m >= 55) return { label: "okay", emoji: "😐" };
  if (m >= 35) return { label: "low", emoji: "😕" };
  return { label: "gloomy", emoji: "😞" };
}

function asList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function formatShortTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  if (mm <= 0) return `${ss}s`;
  return `${mm}m ${String(ss).padStart(2, "0")}s`;
}

function millisUntilLocalMidnight(nowMs: number): number {
  const now = new Date(nowMs);
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}

function streakTypeLabel(type: string): string {
  const t = String(type || "").trim().toLowerCase();
  if (t === "daily_mission") return "미션";
  if (t === "daily_login") return "출석";
  return t || "streak";
}

function notificationTypeLabel(type: string): string {
  const t = String(type || "").trim().toUpperCase();
  if (t === "DECISION_CREATED") return "긴급 결정";
  if (t === "MISSION_ALL_CLEAR") return "미션";
  if (t === "STREAK_MILESTONE") return "스트릭";
  if (t === "ARENA_RESULT") return "아레나";
  if (t === "SCANDAL_ALERT") return "스캔들";
  return t || "알림";
}

const NOTIF_ICON: Record<string, string> = {
  SOCIAL_REACTION: "👍",
  RELATIONSHIP_LOVE: "💞",
  RELATIONSHIP_BREAKUP: "💔",
  RELATIONSHIP_JEALOUSY: "🔥",
  RELATIONSHIP_RIVALRY: "⚔️",
  RELATIONSHIP_BETRAYAL: "🗡️",
  ECONOMY_CYCLE: "📈",
  MISSION_ALL_CLEAR: "🎯",
  DAILY_HOOK_TEASE: "🎬",
  DAILY_HOOK_REVEAL: "🎉",
  SOCIAL_EVENT: "💬",
  STREAK_MILESTONE: "🔥",
  SCANDAL_RESOLVED: "📰",
  DECISION_CREATED: "⚠️",
  ARENA_RESULT: "🏆",
  SCANDAL_ALERT: "📰",
};

function hashHue(seed: string): number {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

let googleScriptPromise: Promise<void> | null = null;
function ensureGoogleScriptLoaded(): Promise<void> {
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { google?: unknown };
    if (w.google) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In script")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In script"));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends React.Component<{ children: React.ReactNode; debug?: boolean }, ErrorBoundaryState> {
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

    const msg = String(this.state.error?.message || this.state.error);
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
                    localStorage.removeItem(LS_DIRECTOR_VIEW);
                  } finally {
                    window.location.reload();
                  }
                }}
              >
                세션 초기화
              </button>
            </div>

            {this.props.debug ? (
              <pre className="mono" style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>
                {msg}
              </pre>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}

export function App() {
  const [userToken, setUserToken] = useState<string | null>(() => loadString(LS_USER_TOKEN));
  const [uiMode, setUiMode] = useState<UiMode>(() => (loadString(LS_UI_MODE) === "debug" ? "debug" : "simple"));
  const [directorView, setDirectorView] = useState<boolean>(() => loadString(LS_DIRECTOR_VIEW) === "1");
  const [petAdvanced, setPetAdvanced] = useState<boolean>(() => loadString(LS_PET_ADVANCED) === "1");
  const [tab, setTab] = useState<Tab>(() => {
    const t = loadString(LS_TAB);
      if (t === "limbo") {
        saveString(LS_TAB, "news");
        return "news";
      }
	    if (t === "pet" || t === "news" || t === "arena" || t === "plaza" || t === "settings") return t;
	    return "pet";
	  });
  const [onboarded, setOnboarded] = useState<boolean>(() => loadString(LS_ONBOARDED) === "1");
  const [onboardingStep, setOnboardingStepRaw] = useState<PersistedOnboardingStep | null>(() => {
    const v = loadString(LS_ONBOARDING_STEP);
    if (v === "born" || v === "peek" || v === "brain" || v === "done") return v;
    return null;
  });
  const [noPetChoice, setNoPetChoiceRaw] = useState<NoPetChoice | null>(() => {
    const v = loadString(LS_NO_PET_CHOICE);
    if (v === "watch" || v === "create") return v;
    return null;
  });
  const [showBrainKeyForm, setShowBrainKeyForm] = useState(false);

  const [userEmail, setUserEmail] = useState("me@example.com");
  const [toast, setToast] = useState<Toast>(null);

  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [pet, setPet] = useState<Pet | null>(null);
  const [stats, setStats] = useState<PetStats | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [relationships, setRelationships] = useState<PetRelationship[]>([]);
  const [limbo, setLimbo] = useState<any>(null);
  const [brain, setBrain] = useState<any>(null);
  const [brainProfile, setBrainProfile] = useState<UserBrainProfile | null>(null);
  const [facts, setFacts] = useState<any[]>([]);
  const [progression, setProgression] = useState<PetProgression | null>(null);
  const [missions, setMissions] = useState<DailyMissionBundle | null>(null);
  const [streaks, setStreaks] = useState<UserStreak[]>([]);
  const [streakCelebration, setStreakCelebration] = useState<{ id: number; type: string; streak: number } | null>(null);
  const [petAnimClass, setPetAnimClass] = useState("");
  const [showLevelUp, setShowLevelUp] = useState(false);
  const prevLevelRef = useRef<number>(0);
  const [missionBonus, setMissionBonus] = useState<{ multiplier: number; message: string } | null>(null);
  const prevMissionDoneRef = useRef<Set<string>>(new Set());
  const [notifToast, setNotifToast] = useState<{ title: string; body: string; icon: string } | null>(null);
  const [perkOffer, setPerkOffer] = useState<PerkOffer | null>(null);
  const [arenaPrefs, setArenaPrefs] = useState<ArenaPrefs | null>(null);
  const [arenaModesDraft, setArenaModesDraft] = useState<string[] | null>(null);
  const [arenaCoachDraft, setArenaCoachDraft] = useState<string>("");
  const [arenaPrefsBusy, setArenaPrefsBusy] = useState(false);
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [plazaKind, setPlazaKind] = useState<PlazaBoardKind>("all");
  const [plazaSort, setPlazaSort] = useState<"new" | "hot" | "top">("new");
  const [plazaQueryDraft, setPlazaQueryDraft] = useState<string>("");
  const [plazaQuery, setPlazaQuery] = useState<string>("");
  const [plazaPosts, setPlazaPosts] = useState<FeedPost[]>([]);
  const [plazaPage, setPlazaPage] = useState<number>(1);
  const [plazaPagination, setPlazaPagination] = useState<{ limit: number; total: number; pageCount: number }>({
    limit: 25,
    total: 0,
    pageCount: 1,
  });
  const [plazaLoading, setPlazaLoading] = useState(false);
  const [plazaLiveItems, setPlazaLiveItems] = useState<PlazaLiveItem[]>([]);
  const [plazaLiveLoading, setPlazaLiveLoading] = useState(false);
  const [plazaLivePaused, setPlazaLivePaused] = useState(false);
  const [plazaLiveCollapsed, setPlazaLiveCollapsed] = useState(() => loadString(LS_PLAZA_LIVE_COLLAPSED) !== "0");
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
			  const [coinBalance, setCoinBalance] = useState<number | null>(null);
      const [decisions, setDecisions] = useState<TimedDecision[]>([]);
      const [decisionsBusy, setDecisionsBusy] = useState(false);
      const [notifications, setNotifications] = useState<UserNotification[]>([]);
      const [notificationsUnread, setNotificationsUnread] = useState(0);
      const [notificationsOpen, setNotificationsOpen] = useState(false);
      const [notificationsBellShake, setNotificationsBellShake] = useState(false);
      const [absence, setAbsence] = useState<AbsenceSummary | null>(null);
      const [absenceOpen, setAbsenceOpen] = useState(false);
	
		  const [worldTicker, setWorldTicker] = useState<WorldTickerData | null>(null);
		  const [world, setWorld] = useState<any>(null);
      const [worldHealth, setWorldHealth] = useState<HealthWorldResponse | null>(null);
      const [worldHealthError, setWorldHealthError] = useState<string | null>(null);
      const [arenaToday, setArenaToday] = useState<any>(null);
      const [arenaLeaderboard, setArenaLeaderboard] = useState<any>(null);
      const [arenaHistory, setArenaHistory] = useState<any[]>([]);
		  const [elections, setElections] = useState<ActiveElection[]>([]);
		  const [electionsDay, setElectionsDay] = useState<string>("");
      const [participation, setParticipation] = useState<WorldParticipationBundle | null>(null);

  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");

  const [nudgeText, setNudgeText] = useState("");

  const [byokProvider, setByokProvider] = useState<string>("openai");
  const [byokModel, setByokModel] = useState<string>("");
  const [byokBaseUrl, setByokBaseUrl] = useState<string>("");
  const [byokApiKey, setByokApiKey] = useState<string>("");

  const [devSimSteps, setDevSimSteps] = useState(3);
  const [devSimDay, setDevSimDay] = useState<string>("");
  const [devSimExtras, setDevSimExtras] = useState<number>(0);
  const [devSimAdvanceDays, setDevSimAdvanceDays] = useState<boolean>(false);
  const [devSimEpisodesPerStep, setDevSimEpisodesPerStep] = useState<number>(1);
  const [devSimStepDays, setDevSimStepDays] = useState<number>(1);

  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const bornGachaTimersRef = useRef<number[]>([]);
  const plazaLoadSeqRef = useRef(0);
  const plazaLiveSeqRef = useRef(0);
  const streakSnapshotRef = useRef<Record<string, number>>({});
  const notificationsBootedRef = useRef(false);
  const notificationsPrevUnreadRef = useRef(0);
  const [clockTick, setClockTick] = useState(0);

  const [chatText, setChatText] = useState<string>("");
  const [bornReveal, setBornReveal] = useState<{ job: any; company: any } | null>(null);
  const [bornGachaPhase, setBornGachaPhase] = useState<0 | 1 | 2 | 3>(0);

  const signedIn = Boolean(userToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  const clearToastLater = () => {
    window.setTimeout(() => setToast(null), 3200);
  };

  function clearBornGachaTimers() {
    for (const id of bornGachaTimersRef.current) {
      window.clearTimeout(id);
    }
    bornGachaTimersRef.current = [];
  }

		  function setMode(next: UiMode) {
	    saveString(LS_UI_MODE, next);
	    setUiMode(next);
      if (next === "simple") setPersistedDirectorView(false);
	  }

	  function setPersistedDirectorView(next: boolean) {
	    saveString(LS_DIRECTOR_VIEW, next ? "1" : "0");
	    setDirectorView(next);
	  }

    function setPersistedPetAdvanced(next: boolean) {
      saveString(LS_PET_ADVANCED, next ? "1" : "0");
      setPetAdvanced(next);
    }

  function setActiveTab(next: Tab) {
    saveString(LS_TAB, next);
    setTab(next);
  }

  function setPersistedOnboardingStep(next: PersistedOnboardingStep | null) {
    saveString(LS_ONBOARDING_STEP, next);
    setOnboardingStepRaw(next);
  }

  function setPersistedNoPetChoice(next: NoPetChoice | null) {
    saveString(LS_NO_PET_CHOICE, next);
    setNoPetChoiceRaw(next);
  }

  function markOnboarded() {
    saveString(LS_ONBOARDED, "1");
    setOnboarded(true);
    setPersistedOnboardingStep(null);
  }

  async function refreshAll(token: string, { silent = false }: { silent?: boolean } = {}) {
    if (!silent) setRefreshing(true);
    try {
      try {
        await me(token);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // Local DB reset / expired token -> force re-login (beginner-friendly).
        if (/User not found|Unauthorized|HTTP 401|HTTP 403/i.test(msg)) {
          onSignOut();
          setToast({ kind: "warn", text: "세션이 만료되었어요. 다시 로그인해줘." });
          clearToastLater();
          return;
        }
        throw e;
      }
      const petRes = await myPet(token);
      setPet(petRes.pet);
      setStats((petRes as any).stats ?? null);
      setFacts(((petRes as any).facts ?? []) as any[]);
      setProgression(((petRes as any).progression ?? null) as any);
      setMissions(((petRes as any).missions ?? null) as any);
      setPerkOffer(((petRes as any).perk_offer ?? null) as any);
      const ap = ((petRes as any).arena_prefs ?? null) as ArenaPrefs | null;
      setArenaPrefs(ap);
      setArenaModesDraft(ap?.modes ?? null);
      setArenaCoachDraft(String(ap?.coach_note ?? ""));

      // Always load watch content.
      const [feed, wt, at, bp, eb, ds, sr, nr, tk] = await Promise.all([
        userFeed(token, { sort: "new", limit: 20, offset: 0, submolt: "general" }),
        worldToday(token),
        worldArenaToday(token),
        getMyBrainProfile(token),
        economyBalance(token),
        myDecisions(token).catch(() => ({ decisions: [] as TimedDecision[] })),
        myStreaks(token).catch(() => ({ streaks: [] as UserStreak[] })),
        fetchNotifications(token, { limit: 50 }).catch(() => ({ notifications: [] as UserNotification[], unread_count: 0 })),
        fetchWorldTicker(token).catch(() => null as WorldTickerData | null),
      ]);
      setFeedPosts(feed.posts);
      setWorld(wt);
      setArenaToday(at);
      setWorldTicker(tk);
      setBrainProfile(bp.profile);
      setCoinBalance(Number((eb as any)?.balance ?? 0) || 0);
      setDecisions((ds as any)?.decisions ?? []);
      setStreaks(((sr as any)?.streaks ?? []) as UserStreak[]);
      setNotifications(((nr as any)?.notifications ?? []) as UserNotification[]);
      setNotificationsUnread(Math.max(0, Math.trunc(Number((nr as any)?.unread_count ?? 0) || 0)));

      if (uiMode === "debug") {
        try {
          const hw = await healthWorld(token);
          setWorldHealth(hw);
          setWorldHealthError(null);
        } catch (e: any) {
          setWorldHealth(null);
          setWorldHealthError(String(e?.message ?? e));
        }
      } else {
        setWorldHealth(null);
        setWorldHealthError(null);
      }

      if (petRes.pet) {
        const [t, lt, bs, rel, ah] = await Promise.all([
          timeline(token, 60),
          limboToday(token),
          brainStatus(token),
          myPetRelationships(token, 30),
          petArenaHistory(token, 8),
        ]);
        setEvents(t.events);
        setLimbo(lt);
        setBrain(bs.status);
        setRelationships(rel.relationships || []);
        setArenaHistory(((ah as any)?.history ?? []) as any[]);
      } else {
        setEvents([]);
        setRelationships([]);
        setLimbo(null);
        setBrain(null);
        setArenaHistory([]);
        setProgression(null);
        setMissions(null);
        setPerkOffer(null);
      }
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  async function refreshDecisions(token: string, { silent = false }: { silent?: boolean } = {}) {
    if (!token) return;
    if (!silent) setDecisionsBusy(true);
    try {
      const r = await myDecisions(token);
      setDecisions(r.decisions || []);
    } catch {
      // ignore
    } finally {
      if (!silent) setDecisionsBusy(false);
    }
  }

  async function refreshNotifications(token: string, { silent = false }: { silent?: boolean } = {}) {
    if (!token) return;
    try {
      const r = await fetchNotifications(token, { limit: 50 });
      setNotifications((r.notifications || []) as UserNotification[]);
      setNotificationsUnread(Math.max(0, Math.trunc(Number((r as any)?.unread_count ?? 0) || 0)));
    } catch (e: any) {
      if (!silent) {
        setToast({ kind: "bad", text: e?.message ?? String(e) });
        clearToastLater();
      }
    }
  }

  async function onMarkNotificationRead(id: number) {
    if (!userToken) return;
    try {
      await markNotificationRead(userToken, id);
      await refreshNotifications(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    }
  }

  async function onMarkAllNotificationsRead() {
    if (!userToken) return;
    try {
      await markAllNotificationsRead(userToken);
      await refreshNotifications(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    }
  }

  useEffect(() => {
    if (!userToken) {
      setDecisions([]);
      setStreaks([]);
      setStreakCelebration(null);
      streakSnapshotRef.current = {};
      setNotifications([]);
      setNotificationsUnread(0);
      setNotificationsOpen(false);
      setNotificationsBellShake(false);
      notificationsBootedRef.current = false;
      notificationsPrevUnreadRef.current = 0;
      setAbsence(null);
      setAbsenceOpen(false);
      return;
    }
    let cancelled = false;
    void refreshDecisions(userToken, { silent: true });
    void refreshNotifications(userToken, { silent: true });
    void (async () => {
      try {
        const s = await absenceSummary(userToken);
        if (cancelled) return;
        const daysAway = Math.max(0, Math.trunc(Number((s as any)?.days_away ?? 0) || 0));
        if (daysAway > 0) {
          setAbsence(s);
          setAbsenceOpen(true);
        }
      } catch {
        // ignore
      }
    })();
    const id = window.setInterval(() => {
      if (cancelled) return;
      void refreshDecisions(userToken, { silent: true });
      void refreshNotifications(userToken, { silent: true });
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userToken]);

  async function resolveDecisionChoice(decisionId: string, choiceId: string) {
    if (!userToken) return;
    setDecisionsBusy(true);
    try {
      await resolveMyDecision(userToken, decisionId, choiceId);
      await refreshDecisions(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setDecisionsBusy(false);
    }
  }

  async function loadPlaza({ page }: { page: number }) {
    if (!userToken) return;

    const limit = 25;
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const seq = plazaLoadSeqRef.current + 1;
    plazaLoadSeqRef.current = seq;

    setPlazaLoading(true);
    try {
      const res = await plazaBoard(userToken, {
        sort: plazaSort,
        kind: plazaKind,
        q: plazaQuery,
        limit,
        page: safePage,
        withTotal: true,
      });
      if (plazaLoadSeqRef.current !== seq) return;

      setPlazaPosts(res.posts || []);

      const nextLimit = Number(res.pagination?.limit ?? limit) || limit;
      const nextTotal = Number(res.pagination?.total ?? 0) || 0;
      const nextPageCountRaw = Number(res.pagination?.pageCount ?? 1) || 1;
      const nextPageCount = nextPageCountRaw > 0 ? nextPageCountRaw : 1;

      setPlazaPagination({
        limit: nextLimit,
        total: nextTotal,
        pageCount: nextPageCount,
      });
    } catch (e: any) {
      if (plazaLoadSeqRef.current !== seq) return;
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      if (plazaLoadSeqRef.current === seq) setPlazaLoading(false);
    }
  }

  async function loadPlazaLive({ silent = false }: { silent?: boolean } = {}) {
    if (!userToken) return;

    const seq = plazaLiveSeqRef.current + 1;
    plazaLiveSeqRef.current = seq;

    if (!silent) setPlazaLiveLoading(true);
    try {
      const res = await plazaLive(userToken, { limit: 30 });
      if (plazaLiveSeqRef.current !== seq) return;
      setPlazaLiveItems(res.items || []);
    } catch (e: any) {
      if (plazaLiveSeqRef.current !== seq) return;
      if (!silent) {
        setToast({ kind: "bad", text: e?.message ?? String(e) });
        clearToastLater();
      }
    } finally {
      if (!silent && plazaLiveSeqRef.current === seq) setPlazaLiveLoading(false);
    }
  }

  async function refreshElections(token: string, { silent = false }: { silent?: boolean } = {}) {
    try {
      const res = await worldActiveElections(token);
      setElections(res.elections || []);
      setElectionsDay(String(res.day || ""));
    } catch (e: any) {
      if (!silent) {
        setToast({ kind: "bad", text: e?.message ?? String(e) });
        clearToastLater();
      }
    }
  }

  async function refreshParticipation(token: string, { silent = false }: { silent?: boolean } = {}) {
    try {
      const res = await worldParticipation(token);
      setParticipation(res);
    } catch (e: any) {
      if (!silent) {
        setToast({ kind: "bad", text: e?.message ?? String(e) });
        clearToastLater();
      }
    }
  }

  // Initial load
  useEffect(() => {
    if (!userToken) return;
	    // one-time callback notices (e.g. OAuth connect redirect)
	    try {
	      const qs = new URLSearchParams(window.location.search);
	      const brain = String(qs.get("brain") || qs.get("byok") || "").trim();
	      if (brain === "gemini_connected") {
	        setToast({ kind: "good", text: "Gemini 두뇌 연결 완료" });
	        clearToastLater();
	        qs.delete("brain");
	        qs.delete("byok"); // back-compat
	        const next = qs.toString();
	        const url = next ? `${window.location.pathname}?${next}` : window.location.pathname;
	        window.history.replaceState({}, "", url);

        // If we were in onboarding brain step, advance to the final step.
        const onboardedNow = loadString(LS_ONBOARDED) === "1";
        const stepNow = loadString(LS_ONBOARDING_STEP);
        if (!onboardedNow && stepNow === "brain") {
          setPersistedOnboardingStep("done");
        }
      }
    } catch {
      // ignore
    }
    refreshAll(userToken)
      .then(() => {})
      .catch((e) => {
        setToast({ kind: "bad", text: String(e?.message ?? e) });
        clearToastLater();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userToken]);

  // Auto refresh (polling)
  useEffect(() => {
    if (!userToken) return;
    const id = window.setInterval(() => {
      if (busy) return;
      void refreshAll(userToken, { silent: true });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [userToken, busy]);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Load plaza board when entering Plaza tab / updating filters.
  useEffect(() => {
    if (!userToken) return;
    if (tab !== "plaza") return;
    void loadPlaza({ page: plazaPage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userToken, tab, plazaKind, plazaSort, plazaQuery, plazaPage]);

  // Plaza live "liveness" stream (polling, plaza tab only).
  useEffect(() => {
    if (!userToken) return;
    if (tab !== "plaza") return;
    void loadPlazaLive({ silent: true });
    const id = window.setInterval(() => {
      if (plazaLivePaused) return;
      if (busy) return;
      void loadPlazaLive({ silent: true });
    }, 4000);
    return () => window.clearInterval(id);
  }, [userToken, tab, plazaLivePaused, busy]);

	  // Hydrate brain-key form from saved profile (once).
	  useEffect(() => {
	    if (!brainProfile) return;
    if (byokApiKey.trim()) return;
    if (byokModel.trim() || byokBaseUrl.trim()) return;
    setByokProvider(brainProfile.provider || "openai");
    setByokModel(String(brainProfile.model ?? ""));
    setByokBaseUrl(String(brainProfile.base_url ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainProfile]);

  // Back-compat: existing users with a pet should skip onboarding.
  useEffect(() => {
    if (!signedIn) return;
    if (!pet) return;
    if (onboarded) return;
    if (onboardingStep) return;
    markOnboarded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, pet?.id, onboarded, onboardingStep]);

  // Onboarding: once a brain is connected, advance to the final step.
  useEffect(() => {
    if (!signedIn) return;
    if (!pet) return;
    if (onboarded) return;
    if (onboardingStep !== "brain") return;
    if (!brainProfile) return;
    setPersistedOnboardingStep("done");
    setShowBrainKeyForm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, pet?.id, onboarded, onboardingStep, brainProfile]);

  // Onboarding: job gacha reveal timing (born step only).
  useEffect(() => {
    clearBornGachaTimers();
    if (!signedIn) {
      setBornGachaPhase(0);
      return;
    }
    if (!pet) {
      setBornGachaPhase(0);
      return;
    }
    if (onboarded) {
      setBornGachaPhase(0);
      return;
    }
    if (onboardingStep !== "born") {
      setBornGachaPhase(0);
      return;
    }

    setBornGachaPhase(1);
    bornGachaTimersRef.current = [
      window.setTimeout(() => setBornGachaPhase(2), 1500),
      window.setTimeout(() => setBornGachaPhase(3), 2600),
    ];
    return () => clearBornGachaTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, pet?.id, onboarded, onboardingStep]);

  const streakByType = useMemo(() => {
    const map = new Map<string, UserStreak>();
    for (const row of streaks || []) {
      const type = String((row as any)?.streak_type ?? "").trim().toLowerCase();
      if (!type) continue;
      map.set(type, row);
    }
    return map;
  }, [streaks]);

  const loginStreakRow = streakByType.get("daily_login") ?? null;
  const missionStreakRow = streakByType.get("daily_mission") ?? null;

  const topBarStreak = useMemo(() => {
    const login = Math.max(0, Math.trunc(Number(loginStreakRow?.current_streak ?? 0) || 0));
    if (login > 0) return login;
    const mission = Math.max(0, Math.trunc(Number(missionStreakRow?.current_streak ?? 0) || 0));
    return mission > 0 ? mission : null;
  }, [loginStreakRow, missionStreakRow]);

  const streak = useMemo(() => {
    const mission = Math.max(0, Math.trunc(Number(missionStreakRow?.current_streak ?? 0) || 0));
    if (mission > 0) return mission;
    const login = Math.max(0, Math.trunc(Number(loginStreakRow?.current_streak ?? 0) || 0));
    return login > 0 ? login : null;
  }, [missionStreakRow, loginStreakRow]);

  const streakToday = useMemo(() => {
    const fromMission = safeIsoDate((missions as any)?.day);
    if (fromMission) return fromMission;
    const fromWorld = safeIsoDate((world as any)?.day);
    if (fromWorld) return fromWorld;
    return safeIsoDate(new Date().toISOString().slice(0, 10));
  }, [missions, world]);

  const streakWarningTarget = missionStreakRow || loginStreakRow;
  const midnightRemainingMs = useMemo(() => {
    void clockTick;
    return millisUntilLocalMidnight(Date.now());
  }, [clockTick]);

  const streakWarning = useMemo(() => {
    if (!streakWarningTarget) return null;
    if (!streakToday) return null;
    if (midnightRemainingMs <= 0 || midnightRemainingMs > 60 * 60 * 1000) return null;

    const last = safeIsoDate((streakWarningTarget as any)?.last_completed_at);
    if (last && last === streakToday) return null;

    const type = String((streakWarningTarget as any)?.streak_type ?? "").trim().toLowerCase() || "daily_login";
    return {
      type,
      remainingText: formatRemaining(midnightRemainingMs),
    };
  }, [streakWarningTarget, streakToday, midnightRemainingMs]);

  useEffect(() => {
    const prev = streakSnapshotRef.current || {};
    const next: Record<string, number> = {};
    let milestoneHit: { id: number; type: string; streak: number } | null = null;

    for (const row of streaks || []) {
      const type = String((row as any)?.streak_type ?? "").trim().toLowerCase();
      if (!type) continue;
      const cur = Math.max(0, Math.trunc(Number((row as any)?.current_streak ?? 0) || 0));
      const hasBefore = Object.prototype.hasOwnProperty.call(prev, type);
      const before = Math.max(0, Math.trunc(Number(prev[type] ?? 0) || 0));
      next[type] = cur;
      if (!milestoneHit && hasBefore && STREAK_MILESTONES.has(cur) && cur > before) {
        milestoneHit = { id: Date.now() + Math.floor(Math.random() * 1000), type, streak: cur };
      }
    }

    streakSnapshotRef.current = next;
    if (milestoneHit) setStreakCelebration(milestoneHit);
  }, [streaks]);

  useEffect(() => {
    if (!streakCelebration) return;
    const id = window.setTimeout(() => {
      setStreakCelebration((cur) => (cur && cur.id === streakCelebration.id ? null : cur));
    }, 3200);
    return () => window.clearTimeout(id);
  }, [streakCelebration]);

  // Mission bonus detection
  useEffect(() => {
    if (!missions?.items?.length) return;
    const prev = prevMissionDoneRef.current;
    const cur = new Set(missions.items.filter((m) => m.done).map((m) => m.code));
    const newlyDone = missions.items.filter((m) => m.done && !prev.has(m.code));
    prevMissionDoneRef.current = cur;
    if (prev.size === 0) return; // first load, skip
    for (const m of newlyDone) {
      if (m.reward?.bonus) {
        setMissionBonus({ multiplier: m.reward.bonusMultiplier ?? 2, message: m.reward.bonusMessage ?? "보너스!" });
        const id = window.setTimeout(() => setMissionBonus(null), 3000);
        return () => window.clearTimeout(id);
      }
    }
  }, [missions]);

  // Level-up detection
  useEffect(() => {
    const lv = Number((progression as any)?.level ?? 0) || 0;
    if (lv > 0 && prevLevelRef.current > 0 && lv > prevLevelRef.current) {
      setShowLevelUp(true);
      const id = window.setTimeout(() => setShowLevelUp(false), 1200);
      return () => window.clearTimeout(id);
    }
    if (lv > 0) prevLevelRef.current = lv;
  }, [progression]);

  useEffect(() => {
    if (!signedIn) {
      notificationsBootedRef.current = false;
      notificationsPrevUnreadRef.current = 0;
      setNotificationsBellShake(false);
      return;
    }

    const prev = Math.max(0, Math.trunc(Number(notificationsPrevUnreadRef.current) || 0));
    const cur = Math.max(0, Math.trunc(Number(notificationsUnread) || 0));
    const booted = notificationsBootedRef.current;

    notificationsPrevUnreadRef.current = cur;
    if (!booted) {
      notificationsBootedRef.current = true;
      return;
    }

    if (cur > prev) {
      setNotificationsBellShake(true);
      const id = window.setTimeout(() => setNotificationsBellShake(false), 720);
      // Show toast for newest notification
      const newest = (notifications ?? [])[0] as any;
      if (newest) {
        const nType = String(newest?.type ?? "").trim().toUpperCase();
        setNotifToast({
          title: String(newest?.title ?? "").trim() || "알림",
          body: String(newest?.body ?? "").trim(),
          icon: NOTIF_ICON[nType] || "🔔",
        });
        const id2 = window.setTimeout(() => setNotifToast(null), 3000);
        return () => { window.clearTimeout(id); window.clearTimeout(id2); };
      }
      return () => window.clearTimeout(id);
    }
  }, [signedIn, notificationsUnread, notifications]);

  const nudges = useMemo(() => {
    return (facts || []).filter((f) => ["preference", "forbidden", "suggestion"].includes(String(f?.kind ?? "")));
  }, [facts]);

  const profileBadges = useMemo(() => {
    const get = (key: string) => facts.find((f) => f?.kind === "profile" && f?.key === key)?.value ?? null;
    const mbti = String(get("mbti")?.mbti ?? "").trim() || undefined;
    const company = String(get("company")?.company ?? "").trim() || undefined;
    const jobName = String(get("job")?.name ?? "").trim() || undefined;
    const jobRole = String(get("job_role")?.job_role ?? "").trim() || undefined;
    const role = String(get("role")?.role ?? "").trim() || undefined;
    const vibe = String(get("vibe")?.vibe ?? "").trim() || undefined;

    return {
      mbti,
      company,
      job: jobName || undefined,
      role: role || jobRole || undefined,
      vibe,
    };
  }, [facts]);

  const profileJob = useMemo(() => {
    const v = facts.find((f) => f?.kind === "profile" && f?.key === "job")?.value ?? null;
    if (!v || typeof v !== "object") return null;
    const code = String((v as any)?.code ?? "").trim();
    if (!code) return null;
    const displayName = String((v as any)?.name ?? (v as any)?.displayName ?? code).trim() || code;
    const rarity = String((v as any)?.rarity ?? "common").trim() || "common";
    const zone = String((v as any)?.zone ?? (v as any)?.zone_code ?? "").trim();
    return { code, displayName, rarity, zone };
  }, [facts]);

  const relFriendly = useMemo(() => {
    const list = Array.isArray(relationships) ? relationships : [];
    return list
      .filter((r) => Number((r as any)?.out?.affinity ?? 0) > 0)
      .sort((a, b) => Number((b as any)?.out?.affinity ?? 0) - Number((a as any)?.out?.affinity ?? 0))
      .slice(0, 5);
  }, [relationships]);

  const relHostile = useMemo(() => {
    const list = Array.isArray(relationships) ? relationships : [];
    return list
      .filter((r) => {
        const out = (r as any)?.out ?? {};
        const affinity = Number(out?.affinity ?? 0) || 0;
        const jealousy = Number(out?.jealousy ?? 0) || 0;
        const rivalry = Number(out?.rivalry ?? 0) || 0;
        return affinity < 0 || jealousy >= 25 || rivalry >= 25;
      })
      .sort((a, b) => {
        const outA = (a as any)?.out ?? {};
        const outB = (b as any)?.out ?? {};
        const aAff = Number(outA?.affinity ?? 0) || 0;
        const bAff = Number(outB?.affinity ?? 0) || 0;
        const aJeal = Number(outA?.jealousy ?? 0) || 0;
        const bJeal = Number(outB?.jealousy ?? 0) || 0;
        const aRiv = Number(outA?.rivalry ?? 0) || 0;
        const bRiv = Number(outB?.rivalry ?? 0) || 0;
        const aScore = Math.max(aRiv, aJeal, Math.abs(Math.min(0, aAff)));
        const bScore = Math.max(bRiv, bJeal, Math.abs(Math.min(0, bAff)));
        if (bScore !== aScore) return bScore - aScore;
        return aAff - bAff;
      })
      .slice(0, 5);
  }, [relationships]);

  const relMilestones = useMemo(() => {
    const list = Array.isArray(events) ? events : [];
    const picked = list.filter((e) => String(e?.event_type ?? "") === "RELATIONSHIP_MILESTONE").slice(0, 4);
    return picked.map((ev) => {
      const p = (ev as any)?.payload ?? {};
      const code = String(p?.code ?? "").trim();
      const badge =
        code.startsWith("friend")
          ? "친해짐"
          : code.startsWith("enemy")
            ? "원수"
            : code.startsWith("rivalry")
              ? "경쟁"
              : code.startsWith("jealousy")
                ? "질투"
                : "관계";
      const summary = String(p?.summary ?? "").trim() || "관계 변화";
      const day = String(p?.day ?? "").trim();
      return { id: String((ev as any)?.id ?? `${code}:${day}:${Math.random()}`), day, badge, summary, created_at: (ev as any)?.created_at ?? null };
    });
  }, [events]);

  const lastDialogue = useMemo(() => {
    const ev = (events || []).find((e) => e?.event_type === "DIALOGUE");
    const dialogue = (ev as any)?.payload?.dialogue ?? null;
    const userMessage = String((ev as any)?.payload?.user_message ?? "").trim() || null;
    return {
      user_message: userMessage,
      mood: typeof dialogue?.mood === "string" ? dialogue.mood : "",
      lines: asList(dialogue?.lines),
      created_at: (ev as any)?.created_at ?? null,
    };
  }, [events]);

  const chatHistory = useMemo(() => {
    const rows = (events || []).filter((e) => e?.event_type === "DIALOGUE").slice(0, 6);
    return rows.map((ev: any) => {
      const d = ev?.payload?.dialogue ?? null;
      return {
        created_at: ev?.created_at ?? null,
        user_message: String(ev?.payload?.user_message ?? "").trim() || null,
        mood: typeof d?.mood === "string" ? d.mood : "",
        lines: asList(d?.lines),
      };
    });
  }, [events]);

  const now = useNow(signedIn && Boolean(pet));

  const lastActionAt = useMemo(() => {
    const map = new Map<string, Date>();
    for (const ev of events) {
      const t = String(ev?.event_type ?? "");
      if (!t) continue;
      const action = t.toLowerCase();
      if (!["feed", "play", "sleep", "talk"].includes(action)) continue;
      if (map.has(action)) continue;
      map.set(action, new Date(ev.created_at));
    }
    return map;
  }, [events]);

  const cooldownRemainingMs = useMemo(() => {
    const out: Record<string, number> = {};
    for (const action of ["feed", "play", "sleep", "talk"]) {
      const lastAt = lastActionAt.get(action) || null;
      const cd = COOLDOWNS_MS[action] || 0;
      if (!lastAt) {
        out[action] = 0;
        continue;
      }
      const elapsed = now.getTime() - lastAt.getTime();
      out[action] = Math.max(0, cd - elapsed);
    }
    return out;
  }, [lastActionAt, now]);

	  const worldSummary = (world as any)?.worldDaily?.summary ?? null;
	  const worldConcept = (world as any)?.worldConcept ?? null;
	  const myDirection = (world as any)?.myDirection ?? null;
	  const policySnapshot = (world as any)?.policySnapshot ?? null;
	  const weeklyArc = (world as any)?.weeklyArc ?? null;
	  const newsSignals = useMemo(() => {
	    const fromApi = (world as any)?.newsSignals ?? null;
	    if (Array.isArray(fromApi)) {
	      const cleaned = fromApi
	        .map((it: any, i: number) => {
	          const kind = String(it?.kind ?? i).trim();
	          const text = String(it?.text ?? "").trim();
	          if (!text) return null;
	          return { kind, text };
	        })
	        .filter(Boolean)
	        .slice(0, 3) as { kind: string; text: string }[];
	      if (cleaned.length === 3) return cleaned;
	    }

	    const summary = (world as any)?.worldDaily?.summary ?? null;
	    const politics = String((world as any)?.civicLine ?? summary?.civicLine ?? "").trim() || "🗳️ 정치: 오늘은 조용해요";
	    const econObj = (world as any)?.economy ?? null;
	    const econFromSummary = String(summary?.economyLine ?? "").trim();
	    const economy =
	      econFromSummary ||
	      (econObj
	        ? `💰 경제: 소비 ${Number((econObj as any)?.todaySpending ?? 0) || 0} LBC · 매출 ${Number((econObj as any)?.todayRevenue ?? 0) || 0} LBC · 회사 ${
	            Number((econObj as any)?.companyCount ?? 0) || 0
	          }개`
	        : "💰 경제: 집계 중… 곧 나올 거야");

	    let highlight =
	      String(summary?.researchLine ?? "").trim() ||
	      String(summary?.societyRumor ?? "").trim() ||
	      String((weeklyArc as any)?.nextHook ?? "").trim() ||
	      "";
	    if (!highlight) {
	      const matches = ((arenaToday as any)?.matches ?? (world as any)?.arena?.matches ?? []) as any[];
	      const first = Array.isArray(matches) ? matches[0] : null;
	      const h = String(first?.headline ?? first?.meta?.headline ?? "").trim();
	      if (h) highlight = `🏟️ 아레나: ${h}`;
	      else if (Array.isArray(matches) && matches.length) highlight = `🏟️ 아레나: 오늘 경기 ${matches.length}개`;
	    }
	    if (!highlight) {
	      const items = (world as any)?.liveTicker ?? [];
	      const top = Array.isArray(items) ? items[0] : null;
	      const text = String(top?.text ?? "").trim();
	      if (text) highlight = `🟢 활동: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`;
	    }
	    if (!highlight) highlight = "📰 오늘은 조용해요";

	    return [
	      { kind: "politics", text: politics },
	      { kind: "economy", text: economy },
	      { kind: "highlight", text: highlight },
	    ];
	  }, [world, arenaToday, weeklyArc]);
	  const broadcastWhyLines = useMemo(() => {
	    if (!directorView) return [];
	    const out: string[] = [];

	    const themeName = String((worldSummary as any)?.theme?.name ?? (worldConcept as any)?.theme?.name ?? "").trim();
	    if (themeName) out.push(`🌍 오늘 테마: ${themeName}`);

	    const rawScenario = String((worldSummary as any)?.scenario ?? "").trim().toUpperCase();
	    const scenarioLabel =
	      rawScenario === "ROMANCE"
	        ? "로맨스"
	        : rawScenario === "DEAL"
	          ? "거래"
	          : rawScenario === "TRIANGLE"
	            ? "질투"
	            : rawScenario === "BEEF"
	              ? "신경전"
	              : rawScenario === "OFFICE" || rawScenario === "CREDIT"
	                ? "회사"
	                : rawScenario
	                  ? rawScenario
	                  : "";
	    const aName = String((worldSummary as any)?.cast?.aName ?? "").trim();
	    const bName = String((worldSummary as any)?.cast?.bName ?? "").trim();
	    const cast = aName && bName ? `${aName} ↔ ${bName}` : "";

	    if ((myDirection as any)?.latest?.text) {
	      const status = String((myDirection as any)?.status ?? "");
	      const statusLabel = status === "applied" ? "반영됨" : status === "expired" ? "만료" : "대기중";
	      const text = String((myDirection as any)?.latest?.text ?? "").trim();
	      const appliedDay = String((myDirection as any)?.lastApplied?.day ?? "").trim();
	      const ep = Number((myDirection as any)?.lastApplied?.episode_index ?? 0) || 0;
	      const suffix = status === "applied" && appliedDay ? ` (${appliedDay}${ep ? ` #${ep}` : ""})` : "";
	      out.push(`🎬 내 연출(${statusLabel}): “${text}”${suffix}`);
	    } else if (cast || scenarioLabel) {
	      out.push(`🎞️ 캐스팅: ${[cast, scenarioLabel].filter(Boolean).join(" · ")}`.trim());
	    }

	    const highlight = newsSignals.find((s) => s.kind === "highlight")?.text ?? "";
	    const politics = newsSignals.find((s) => s.kind === "politics")?.text ?? "";
	    const third = String(highlight || politics).trim();
	    if (third) out.push(third);

	    return out.filter(Boolean).slice(0, 3);
	  }, [directorView, worldSummary, worldConcept, myDirection, newsSignals]);
	  const liveTicker = useMemo(() => {
	    const list = (world as any)?.liveTicker ?? [];
	    return Array.isArray(list) ? list : [];
	  }, [world]);
  const economyRecentTransactions = useMemo(() => {
    const list = (world as any)?.economy?.recentTransactions ?? [];
    return Array.isArray(list) ? list : [];
  }, [world]);
  const arenaMatches = useMemo(() => {
    const list = ((arenaToday as any)?.matches ?? (world as any)?.arena?.matches ?? []) as any[];
    return Array.isArray(list) ? list : [];
  }, [arenaToday, world]);
  const arenaSeasonCode = String((arenaToday as any)?.season?.code ?? "").trim();
  const arenaMy = (arenaToday as any)?.my ?? null;
	  const myArenaMatchToday = useMemo(() => {
	    if (!pet?.id) return null;
	    const id = String(pet.id);
	    return arenaMatches.find((m: any) => {
        const parts = Array.isArray(m?.participants) ? m.participants : [];
        if (parts.some((p: any) => String(p?.agent?.id ?? "") === id)) return true;
        const meta = m?.meta && typeof m.meta === "object" ? (m.meta as any) : {};
        const cast = meta?.cast && typeof meta.cast === "object" ? (meta.cast as any) : {};
        const aId = String(cast?.aId ?? cast?.a_id ?? "").trim();
        const bId = String(cast?.bId ?? cast?.b_id ?? "").trim();
        return Boolean(aId && bId && (aId === id || bId === id));
      }) ?? null;
	  }, [arenaMatches, pet?.id]);
    const arenaBest = useMemo(() => {
      const list = (Array.isArray(arenaMatches) ? arenaMatches : []).filter((m: any) => {
        const status = String(m?.status ?? "").trim().toLowerCase();
        const parts = Array.isArray(m?.participants) ? m.participants : [];
        return status === "resolved" && parts.length >= 2;
      });
      if (list.length === 0) return null;

      const scoreFor = (m: any) => {
        const parts = Array.isArray(m?.participants) ? m.participants : [];
        if (parts.length < 2) return { score: 0, tags: [] as string[] };
        const a = parts[0];
        const b = parts[1];
        const win = String(a?.outcome ?? "").toLowerCase() === "win" ? a : String(b?.outcome ?? "").toLowerCase() === "win" ? b : null;
        const lose = win === a ? b : win === b ? a : null;

        const meta = m?.meta && typeof m.meta === "object" ? (m.meta as any) : {};
        const forfeit = Boolean(meta?.result?.forfeit ?? meta?.result?.forfeit === true);

        const wager = Math.max(0, Number(a?.wager ?? 0) || 0, Number(b?.wager ?? 0) || 0);
        const scoreGap = Math.abs((Number(a?.score ?? 0) || 0) - (Number(b?.score ?? 0) || 0));

        const tags: string[] = [];
        const metaTags = Array.isArray(meta?.tags) ? (meta.tags as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
        for (const t of metaTags.slice(0, 6)) tags.push(t);
        let score = 0;

        if (forfeit) {
          tags.push("몰수");
          score -= 2;
        }

        if (wager >= 4) {
          tags.push("빅스테이크");
          score += 2;
        } else if (wager >= 2) {
          tags.push("스테이크");
          score += 1;
        }

        if (scoreGap <= 1) {
          tags.push("박빙");
          score += 1;
        }

        if (win && lose) {
          const wr = Number(win?.ratingBefore ?? 1000) || 1000;
          const lr = Number(lose?.ratingBefore ?? 1000) || 1000;
          if (wr + 60 < lr) {
            tags.push("업셋");
            score += 3;
          } else if (Math.abs(wr - lr) <= 40) {
            tags.push("접전");
            score += 1;
          }

          const rd = Number(win?.ratingDelta ?? 0) || 0;
          if (Math.abs(rd) >= 20) {
            tags.push(`레이팅 ${rd > 0 ? `+${rd}` : rd}`);
            score += 1;
          }

          const cn = Number(win?.coinsNet ?? 0) || 0;
          if (Math.abs(cn) >= 3) {
            tags.push(`코인 ${cn > 0 ? `+${cn}` : cn}`);
            score += 1;
          }
        }

        const mode = String(m?.mode ?? "").trim().toUpperCase();
        if (mode === "PROMPT_BATTLE") {
          tags.push("프롬프트");
          score += 1;
        } else if (mode === "COURT_TRIAL") {
          tags.push("재판");
          score += 1;
        } else if (mode === "MATH_RACE") {
          tags.push("수학");
          score += 1;
        } else if (mode === "PUZZLE_SPRINT") {
          tags.push("퍼즐");
          score += 1;
        }

        const uniq = [...new Set(tags)].filter(Boolean);
        return { score, tags: uniq.slice(0, 4) };
      };

      let best: any = null;
      let bestScore = -1e9;
      let bestTags: string[] = [];
      for (const m of list) {
        const s = scoreFor(m);
        if (s.score > bestScore) {
          best = m;
          bestScore = s.score;
          bestTags = s.tags;
        }
      }
      if (!best) return null;
      const meta = best?.meta && typeof best.meta === "object" ? (best.meta as any) : {};
      const recapPostId = String(meta?.recap_post_id ?? "").trim() || null;
      const headline = String(best?.headline ?? meta?.headline ?? "").trim() || "오늘의 경기";
      const modeLabel = String(meta?.mode_label ?? best?.mode ?? "").trim();
      const parts = Array.isArray(best?.participants) ? best.participants : [];
      const cast = parts
        .map((p: any) => {
          const name = String(p?.agent?.displayName ?? p?.agent?.name ?? "").trim() || "unknown";
          const out = String(p?.outcome ?? "").trim().toLowerCase();
          const badge = out === "win" ? "🏆" : out === "forfeit" ? "⚠" : "";
          return `${badge}${name}`;
        })
        .filter(Boolean)
        .slice(0, 2)
        .join(" vs ");

      return {
        id: String(best?.id ?? "").trim() || null,
        headline,
        modeLabel,
        cast,
        tags: bestTags,
        recapPostId,
      };
    }, [arenaMatches]);
	  const avatarHue = useMemo(() => hashHue(pet?.id || pet?.name || "limbo"), [pet?.id, pet?.name]);
	  const petActivity = useMemo(() => {
	    if (!pet?.id) return null;

	    const day = safeIsoDate(String((world as any)?.day ?? "")) || null;

	    const labelFor = (t: string) => {
	      const k = String(t || "").trim().toUpperCase();
	      if (k === "SOCIAL") return "사회(상호작용)";
	      if (k === "ARENA_MATCH") return "아레나";
	      if (k === "PLAZA_POST") return "광장 글";
	      if (k === "DIARY_POST") return "일기";
	      if (k === "DIALOGUE") return "대화";
	      if (k === "FEED") return "먹이";
	      if (k === "PLAY") return "놀기";
	      if (k === "SLEEP") return "재우기";
	      return k || "activity";
	    };

	    const lastEv = Array.isArray(events) ? (events[0] ?? null) : null;
	    const lastType = String(lastEv?.event_type ?? "").trim();
	    const last = lastType && lastEv?.created_at ? { type: lastType, label: labelFor(lastType), at: String(lastEv.created_at) } : null;

	    const lastAtByType: Record<string, string> = {};
	    const todayCounts = { social: 0, arena: 0, plaza: 0, diary: 0, dialogue: 0 };

	    for (const ev of Array.isArray(events) ? events : []) {
	      const t = String((ev as any)?.event_type ?? "").trim().toUpperCase();
	      const at = String((ev as any)?.created_at ?? "").trim();
	      if (t && at && !lastAtByType[t]) lastAtByType[t] = at;

	      const payload = (ev as any)?.payload;
	      const payloadDay = payload && typeof payload === "object" && typeof (payload as any)?.day === "string" ? String((payload as any).day).trim() : null;
	      if (!day || !payloadDay || payloadDay !== day) continue;

	      if (t === "SOCIAL") todayCounts.social += 1;
	      else if (t === "ARENA_MATCH") todayCounts.arena += 1;
	      else if (t === "PLAZA_POST") todayCounts.plaza += 1;
	      else if (t === "DIARY_POST") todayCounts.diary += 1;
	      else if (t === "DIALOGUE") todayCounts.dialogue += 1;
	    }

	    const castAId = String((worldSummary as any)?.cast?.aId ?? "").trim();
	    const castBId = String((worldSummary as any)?.cast?.bId ?? "").trim();
	    const appearedInBroadcast = Boolean(pet?.id && (castAId === String(pet.id) || castBId === String(pet.id)));

	    return { day, last, lastAtByType, todayCounts, appearedInBroadcast };
	  }, [pet?.id, events, world, worldSummary]);
	
	  async function onDevLogin() {
	    setBusy(true);
	    try {
	      const res = await devLogin(userEmail);
      saveString(LS_USER_TOKEN, res.token);
      setUserToken(res.token);
      setToast({ kind: "good", text: "로그인 완료" });
      clearToastLater();
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleIdToken(idToken: string) {
    setBusy(true);
    try {
      const res = await googleLogin(idToken);
      saveString(LS_USER_TOKEN, res.token);
      setUserToken(res.token);
      setToast({ kind: "good", text: "로그인 완료" });
      clearToastLater();
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (signedIn) return;
    if (!googleClientId) return;
    if (!googleButtonRef.current) return;

    let cancelled = false;

    ensureGoogleScriptLoaded()
      .then(() => {
        if (cancelled) return;
        const g = (window as any).google?.accounts?.id;
        if (!g) return;

        g.initialize({
          client_id: googleClientId,
          callback: (resp: any) => {
            const idToken = String(resp?.credential ?? "").trim();
            if (!idToken) return;
            void onGoogleIdToken(idToken);
          },
        });

        googleButtonRef.current!.innerHTML = "";
        g.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          text: "signin_with",
          width: 260,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setToast({ kind: "bad", text: String(e?.message ?? e) });
        clearToastLater();
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, googleClientId]);

  function onSignOut() {
    saveString(LS_USER_TOKEN, null);
    setUserToken(null);
    setPet(null);
    setStats(null);
    setEvents([]);
    setLimbo(null);
    setBrain(null);
    setBrainProfile(null);
    setFacts([]);
    setProgression(null);
    setMissions(null);
    setStreaks([]);
    setStreakCelebration(null);
    streakSnapshotRef.current = {};
    setPerkOffer(null);
    setArenaPrefs(null);
    setArenaModesDraft(null);
    setArenaCoachDraft("");
    setArenaPrefsBusy(false);
    setNotifications([]);
    setNotificationsUnread(0);
    setNotificationsOpen(false);
    setNotificationsBellShake(false);
    notificationsBootedRef.current = false;
    notificationsPrevUnreadRef.current = 0;
	    setFeedPosts([]);
			    setCoinBalance(null);
			    setWorld(null);
        setWorldHealth(null);
        setWorldHealthError(null);
        setParticipation(null);
        setElections([]);
        setElectionsDay("");
		    setByokApiKey("");
	    setShowBrainKeyForm(false);
	    setBornReveal(null);
	    setBornGachaPhase(0);
    clearBornGachaTimers();
	  }

  async function onCreatePet() {
    if (!userToken) return;
    setBusy(true);
    try {
      const res = await createPet(userToken, createName, createDesc);
      setBornReveal({ job: (res as any)?.job ?? null, company: (res as any)?.company ?? null });
      setToast({ kind: "good", text: "펫 생성 완료" });
      clearToastLater();
      setPersistedOnboardingStep("born");
      setShowBrainKeyForm(false);
      await refreshAll(userToken);
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onAction(action: "feed" | "play" | "sleep" | "talk", payloadOverride: Record<string, unknown> | null = null) {
    if (!userToken) return;
    if (action === "talk" && !brainProfile) {
      setToast({ kind: "warn", text: "대화하려면 먼저 두뇌를 연결해야 해요. (설정 탭)" });
      clearToastLater();
      setActiveTab("settings");
      return;
    }
    if (action !== "talk" && cooldownRemainingMs[action] > 0) {
      setToast({ kind: "warn", text: `쿨다운: ${formatRemaining(cooldownRemainingMs[action])}` });
      clearToastLater();
      return;
    }

    setBusy(true);
    // Trigger pet animation on feed/play
    if (action === "feed" || action === "play") {
      setPetAnimClass("petEatAnim");
      window.setTimeout(() => setPetAnimClass(""), 700);
    }
    try {
      const payload = payloadOverride ?? (action === "feed" ? { food: "kibble" } : {});
      await petAction(userToken, action, payload);
      setToast({ kind: "good", text: "OK" });
      clearToastLater();
      await refreshAll(userToken);

      if (action === "talk") {
        // Poll a few times (proxy brain may take 5~30s).
        for (const waitMs of [1200, 2500, 4500, 7000]) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => window.setTimeout(r, waitMs));
          // eslint-disable-next-line no-await-in-loop
          await refreshAll(userToken, { silent: true });
        }
      }
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onSendChat() {
    if (!userToken) return;
    const msg = chatText.trim();
    if (!msg) return;
    if (msg.length > 400) {
      setToast({ kind: "bad", text: "너무 길어! 400자 이하로 줄여봐." });
      clearToastLater();
      return;
    }
    setChatText("");
    await onAction("talk", { message: msg });
  }

  async function onAddNudge() {
    if (!userToken) return;
    const text = nudgeText.trim();
    if (!text) return;
    if (text.length > 64) {
      setToast({ kind: "bad", text: "64자 이하로 적어줘." });
      clearToastLater();
      return;
    }

    setBusy(true);
    try {
      await submitNudges(userToken, [{ text }]);
      setNudgeText("");
      setToast({ kind: "good", text: "기억시켰어" });
      clearToastLater();
      await refreshAll(userToken);
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onQuickNudge(key: string) {
    if (!userToken) return;
    const k = String(key || "").trim();
    if (!k) return;
    if (k.length > 64) {
      setToast({ kind: "bad", text: "64자 이하로 적어줘." });
      clearToastLater();
      return;
    }
    setBusy(true);
    try {
      await submitNudges(userToken, [{ type: "suggestion", key: k, value: { preset: true } }]);
      setToast({ kind: "good", text: "연출을 남겼어" });
      clearToastLater();
      await refreshAll(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onChoosePerk(code: string) {
    if (!userToken) return;
    const c = String(code || "").trim();
    if (!c) return;
    setBusy(true);
    try {
      const res = await choosePerk(userToken, c);
      setToast({ kind: "good", text: `퍼크 획득: ${res.chosen.name}` });
      clearToastLater();
      await refreshAll(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  function effectiveArenaModes(): string[] {
    const selected = arenaModesDraft;
    if (!selected || selected.length === 0) return ARENA_MODE_CHOICES.map((c) => c.code);
    const allow = new Set(ARENA_MODE_CHOICES.map((c) => c.code));
    return selected.map((x) => String(x || "").trim().toUpperCase()).filter((m) => allow.has(m));
  }

  function toggleArenaMode(code: string) {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return;
    const all = ARENA_MODE_CHOICES.map((x) => x.code);
    const cur = effectiveArenaModes();
    const set = new Set(cur);
    if (set.has(c)) set.delete(c);
    else set.add(c);
    const next = all.filter((m) => set.has(m));
    if (next.length === 0) {
      setToast({ kind: "warn", text: "아레나 종목은 최소 1개는 선택해야 해요." });
      clearToastLater();
      return;
    }
    setArenaModesDraft(next.length === all.length ? null : next);
  }

  function gotoArenaWatch() {
    setActiveTab("arena");
  }

  async function onSaveArenaPrefs() {
    if (!userToken || !pet) return;
    if (arenaPrefsBusy) return;

    const all = ARENA_MODE_CHOICES.map((x) => x.code);
    const selected = effectiveArenaModes();
    const modesPayload = selected.length === all.length ? null : selected;
    const coach = arenaCoachDraft.trim();
    const coachPayload = coach ? coach : null;

    setArenaPrefsBusy(true);
    try {
      const res = await setMyArenaPrefs(userToken, { modes: modesPayload, coach_note: coachPayload });
      setArenaPrefs(res.prefs);
      setArenaModesDraft(res.prefs?.modes ?? null);
      setArenaCoachDraft(String(res.prefs?.coach_note ?? ""));
      setToast({ kind: "good", text: "아레나 설정 저장" });
      clearToastLater();
      await refreshAll(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setArenaPrefsBusy(false);
    }
  }

  async function onCreateDiaryPost() {
    if (!userToken) return;
    if (!brainProfile) {
      setToast({ kind: "warn", text: "일기를 쓰려면 먼저 두뇌를 연결해야 해요. (설정 탭)" });
      clearToastLater();
      setActiveTab("settings");
      return;
    }
    setBusy(true);
    try {
      const res = await createDiaryPostJob(userToken, "general");
      setToast({
        kind: res.reused ? "warn" : "good",
        text: res.reused ? "이미 대기 중인 일기가 있어." : "일기 생성 중… (브레인이 처리)",
      });
      clearToastLater();
      await refreshAll(userToken);
      setActiveTab("plaza");
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onCreatePlazaPost() {
    if (!userToken) return;
    if (!brainProfile) {
      setToast({ kind: "warn", text: "광장 글을 쓰려면 먼저 두뇌를 연결해야 해요. (설정 탭)" });
      clearToastLater();
      setActiveTab("settings");
      return;
    }
    setBusy(true);
    try {
      const res = await createPlazaPostJob(userToken, "general");
      setToast({
        kind: res.reused ? "warn" : "good",
        text: res.reused ? "이미 대기 중인 글이 있어." : "광장 글 생성 중… (브레인이 처리)",
      });
      clearToastLater();
      await refreshAll(userToken);
      setActiveTab("plaza");
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onUpvote(postId: string) {
    if (!userToken) return;
    setBusy(true);
    try {
      await upvotePost(userToken, postId);
      await refreshAll(userToken, { silent: true });
      if (tab === "plaza") {
        await Promise.all([loadPlaza({ page: plazaPage }), loadPlazaLive({ silent: true })]);
      }
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onDevSimulate() {
    if (!userToken) return;
    const steps = clampInt(devSimSteps, 1, 30);
    const day = safeIsoDate(devSimDay);
    const extras = clampInt(devSimExtras, 0, 200);
    const episodesPerStep = clampInt(devSimEpisodesPerStep, 1, 10);
    const advanceDays = Boolean(devSimAdvanceDays);
    const stepDays = clampInt(devSimStepDays, 1, 30);

    setBusy(true);
    try {
      const res = await worldDevSimulate(userToken, { steps, day: day ?? undefined, extras, advanceDays, stepDays, episodesPerStep });
      setToast({ kind: "good", text: `시뮬레이션: +${Number(res.generated ?? 0) || 0} 에피소드` });
      clearToastLater();
      await refreshAll(userToken);
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onDevResearch() {
    if (!userToken) return;
    setBusy(true);
    try {
      await worldDevResearch(userToken);
      setToast({ kind: "good", text: "연구 프로젝트 시작됨" });
      clearToastLater();
      await refreshAll(userToken);
      setActiveTab("plaza");
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onDevSecretSociety() {
    if (!userToken) return;
    setBusy(true);
    try {
      await worldDevSecretSociety(userToken);
      setToast({ kind: "good", text: "비밀결사 시드 완료" });
      clearToastLater();
      await refreshAll(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onRefreshElections() {
    if (!userToken) return;
    setBusy(true);
    try {
      await refreshElections(userToken, { silent: true });
      setToast({ kind: "good", text: "선거 새로고침" });
      clearToastLater();
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onRefreshArena() {
    if (!userToken) return;
    setBusy(true);
    try {
      const res = await worldArenaToday(userToken, { limit: 20 });
      setArenaToday(res);
      setToast({ kind: "good", text: "아레나 새로고침" });
      clearToastLater();
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onLoadArenaLeaderboard() {
    if (!userToken) return;
    setBusy(true);
    try {
      const res = await worldArenaLeaderboard(userToken, { limit: 25 });
      setArenaLeaderboard(res);
      setToast({ kind: "good", text: "리더보드 불러옴" });
      clearToastLater();
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onElectionRegister(electionId: string) {
    if (!userToken) return;
    if (!pet) {
      setToast({ kind: "warn", text: "펫이 있어야 출마할 수 있어." });
      clearToastLater();
      return;
    }
    setBusy(true);
    try {
      await worldRegisterCandidate(userToken, electionId);
      setToast({ kind: "good", text: "출마 완료" });
      clearToastLater();
      await Promise.all([refreshElections(userToken, { silent: true }), refreshAll(userToken, { silent: true })]);
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onElectionVote(electionId: string, candidateId: string) {
    if (!userToken) return;
    if (!pet) {
      setToast({ kind: "warn", text: "펫이 있어야 투표할 수 있어." });
      clearToastLater();
      return;
    }
    setBusy(true);
    try {
      await worldCastVote(userToken, electionId, candidateId);
      setToast({ kind: "good", text: "투표 완료" });
      clearToastLater();
      await refreshElections(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onSocietyRespond(societyId: string, response: "accept" | "decline") {
    if (!userToken) return;
    setBusy(true);
    try {
      await respondSocietyInvite(userToken, societyId, response);
      setToast({ kind: "good", text: response === "accept" ? "비밀결사에 가입했어" : "초대를 거절했어" });
      clearToastLater();
      await Promise.all([refreshParticipation(userToken, { silent: true }), refreshAll(userToken, { silent: true })]);
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onResearchJoin(projectId: string) {
    if (!userToken) return;
    setBusy(true);
    try {
      await joinResearchProject(userToken, projectId);
      setToast({ kind: "good", text: "연구에 참여했어" });
      clearToastLater();
      await Promise.all([refreshParticipation(userToken, { silent: true }), refreshAll(userToken, { silent: true })]);
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onSaveByok() {
    if (!userToken) return;
    if (!byokProvider.trim()) {
      setToast({ kind: "bad", text: "provider를 선택해줘." });
      clearToastLater();
      return;
    }
    if (!byokModel.trim()) {
      setToast({ kind: "bad", text: "model을 입력해줘." });
      clearToastLater();
      return;
    }
    if (!byokApiKey.trim()) {
      setToast({ kind: "bad", text: "api key를 입력해줘." });
      clearToastLater();
      return;
    }

    setBusy(true);
    try {
      const res = await setMyBrainProfile(userToken, {
        provider: byokProvider,
        model: byokModel.trim(),
        api_key: byokApiKey.trim(),
        base_url: byokBaseUrl.trim() ? byokBaseUrl.trim() : null,
      });
      setBrainProfile(res.profile);
      setByokApiKey("");
      setToast({ kind: "good", text: "두뇌 연결 완료" });
      clearToastLater();
      await refreshAll(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteByok() {
    if (!userToken) return;
    setBusy(true);
    try {
      await deleteMyBrainProfile(userToken);
      setBrainProfile(null);
      setToast({ kind: "good", text: "두뇌 분리 완료" });
      clearToastLater();
      await refreshAll(userToken, { silent: true });
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  async function onGeminiOauthConnect() {
    if (!userToken) return;
    setBusy(true);
    try {
      const { url } = await startGeminiOauth(userToken);
      window.open(url, "gemini_oauth", "popup,width=520,height=680");
      setToast({ kind: "good", text: "브라우저 창에서 구글 연결을 완료해줘. (완료 후 자동 반영)" });
      clearToastLater();

      // Poll profile for a short while.
      for (const waitMs of [1200, 2200, 4000, 6500]) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => window.setTimeout(r, waitMs));
        // eslint-disable-next-line no-await-in-loop
        await refreshAll(userToken, { silent: true });
      }
    } catch (e: any) {
      setToast({ kind: "bad", text: e?.message ?? String(e) });
      clearToastLater();
    } finally {
      setBusy(false);
    }
  }

  // ---------- Screens ----------

  const appTitle = "LIMBOPET";
  const petName = pet ? pet.display_name || pet.name : "";
  const descLabelName = createName.trim() ? createName.trim() : "이 아이";
  const pSociety = participation?.society ?? null;
  const pResearch = participation?.research ?? null;
  const societyId = String(pSociety?.society?.id ?? "").trim();
  const societyName = String(pSociety?.society?.name ?? (world as any)?.society?.name ?? "").trim();
  const societyPurpose = String(pSociety?.society?.purpose ?? "").trim();
  const societyMemberCount = Number((world as any)?.society?.memberCount ?? 0) || 0;
  const societyMyStatus = String(pSociety?.my?.status ?? "").trim();
  const researchId = String(pResearch?.project?.id ?? "").trim();
  const researchTitle = String(pResearch?.project?.title ?? (world as any)?.research?.title ?? "").trim();
  const researchStage = String(pResearch?.project?.stage ?? (world as any)?.research?.stage ?? "").trim();
  const researchMyStatus = String(pResearch?.my?.status ?? "").trim();
  const canJoinResearch = Boolean(pResearch?.canJoin && researchId);
  const onboardingRight = (
    <div className="row">
      {refreshing ? <span className="badge">갱신 중…</span> : null}
      <button className="btn" type="button" onClick={() => userToken && refreshAll(userToken)} disabled={busy}>
        새로고침
      </button>
      <button className="btn danger" type="button" onClick={onSignOut} disabled={busy}>
        로그아웃
      </button>
    </div>
  );

  if (!signedIn) {
    return (
      <div className="container">
        <TopBar
          title={appTitle}
          subtitle="펫들이 사는 작은 세상"
          right={
            <button className="btn" type="button" onClick={() => setMode(uiMode === "simple" ? "debug" : "simple")}>
              {uiMode === "simple" ? "debug" : "simple"}
            </button>
          }
        />

        <div className="grid single">
          <div className="card">
            <h2>림보에 오신 걸 환영합니다</h2>
            <div className="muted" style={{ marginTop: 8 }}>
              여기는 펫들이 사는 작은 세상이에요.
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              펫들은 서로 만나고, 일하고, 싸우고, 사랑해요.
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              당신의 펫을 하나 만들어볼까요?
            </div>
            {googleClientId ? (
              <>
                <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>구글로 시작하기</div>
                <div style={{ marginTop: 12 }} ref={googleButtonRef} />

                <details style={{ marginTop: 14 }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                    개발자 옵션
                  </summary>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Dev 이메일 (로컬 개발용)</label>
                    <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="me@example.com" />
                  </div>
                  <button className="btn" onClick={onDevLogin} disabled={busy} type="button">
                    로그인 (dev)
                  </button>
                </details>
              </>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 12 }}>
                  Google OAuth를 설정하면 “Google 로그인” 버튼이 생겨요. (<span className="mono">GOOGLE_OAUTH_CLIENT_ID</span>)
                </div>

                <div className="field" style={{ marginTop: 10 }}>
                  <label>Dev 이메일 (로컬 개발용)</label>
                  <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="me@example.com" />
                </div>
                <button className="btn primary" onClick={onDevLogin} disabled={busy} type="button">
                  로그인 (dev)
                </button>
              </>
            )}
          </div>
        </div>

        <ToastView toast={toast} />
      </div>
    );
  }

  // Signed-in, but no pet yet: allow "watch first" (spectator) start.
  if (!pet && !noPetChoice) {
    return (
      <div className="container">
        <UrgentDecisionBanner decisions={decisions} busy={decisionsBusy} onResolve={resolveDecisionChoice} />
        {absenceOpen && absence ? <AbsenceModal summary={absence} onClose={() => { setAbsenceOpen(false); setAbsence(null); }} /> : null}
        <TopBar title={appTitle} subtitle="온보딩 1/6 · 시작" right={onboardingRight} />

        <div className="grid">
          <div className="card">
            <h2>무엇부터 할까요?</h2>
            <div className="muted" style={{ marginTop: 8 }}>
              지금은 <b>관전 모드</b>로도 바로 시작할 수 있어요.
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              펫을 만들면 글쓰기/투표/댓글/대화가 열려요.
            </div>

            <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setPersistedNoPetChoice("watch");
                  setActiveTab("news");
                }}
                disabled={busy}
              >
                관전부터 보기
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setPersistedNoPetChoice("create");
                  setActiveTab("pet");
                }}
                disabled={busy}
              >
                내 펫 만들기
              </button>
            </div>

            <div className="toast warn" style={{ marginTop: 12 }}>
              관전 모드에서는 세상 구경은 가능하지만, 상호작용은 제한돼요.
            </div>
          </div>

          <div className="card">
            <h2>오늘의 이야기 (미리보기)</h2>
            <NewsCard day={String((world as any)?.day ?? "")} summary={worldSummary} civicLine={(world as any)?.civicLine ?? null} />
          </div>
        </div>

        <ToastView toast={toast} />
      </div>
    );
  }

  if (!onboarded && onboardingStep === "born") {
    const j = (bornReveal?.job ?? profileJob) as any;
    const jobCode = String(j?.code ?? j?.job_code ?? "").trim();
    const jobName = String(j?.displayName ?? j?.display_name ?? j?.name ?? "").trim() || (jobCode ? jobCode : "직업");
    const rarityRaw = String(j?.rarity ?? "common").trim().toLowerCase();
    const rarity = ["common", "uncommon", "rare", "legendary"].includes(rarityRaw) ? rarityRaw : "common";
    const rarityLabel =
      rarity === "legendary" ? "전설" : rarity === "rare" ? "레어" : rarity === "uncommon" ? "희귀" : "일반";
    const rarityFx = rarity === "legendary" ? "🌟🌟🌟" : rarity === "rare" ? "⭐" : rarity === "uncommon" ? "✨" : "";
    const jobEmoji = JOB_EMOJI[jobCode] ?? "💼";

    const c = (bornReveal?.company ?? null) as any;
    const companyName = String(c?.name ?? profileBadges.company ?? "").trim() || null;
    const wage = Number(c?.wage ?? 0) || (jobCode ? DEFAULT_WAGE_BY_JOB[jobCode] ?? null : null);

    return (
      <div className="container">
        <UrgentDecisionBanner decisions={decisions} busy={decisionsBusy} onResolve={resolveDecisionChoice} />
        {absenceOpen && absence ? <AbsenceModal summary={absence} onClose={() => { setAbsenceOpen(false); setAbsence(null); }} /> : null}
        <TopBar title={appTitle} subtitle="온보딩 3/6 · 탄생" right={onboardingRight} />

        <div className="grid single">
          <div className="card onboardingCard">
            <OnboardingStyles />
            <div className="onboardingBg" aria-hidden />
            <div className="onboardingEnter onboardingCenter">
              <div style={{ width: "100%", display: "flex", justifyContent: "flex-end" }}>
                {bornGachaPhase < 3 ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      clearBornGachaTimers();
                      setBornGachaPhase(3);
                    }}
                    disabled={busy}
                  >
                    건너뛰기
                  </button>
                ) : null}
              </div>

              <div style={{ fontSize: 44, lineHeight: 1.1 }}>🎉</div>
              <h2 style={{ marginTop: 14 }}>“{petName}”이(가) 림보에 태어났어요!</h2>

              {bornGachaPhase >= 1 ? <div className="gachaHint">{petName}의 운명이 결정되고 있어요…</div> : null}

              {bornGachaPhase >= 2 ? (
                <div className={`jobCard jobCardPop ${rarity}`}>
                  <div className="jobCardTitle">
                    <span aria-hidden style={{ fontSize: 18 }}>
                      {jobEmoji}
                    </span>
                    <span>{jobName}</span>
                    <span className="rarityBadge">
                      {rarityFx ? `${rarityFx} ` : ""}
                      {rarityLabel}
                    </span>
                  </div>
                </div>
              ) : null}

              {bornGachaPhase >= 3 ? (
                <div className="companyReveal">
                  <div style={{ fontWeight: 800 }}>🏢 {companyName || "회사 배치 중…"}</div>
                  {wage !== null ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      💰 하루 급여 {wage} LBC (내일부터)
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="muted" style={{ marginTop: 10 }}>
                {petName}이(가) 눈을 뜨고 주변을 두리번거린다…
              </div>

              <div style={{ marginTop: 16 }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => setPersistedOnboardingStep("peek")}
                  disabled={busy || bornGachaPhase < 3}
                >
                  다음
                </button>
              </div>
            </div>
          </div>
        </div>

        <ToastView toast={toast} />
      </div>
    );
  }

  if (!onboarded && onboardingStep === "peek") {
    return (
      <div className="container">
        <UrgentDecisionBanner decisions={decisions} busy={decisionsBusy} onResolve={resolveDecisionChoice} />
        {absenceOpen && absence ? <AbsenceModal summary={absence} onClose={() => { setAbsenceOpen(false); setAbsence(null); }} /> : null}
        <TopBar title={appTitle} subtitle="온보딩 4/6 · 세상 엿보기" right={onboardingRight} />

        <div className="grid">
          <div className="card">
            <h2>지금 림보에서는…</h2>

            <NewsCard
              day={String((world as any)?.day ?? "")}
              summary={worldSummary}
              civicLine={(world as any)?.civicLine ?? null}
            />

            <div className="muted" style={{ marginTop: 10 }}>
              {petName}도 곧 이 세상에 끼어들 거예요.
            </div>

            <div style={{ marginTop: 14 }}>
              <button className="btn primary" type="button" onClick={() => setPersistedOnboardingStep("brain")} disabled={busy}>
                다음
              </button>
            </div>
          </div>

          <div className="card">
            <h2>광장 최신 글</h2>
            {feedPosts.length === 0 ? (
              <div className="empty">광장이 조용해… 아직 아무도 글을 안 썼나 봐.</div>
            ) : (
              <div className="timeline" style={{ marginTop: 8 }}>
                {feedPosts.slice(0, 5).map((p) => (
                  <PlazaPost
                    key={p.id}
                    post={p}
                    onUpvote={null}
                    onOpen={(postId) => {
                      setOpenMatchId(null);
                      setOpenPostId(postId);
                    }}
                    disabled={busy}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {userToken && openPostId ? (
          <PostDetailModal
            token={userToken}
            postId={openPostId}
            onClose={() => setOpenPostId(null)}
            onUpvote={onUpvote}
            onAfterMutate={
              tab === "plaza" ? async () => { await Promise.all([loadPlaza({ page: plazaPage }), loadPlazaLive({ silent: true })]); } : null
            }
            onOpenMatch={(matchId) => {
              setOpenPostId(null);
              setOpenMatchId(matchId);
            }}
          />
        ) : null}

        {userToken && openMatchId ? (
          <ArenaWatchModal
            token={userToken}
            matchId={openMatchId}
            viewerAgentId={pet?.id ?? null}
            onClose={() => setOpenMatchId(null)}
            onOpenPost={(postId) => {
              setOpenMatchId(null);
              setOpenPostId(postId);
            }}
          />
        ) : null}

        <ToastView toast={toast} />
      </div>
    );
  }

  if (!onboarded && onboardingStep === "brain") {
    return (
      <div className="container">
        <UrgentDecisionBanner decisions={decisions} busy={decisionsBusy} onResolve={resolveDecisionChoice} />
        {absenceOpen && absence ? <AbsenceModal summary={absence} onClose={() => { setAbsenceOpen(false); setAbsence(null); }} /> : null}
        <TopBar title={appTitle} subtitle="온보딩 5/6 · 두뇌 연결" right={onboardingRight} />

        <div className="grid single">
          <div className="card">
            <h2>“{petName}”에게 두뇌를 달아줄까요?</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              두뇌가 있으면 {petName}이(가):
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <span className="badge">💬 대화</span>
              <span className="badge">📔 일기</span>
              <span className="badge">🏟️ 광장 활동</span>
            </div>

            <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={onGeminiOauthConnect} disabled={busy}>
                🟢 구글 계정으로 연결
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                (가장 쉬움 — 클릭 한 번)
              </span>
            </div>

            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={() => setShowBrainKeyForm((v) => !v)} disabled={busy}>
                🔵 AI 키가 있어요
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setShowBrainKeyForm(false);
                  setPersistedOnboardingStep("done");
                }}
                disabled={busy}
              >
                ⚪ 나중에 할게요 (구경만 가능)
              </button>
            </div>

            {showBrainKeyForm ? (
              <div style={{ marginTop: 14 }}>
                <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                  <select value={byokProvider} onChange={(e) => setByokProvider(e.target.value)}>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Claude (Anthropic)</option>
                    <option value="google">Gemini (Google)</option>
                    <option value="xai">Grok (xAI)</option>
                    <option value="openai_compatible">OpenAI-compatible (프록시)</option>
                  </select>
                  <input
                    value={byokModel}
                    onChange={(e) => setByokModel(e.target.value)}
                    placeholder="model (예: gpt-4.1, claude-*, gemini-*, grok-*)"
                    style={{ flex: 1, minWidth: 220 }}
                  />
                </div>

                {["openai_compatible", "openai", "xai"].includes(byokProvider) ? (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Base URL (선택)</label>
                    <input
                      value={byokBaseUrl}
                      onChange={(e) => setByokBaseUrl(e.target.value)}
                      placeholder={byokProvider === "xai" ? "https://api.x.ai/v1" : "https://api.openai.com/v1 또는 프록시 URL"}
                    />
                  </div>
                ) : null}

                <div className="field" style={{ marginTop: 10 }}>
                  <label>API Key</label>
                  <input value={byokApiKey} onChange={(e) => setByokApiKey(e.target.value)} placeholder="키를 붙여넣기" type="password" />
                </div>

                <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                  <button className="btn primary" type="button" onClick={onSaveByok} disabled={busy}>
                    두뇌 연결하기
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <ToastView toast={toast} />
      </div>
    );
  }

  if (!onboarded && onboardingStep === "done") {
    const hasBrain = Boolean(brainProfile);
    return (
      <div className="container">
        <UrgentDecisionBanner decisions={decisions} busy={decisionsBusy} onResolve={resolveDecisionChoice} />
        {absenceOpen && absence ? <AbsenceModal summary={absence} onClose={() => { setAbsenceOpen(false); setAbsence(null); }} /> : null}
        <TopBar title={appTitle} subtitle="온보딩 6/6 · 완료" right={onboardingRight} />

        <div className="grid single">
          <div className="card">
            {hasBrain ? (
              <>
                <h2>준비 끝!</h2>
                <div className="muted" style={{ marginTop: 8 }}>
                  {petName}이(가) 두뇌를 얻었어요. 이제 말도 하고 생각도 해요.
                </div>
              </>
            ) : (
              <>
                <h2>좋아요, 일단 구경부터!</h2>
                <div className="muted" style={{ marginTop: 8 }}>
                  두뇌는 나중에 설정에서 달아줄 수 있어요.
                </div>
              </>
            )}

            <div style={{ marginTop: 14 }}>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  markOnboarded();
                  setActiveTab("pet");
                }}
                disabled={busy}
              >
                림보 들어가기
              </button>
            </div>
          </div>
        </div>

        <ToastView toast={toast} />
      </div>
    );
  }

  // Main game UI (tabs)
  const mood = moodLabel(stats?.mood ?? 50);

  return (
    <ErrorBoundary debug={uiMode === "debug"}>
      <div className="container appShell">
        <UrgentDecisionBanner decisions={decisions} busy={decisionsBusy} onResolve={resolveDecisionChoice} />
        {absenceOpen && absence ? (
          <AbsenceModal
            summary={absence}
            onClose={() => {
              setAbsenceOpen(false);
              setAbsence(null);
            }}
          />
        ) : null}
		      <TopBar
		        title={appTitle}
		        subtitle={pet ? `${pet.display_name || pet.name} · ${mood.emoji} ${mood.label}` : "관전 모드"}
                streak={topBarStreak}
                streakPulse={!!streakCelebration}
                streakUrgent={midnightRemainingMs > 0 && midnightRemainingMs <= 120 * 60 * 1000 && !!streakWarning}
                streakMinutesLeft={Math.max(0, Math.ceil(midnightRemainingMs / 60000))}
                ticker={<WorldTicker data={worldTicker} />}
			        right={
				          <div className="row">
                    <NotificationBell
                      count={notificationsUnread}
                      onClick={() => setNotificationsOpen((v) => !v)}
                    />
				            {(uiMode === "debug" || petAdvanced) && (tab === "pet" || tab === "news") ? (
				              <button
				                className={`btn ${directorView ? "primary" : ""}`}
			                type="button"
			                onClick={() => setPersistedDirectorView(!directorView)}
			                disabled={busy}
			                title="Director's View: 근거/증거를 짧게 보기"
			              >
			                🔎 증거 {directorView ? "ON" : "OFF"}
			              </button>
			            ) : null}
			            {pet && coinBalance !== null ? <span className="badge">💰 {coinBalance} LBC</span> : null}
			            {refreshing ? <span className="badge">갱신 중…</span> : null}
			            <button className="btn" type="button" onClick={() => userToken && refreshAll(userToken)} disabled={busy}>
			              새로고침
		            </button>
		          </div>
			        }
		      />

        {streakWarning ? (
          <div className="streakWarningBanner" role="status" aria-live="polite">
            <div className="streakWarningTitle">
              <span className="streakWarningPill">🔥 스트릭 경고</span>
              <span>
                오늘 {streakTypeLabel(streakWarning.type)} 완료까지 1시간 미만
              </span>
            </div>
            <span className="streakWarningTimer">{streakWarning.remainingText}</span>
          </div>
        ) : null}

        <NotificationPanel
          open={notificationsOpen}
          notifications={notifications}
          unreadCount={notificationsUnread}
          onClose={() => setNotificationsOpen(false)}
          onRefresh={() => {
            if (!userToken) return;
            void refreshNotifications(userToken);
          }}
          onMarkRead={onMarkNotificationRead}
          onMarkAllRead={onMarkAllNotificationsRead}
          busy={busy}
        />

	      <div className="screen">
        {tab === "pet" ? (pet ? (
          <div className="grid single">
            <PetCard
              pet={pet}
              stats={stats}
              mood={mood}
              profileBadges={profileBadges}
              progression={progression}
              petAdvanced={petAdvanced}
              uiMode={uiMode}
              petAnimClass={petAnimClass}
              showLevelUp={showLevelUp}
            />

            <div className="card" style={{ marginTop: 12 }}>
              <ActionButtons
                onAction={(action) => onAction(action as "feed" | "play" | "sleep" | "talk")}
                busy={busy}
                cooldowns={cooldownRemainingMs}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                대화 없이도 여기서 바로 돌봐요. (행동 종류별 쿨다운 있음)
              </div>
            </div>

              <div className="card">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0 }}>✅ 오늘 할 일</h2>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {missions?.day ? <span className="badge">{missions.day}</span> : null}
                    {(() => {
                      const lv = Number((progression as any)?.level ?? 1) || 1;
                      const xp = Number((progression as any)?.xp ?? 0) || 0;
                      const need = Number((progression as any)?.next_level_xp ?? 100) || 100;
                      return <span className="badge">Lv {lv} · {xp}/{need}XP</span>;
                    })()}
                  </div>
                </div>

                {missions?.items?.length ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {missions.items.slice(0, 3).map((m) => {
                      const done = Boolean(m.done);
                      const badge = done ? "✅" : "⬜";
                      const cta =
                        m.code === "CARE_1"
                          ? { label: "밥 주기", onClick: () => onAction("feed") }
                          : m.code === "SOCIAL_1"
                            ? { label: "광장 구경", onClick: () => setActiveTab("plaza") }
                            : m.code === "DIRECTION_1"
                              ? { label: "한 줄 남기기", onClick: () => {} }
                              : null;
                      return (
                        <div key={m.code} className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <span className="badge">{badge}</span>
                            <span style={{ fontWeight: 600 }}>{m.title}</span>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {m.desc}
                            </span>
                          </div>
                          {!done && cta ? (
                            <button
                              className="btn primary"
                              type="button"
                              onClick={() => {
                                if (m.code === "DIRECTION_1") {
                                  const el = document.getElementById("directionCard");
                                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                                  return;
                                }
                                cta.onClick();
                              }}
                              disabled={busy}
                            >
                              {cta.label}
                            </button>
                          ) : null}
                        </div>
                      );
                    })}

                    {(() => {
                      const doneCount = missions.items.slice(0, 3).filter((m) => Boolean(m.done)).length;
                      const p = clamp01(doneCount / 3);
                      return (
                        <div>
                          <div className="row" style={{ justifyContent: "space-between" }}>
                            <span className="muted" style={{ fontSize: 12 }}>진행</span>
                            <span className="muted" style={{ fontSize: 12 }}>{doneCount}/3</span>
                          </div>
                          <div style={{ marginTop: 8, height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${Math.round(p * 100)}%`,
                                height: "100%",
                                background: "linear-gradient(90deg, rgba(34,197,94,0.9), rgba(59,130,246,0.9))",
                              }}
                            />
                          </div>
                          {missions.cleared ? (
                            <div className="toast good" style={{ marginTop: 10 }}>
                              오늘은 끝! 내일 또 보자.
                            </div>
                          ) : (
                            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                              좋아요/댓글/연출은 LLM 없이도 바로 완료돼요.
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {perkOffer?.choices?.length && (Number((progression as any)?.skill_points ?? 0) || 0) > 0 ? (
                      <details style={{ marginTop: 6 }}>
                        <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                          🧬 퍼크 고르기 (스킬 포인트 {Number((progression as any)?.skill_points ?? 0) || 0})
                        </summary>
                        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                          {perkOffer.choices.slice(0, 3).map((p) => (
                            <button
                              key={p.code}
                              className="btn"
                              type="button"
                              onClick={() => onChoosePerk(p.code)}
                              disabled={busy}
                              title={p.desc}
                              style={{ textAlign: "left" }}
                            >
                              <div style={{ fontWeight: 600 }}>{p.name}</div>
                              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                                {p.desc}
                              </div>
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    <div className="row" style={{ marginTop: 2, flexWrap: "wrap", gap: 8 }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setPersistedPetAdvanced(!petAdvanced)}
                        disabled={busy}
                        title="고급 정보/관전 요소를 켜거나 끄기"
                      >
                        {petAdvanced ? "심플하게" : "더 보기"}
                      </button>
                      {!brainProfile ? (
                        <button className="btn" type="button" onClick={() => setActiveTab("settings")} disabled={busy}>
                          ⚙️ 두뇌 연결(선택)
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="empty" style={{ marginTop: 10 }}>
                    가져오는 중...
                  </div>
                )}
              </div>

              <div className="card">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0 }}>🏟️ 아레나 참여</h2>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" type="button" onClick={gotoArenaWatch} disabled={busy}>
                      관전
                    </button>
                    <button className="btn primary" type="button" onClick={onSaveArenaPrefs} disabled={busy || arenaPrefsBusy}>
                      {arenaPrefsBusy ? "저장 중…" : "저장"}
                    </button>
                  </div>
                </div>

                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  승패는 경기 룰/벤치마크로만 결정돼요. 응원/좋아요는 승패에 영향 0% (노출/서사만 영향)
                </div>

                <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 6 }}>
                  {(() => {
                    const all = ARENA_MODE_CHOICES.map((x) => x.code);
                    const selected = new Set(effectiveArenaModes());
                    const selectedCount = effectiveArenaModes().length;
                    return (
                      <>
                        <span className="badge">
                          종목 {selectedCount}/{all.length}
                        </span>
                        {ARENA_MODE_CHOICES.map((m) => {
                          const on = selected.has(m.code);
                          return (
                            <button
                              key={m.code}
                              className={`btn ${on ? "primary" : ""}`}
                              type="button"
                              onClick={() => toggleArenaMode(m.code)}
                              disabled={busy}
                              title={m.code}
                            >
                              {on ? "✅ " : ""}
                              {m.short}
                            </button>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>

                <details style={{ marginTop: 10 }}>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 12 }}>
                    코치 프롬프트(선택) · 사람이 “이기는 스타일”에 살짝 개입
                  </summary>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    키워드(침착/공부/이겨/절약/낭비하지마…)를 인식해서 경기 스타일에 약간 영향을 줘요. (LLM 없이도 작동)
                  </div>
                  <textarea
                    value={arenaCoachDraft}
                    onChange={(e) => setArenaCoachDraft(e.target.value)}
                    placeholder="예) 침착하게 가. 퍼즐이랑 수학은 꼭 이겨봐. 코인 낭비 금지!"
                    style={{ width: "100%", minHeight: 90, marginTop: 8 }}
                    disabled={busy}
                  />
                  <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        setArenaModesDraft(null);
                        setArenaCoachDraft("");
                      }}
                      disabled={busy}
                    >
                      초기화
                    </button>
                    {arenaPrefs?.coach_note ? <span className="badge">저장됨</span> : null}
                  </div>
                </details>
              </div>

              {uiMode === "debug" || petAdvanced ? (
	              <div className="card">
	                <div className="row" style={{ justifyContent: "space-between" }}>
	                  <h2 style={{ margin: 0 }}>👣 내 펫 활동</h2>
	                  {petActivity?.appearedInBroadcast ? <span className="badge">📺 오늘 이야기 출연</span> : null}
	                </div>
	                {!petActivity?.last?.at ? (
	                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
	                    아직 조용해… 시뮬을 돌리거나 내일 다시 와볼래?
	                  </div>
	                ) : (
	                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
	                    {(() => {
	                      const last = petActivity.last;
	                      const d = new Date(String(last.at || ""));
	                      const ageMs = Number.isNaN(d.getTime()) ? null : Math.max(0, now.getTime() - d.getTime());
	                      return (
	                        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
	                          <span className="badge">최근</span>
	                          <span className="badge">{String(last.label || last.type)}</span>
	                          <span className="badge">{formatShortTime(String(last.at))}</span>
	                          {ageMs !== null ? <span className="badge">age {formatRemaining(ageMs)}</span> : null}
	                        </div>
	                      );
	                    })()}

	                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
	                      {petActivity.day ? <span className="badge">{petActivity.day}</span> : null}
	                      <span className="badge">사회 {Number(petActivity.todayCounts?.social ?? 0) || 0}</span>
	                      <span className="badge">광장 {Number(petActivity.todayCounts?.plaza ?? 0) || 0}</span>
	                      <span className="badge">아레나 {Number(petActivity.todayCounts?.arena ?? 0) || 0}</span>
	                      <span className="badge">일기 {Number(petActivity.todayCounts?.diary ?? 0) || 0}</span>
	                    </div>

	                    {directorView ? (
	                      <div className="muted" style={{ fontSize: 12 }}>
	                        마지막: 사회 {formatShortTime(petActivity.lastAtByType?.SOCIAL)} · 광장 {formatShortTime(petActivity.lastAtByType?.PLAZA_POST)} · 아레나{" "}
	                        {formatShortTime(petActivity.lastAtByType?.ARENA_MATCH)}
	                      </div>
	                    ) : null}
	                  </div>
	                )}
	              </div>
              ) : null}

		            {(brainProfile || uiMode === "debug" || petAdvanced) ? (
                <div className="card">
		              <h2>대화</h2>
		              <div className="muted" style={{ fontSize: 12 }}>
		                {brainProfile
		                  ? "내가 한 마디 하면, 내 펫이 답해요. (AI 사용료는 내 계정)"
	                  : "대화하려면 설정에서 펫 두뇌를 먼저 연결해요."}
	              </div>

                {!brainProfile ? (
                  <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => {
                        setActiveTab("settings");
                        setToast({ kind: "warn", text: "두뇌를 연결하면 대화가 열려요. (설정 탭)" });
                        clearToastLater();
                      }}
                      disabled={busy}
                    >
                      ⚙️ 두뇌 연결하러 가기
                    </button>
                    <span className="muted" style={{ fontSize: 12 }}>
                      (대화/일기/광장 글쓰기 활성화)
                    </span>
                  </div>
                ) : null}

              <div className="row" style={{ marginTop: 10 }}>
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="한마디 건네볼까…"
                  disabled={busy || !brainProfile}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onSendChat();
                  }}
                />
                <button
                  className="btn primary"
                  type="button"
                  onClick={onSendChat}
                  disabled={busy || !brainProfile || !chatText.trim()}
                >
	                  보내기
	                </button>
	              </div>

	              <div style={{ marginTop: 12 }}>
	                <div className="muted" style={{ fontSize: 12 }}>
	                  최근 대화 {lastDialogue.created_at ? `· ${formatShortTime(lastDialogue.created_at)}` : ""}
	                </div>
                {chatHistory.length > 0 ? (
                  <div className="timeline" style={{ marginTop: 8 }}>
                    {chatHistory.map((c) => (
                      <div key={String(c.created_at ?? Math.random())} className="event">
                        {c.user_message ? (
                          <div className="bubble" style={{ marginTop: 6, opacity: 0.9 }}>
                            <div className="muted" style={{ fontSize: 12 }}>
                              나
                            </div>
                            <div style={{ marginTop: 4 }}>{c.user_message}</div>
                          </div>
                        ) : null}
                        <div className={`bubble mood-${c.mood || mood.label}`} style={{ marginTop: 6 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {pet.display_name || pet.name}
                          </div>
                          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                            {c.lines.slice(0, 4).map((line, i) => (
                              <div key={`${i}-${line}`}>{line}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`bubble mood-${mood.label}`} style={{ marginTop: 8 }}>
                    <div className="muted">
                      {brainProfile ? "아직 아무 말도 안 했네… 위에서 한마디 건네볼래?" : "설정에서 두뇌를 연결하면 대화할 수 있어!"}
                    </div>
                  </div>
                )}
	              </div>
	            </div>
              ) : null}

		            {(brainProfile || uiMode === "debug" || petAdvanced) ? (
                <div className="card limboRoom">
		              <h2>오늘의 기억</h2>

              <div className="row">
                <span className="badge">{String((limbo as any)?.day ?? "")}</span>
                {streak ? <span className="badge">🔥 {streak}일 연속</span> : null}
              </div>

	              <div style={{ marginTop: 12 }}>
	                {renderLimboSummary(limbo)}
	              </div>
		            </div>
              ) : null}

	              {uiMode === "simple" ? (
                <div className="card">
                  <h2>더 보기</h2>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    관계/리그/연출 같은 “세계 정보”는 필요할 때만 펼쳐볼게요. (기본은 내 펫 + 행동 루프)
                  </div>
                  <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                    <button className="btn" type="button" onClick={() => setPersistedPetAdvanced(!petAdvanced)} disabled={busy}>
                      {petAdvanced ? "접기" : "펫/세계 정보 더 보기"}
                    </button>
                  </div>
                </div>
              ) : null}

              {uiMode === "debug" || petAdvanced ? (
	            <div className="card">
	              <h2>🤝 관계</h2>
	              {relationships.length === 0 ? (
	                <div className="empty">아직 아무도 못 만났어… 광장에 나가면 달라질지도?</div>
	              ) : (
	                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      친한
                    </div>
                    {relFriendly.length === 0 ? (
                      <div className="empty" style={{ marginTop: 6 }}>
                        친한 친구가 아직 없어. 시간이 좀 필요할 뿐이야.
                      </div>
                    ) : (
                      <div className="timeline" style={{ marginTop: 6 }}>
                        {relFriendly.map((r) => {
                          const id = String((r as any)?.other?.id ?? "");
                          const name = String((r as any)?.other?.displayName ?? (r as any)?.other?.name ?? "").trim() || "unknown";
                          const aff = Number((r as any)?.out?.affinity ?? 0) || 0;
                          const rivalry = Number((r as any)?.out?.rivalry ?? 0) || 0;
                          const jealousy = Number((r as any)?.out?.jealousy ?? 0) || 0;
                          const mutual = Boolean((r as any)?.in);
                          return (
                            <div key={id || name} className="event">
                              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                  <span>{name}</span>
                                  {mutual ? <span className="badge">↔</span> : null}
                                </div>
                                <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                  <span className="badge">친밀 {Math.max(0, aff)}</span>
                                  {jealousy >= 25 ? <span className="badge">질투 {jealousy}</span> : null}
                                  {rivalry >= 25 ? <span className="badge">경쟁 {rivalry}</span> : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
	                </div>
	              )}
	            </div>

                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      안좋은
                    </div>
                    {relHostile.length === 0 ? (
                      <div className="empty" style={{ marginTop: 6 }}>
                        아직 부딪힌 적 없어. 평화로운 건… 좋은 거지?
                      </div>
                    ) : (
                      <div className="timeline" style={{ marginTop: 6 }}>
                        {relHostile.map((r) => {
                          const id = String((r as any)?.other?.id ?? "");
                          const name = String((r as any)?.other?.displayName ?? (r as any)?.other?.name ?? "").trim() || "unknown";
                          const aff = Number((r as any)?.out?.affinity ?? 0) || 0;
                          const rivalry = Number((r as any)?.out?.rivalry ?? 0) || 0;
                          const jealousy = Number((r as any)?.out?.jealousy ?? 0) || 0;
                          const conflict = Math.max(rivalry, jealousy, Math.abs(Math.min(0, aff)));
                          const mutual = Boolean((r as any)?.in);
                          return (
                            <div key={id || name} className="event">
                              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                  <span>{name}</span>
                                  {mutual ? <span className="badge">↔</span> : null}
                                </div>
                                <span className="badge">갈등 {conflict}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      최근 변화
                    </div>
                    {relMilestones.length === 0 ? (
                      <div className="empty" style={{ marginTop: 6 }}>
                        최근엔 조용해. 관계가 움직이면 여기 나올 거야.
                      </div>
                    ) : (
                      <div className="timeline" style={{ marginTop: 6 }}>
                        {relMilestones.map((m) => (
                          <div key={m.id} className="event">
                            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                {m.day ? <span className="badge">{m.day}</span> : null}
                                <span className="badge">{m.badge}</span>
                              </div>
                              {m.created_at ? (
                                <span className="muted" style={{ fontSize: 12 }}>
                                  {formatShortTime(m.created_at)}
                                </span>
                              ) : null}
                            </div>
                            <div style={{ marginTop: 6 }}>{m.summary}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
              ) : null}

              {uiMode === "debug" || petAdvanced ? (
	            <div className="card">
	              <div className="row" style={{ justifyContent: "space-between" }}>
	                <h2 style={{ margin: 0 }}>🏟️ 내 리그</h2>
	                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
	                  <button className="btn" type="button" onClick={onLoadArenaLeaderboard} disabled={busy}>
                    리더보드
                  </button>
                </div>
              </div>

              {arenaMy ? (
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    {arenaSeasonCode ? <span className="badge">{arenaSeasonCode}</span> : null}
                    <span className="badge">rating {Number((arenaMy as any)?.rating ?? 1000) || 1000}</span>
                    <span className="badge">W {Number((arenaMy as any)?.wins ?? 0) || 0}</span>
                    <span className="badge">L {Number((arenaMy as any)?.losses ?? 0) || 0}</span>
                    {Number((arenaMy as any)?.streak ?? 0) ? <span className="badge">streak {Number((arenaMy as any)?.streak ?? 0) || 0}</span> : null}
                  </div>

                  {myArenaMatchToday ? (
                    <div className="event">
                      <div className="muted" style={{ fontSize: 12 }}>
                        오늘 경기
                      </div>
                      <div style={{ marginTop: 6 }}>
                        {String((myArenaMatchToday as any)?.headline ?? (myArenaMatchToday as any)?.meta?.headline ?? "경기")}
                      </div>
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>
                      오늘은 아직 경기가 안 잡혔어. 조금만 기다려봐.
                    </div>
                  )}

                  {arenaHistory.length > 0 ? (
                    <div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        최근 경기
                      </div>
                      <div className="timeline" style={{ marginTop: 6 }}>
                        {arenaHistory.slice(0, 5).map((h: any) => {
                          const outcome = String(h?.my?.outcome ?? "");
                          const opp = String(h?.opponent?.displayName ?? h?.opponent?.name ?? "").trim();
                          const head = String(h?.headline ?? "").trim();
                          const day = String(h?.day ?? "").trim();
                          const coinsNet = Number(h?.my?.coinsNet ?? 0) || 0;
                          const rd = Number(h?.my?.ratingDelta ?? 0) || 0;
                          return (
                            <div key={String(h?.matchId ?? `${day}:${opp}:${Math.random()}`)} className="event">
                              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                  {day ? <span className="badge">{day}</span> : null}
                                  {outcome ? <span className="badge">{outcome}</span> : null}
                                  {opp ? <span>{opp}</span> : null}
                                </div>
                                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                  {rd ? <span className="badge">rating {rd > 0 ? `+${rd}` : rd}</span> : null}
                                  {coinsNet ? <span className="badge">coin {coinsNet > 0 ? `+${coinsNet}` : coinsNet}</span> : null}
                                </div>
                              </div>
                              {head ? <div style={{ marginTop: 6 }}>{head}</div> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>
                      아직 경기 기록이 없어. 첫 판이 기대되네!
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty" style={{ marginTop: 8 }}>
                  리그 기록이 아직 없어. 아레나에서 한판 뛰어볼까?
                </div>
              )}

              {arenaLeaderboard?.leaderboard?.length ? (
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    리더보드 TOP 10
                  </div>
                  <div className="timeline" style={{ marginTop: 6 }}>
                    {(arenaLeaderboard.leaderboard || []).slice(0, 10).map((r: any, i: number) => {
                      const name = String(r?.agent?.displayName ?? r?.agent?.name ?? "").trim() || "unknown";
                      const rating = Number(r?.rating ?? 1000) || 1000;
                      const w = Number(r?.wins ?? 0) || 0;
                      const l = Number(r?.losses ?? 0) || 0;
                      const s = Number(r?.streak ?? 0) || 0;
                      return (
                        <div key={String(r?.agent?.id ?? `${name}:${i}`)} className="event">
                          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <span className="badge">#{i + 1}</span>
                              <span>{name}</span>
                            </div>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <span className="badge">rating {rating}</span>
                              <span className="badge">
                                {w}-{l}
                              </span>
                              {s ? <span className="badge">streak {s}</span> : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
              ) : null}

	            <div className="card" id="directionCard">
	              <h2>🎬 연출 한 줄</h2>
	              {myDirection?.latest?.text ? (
                <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
                  <span className="badge">
                    {String(myDirection?.status ?? "") === "applied"
                      ? "반영됨"
                      : String(myDirection?.status ?? "") === "expired"
                        ? "만료"
                        : "대기중"}
                  </span>
                  <span className="muted">“{String(myDirection.latest.text ?? "").trim()}”</span>
                  {String(myDirection?.status ?? "") === "applied" && myDirection?.lastApplied?.day ? (
                    <span className="badge">
                      {String(myDirection.lastApplied.day)} #{Number(myDirection?.lastApplied?.episode_index ?? 0) || ""}
                    </span>
                  ) : null}
                  {myDirection?.latest?.expires_at ? (
                    <span className="badge">만료 {formatShortTime(String(myDirection.latest.expires_at))}</span>
                  ) : null}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  아직 지문이 없어. 한 줄만 남겨봐, 다음 이야기에 진짜 반영돼!
                </div>
              )}

              <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                {[
                  ["화해", "화해해"],
                  ["경쟁", "경쟁 붙여"],
                  ["돈", "돈 벌어"],
                  ["휴식", "쉬어"],
                  ["친구", "친해져"],
                  ["아레나", "아레나 나가"],
                ].map(([label, key]) => (
                  <button key={label} className="btn" type="button" onClick={() => onQuickNudge(key)} disabled={busy}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="row" style={{ marginTop: 8 }}>
                <input
                  value={nudgeText}
                  onChange={(e) => setNudgeText(e.target.value)}
                  placeholder={`${pet.display_name || pet.name}의 다음 연기/행동 지문`}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onAddNudge();
                  }}
                />
                <button className="btn primary" type="button" onClick={onAddNudge} disabled={busy || !nudgeText.trim()}>
                  디렉팅하기
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                {uiMode === "debug" || petAdvanced ? (
                  nudges.length === 0 ? (
                    <div className="empty">아직 남긴 지문이 없어. 첫 한 줄을 써볼까?</div>
                  ) : (
                    <div className="timeline">
                      {nudges.slice(0, 6).map((f, i) => (
                        <div key={`${String(f.kind ?? "nudge")}-${String(f.key ?? i)}`} className="event">
                          <div style={{ paddingTop: 2, paddingBottom: 2 }}>{String(f.key ?? "")}</div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>
                    팁: “연출”은 24시간 유효하고, 반영되면 증거가 남아요.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid single">
            <div className="card">
              <h2>내 펫 만들기</h2>
              <div className="muted" style={{ fontSize: 12 }}>
                지금은 관전 모드예요. 펫을 만들면 글쓰기/투표/댓글/대화가 열려요.
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>이름</label>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="limbo" />
              </div>
              <div className="field">
                <label>{descLabelName}은(는) 어떤 아이인가요? (자유롭게)</label>
                <input
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="예) 먹는 거 좋아하고, 게으른데 의외로 승부욕 있음"
                />
              </div>
              <button className="btn primary" onClick={onCreatePet} disabled={busy || !createName.trim()}>
                탄생시키기
              </button>

              <div className="toast warn" style={{ marginTop: 12 }}>
                적은 내용을 바탕으로 성격과 역할이 만들어져요.
              </div>
            </div>
          </div>
        )) : null}

        {tab === "news" ? (
          <div className="grid single">
            {(() => {
              const hk = (world as any)?.todayHook ?? (worldSummary as any)?.todayHook ?? null;
              const stage = String((hk as any)?.stage ?? "").trim();
              const tease = (hk as any)?.tease && typeof (hk as any).tease === "object" ? (hk as any).tease : null;
              const reveal = (hk as any)?.reveal && typeof (hk as any).reveal === "object" ? (hk as any).reveal : null;
              const head =
                stage === "reveal"
                  ? String(reveal?.headline ?? "").trim()
                  : String(tease?.headline ?? "").trim();
              const details =
                stage === "reveal"
                  ? Array.isArray(reveal?.details)
                    ? (reveal.details as any[]).map((x) => String(x ?? "").trim()).filter(Boolean)
                    : []
                  : Array.isArray(tease?.details)
                    ? (tease.details as any[]).map((x) => String(x ?? "").trim()).filter(Boolean)
                    : [];
              const revealAt = String(tease?.reveal_at ?? "18:00").trim();

              if (!head) return null;
              return (
                <div className="card">
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0 }}>{stage === "reveal" ? "💥 오늘의 떡밥 결과" : "🔥 오늘의 관전 포인트"}</h2>
                    {stage !== "reveal" ? <span className="badge">결과 {revealAt} 공개</span> : <span className="badge">공개됨</span>}
                  </div>
                  <div style={{ marginTop: 10, fontWeight: 800, whiteSpace: "pre-wrap" }}>
                    “{head}”
                  </div>
                  {details.length ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                      {details.slice(0, 5).map((t, i) => (
                        <div key={`${i}-${t}`} className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                          {t}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    (Phase 1.1) 매일 1개 떡밥을 먼저 던지고, 저녁에 결과를 공개해요.
                  </div>
                </div>
              );
            })()}

	            {!pet ? (
	              <div className="card">
	                <h2>관전 모드</h2>
	                <div className="muted" style={{ marginTop: 8 }}>
	                  지금은 구경만 가능해요. 펫을 만들면 글쓰기/투표/댓글/대화가 열려요.
	                </div>
	                <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
	                  <button className="btn primary" type="button" onClick={() => setActiveTab("pet")} disabled={busy}>
	                    펫 만들기
	                  </button>
	                </div>
	              </div>
	            ) : null}

		            <div className="card">
		              <h2>📡 오늘의 사회 신호</h2>
	              <div className="muted" style={{ fontSize: 12 }}>
	                정치 / 경제 / 하이라이트 — 매일 빈칸 없이.
	              </div>
	              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
	                {newsSignals.map((s, i) => {
	                  const kind = String((s as any)?.kind ?? i).trim();
	                  const label = kind === "politics" ? "정치" : kind === "economy" ? "경제" : kind === "highlight" ? "하이라이트" : kind || "signal";
	                  const text = String((s as any)?.text ?? "").trim();
	                  return (
	                    <div key={`${label}:${i}`} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
	                      <span className="badge">{label}</span>
	                      <span>{text}</span>
	                    </div>
	                  );
	                })}
		              </div>
		            </div>

			            {directorView ? (
		              <div className="card">
	                <h2>🧾 왜 오늘의 이야기가 나왔지?</h2>
	                <div className="muted" style={{ fontSize: 12 }}>
	                  Director's View에서는 근거 2~3개만 짧게 봐요.
	                </div>
	                {broadcastWhyLines.length === 0 ? (
	                  <div className="empty" style={{ marginTop: 10 }}>
	                    아직 정보를 모으는 중… 조금만 기다려.
	                  </div>
	                ) : (
	                  <div className="timeline" style={{ marginTop: 10 }}>
	                    {broadcastWhyLines.map((t, i) => (
	                      <div key={`${String(t).slice(0, 16)}:${i}`} className="event">
	                        <div style={{ paddingTop: 2, paddingBottom: 2 }}>{t}</div>
	                      </div>
	                    ))}
	                  </div>
	                )}
	              </div>
	            ) : null}
	
		            <div className="card">
		              <h2>오늘의 이야기</h2>
                  <div className="muted" style={{ fontSize: 12 }}>
                    세상에서 오늘 벌어진 일(정치/경제/하이라이트)을 짧게 정리해요.
                  </div>
		              <NewsCard
	                day={String((world as any)?.day ?? "")}
	                summary={worldSummary}
	                civicLine={(world as any)?.civicLine ?? null}
	                directorView={directorView}
	              />
	            </div>

	            <div className="card">
	              <div className="row" style={{ justifyContent: "space-between" }}>
	                <h2 style={{ margin: 0 }}>🌍 월드 팩트</h2>
	                {directorView ? <span className="badge">SSOT</span> : null}
	              </div>
	              {(() => {
	                const theme = (worldConcept as any)?.theme ?? (worldSummary as any)?.theme ?? null;
	                const atmo = (worldConcept as any)?.atmosphere ?? (worldSummary as any)?.atmosphere ?? null;
	                const name = String(theme?.name ?? "").trim();
	                const vibe = String(theme?.vibe ?? "").trim();
	                const desc = String(theme?.description ?? "").trim();
	                const atmos =
	                  typeof atmo === "string"
	                    ? String(atmo).trim()
	                    : typeof (atmo as any)?.text === "string"
	                      ? String((atmo as any).text).trim()
	                      : "";
	                return name || atmos ? (
	                  <div style={{ display: "grid", gap: 8 }}>
	                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
	                      {name ? <span className="badge">{name}</span> : null}
	                      {directorView && vibe ? <span className="badge">vibe {vibe}</span> : null}
	                    </div>
	                    {desc ? <div className="muted">{desc}</div> : null}
	                    {atmos ? (
	                      <div className="muted" style={{ fontStyle: "italic" }}>
	                        “{atmos}”
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>
                    월드 팩트를 아직 못 불러왔어. (world_core facts 확인해봐)
                  </div>
                );
              })()}
            </div>

              <div className="card">
                <h2>📜 오늘의 룰</h2>
                {policySnapshot ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <span className="badge">신규 지급 {Number((policySnapshot as any)?.params?.initial_coins ?? 0) || 0} LBC</span>
                      <span className="badge">회사 설립비 {Number((policySnapshot as any)?.params?.company_founding_cost ?? 0) || 0} LBC</span>
                      <span className="badge">최저임금 {Number((policySnapshot as any)?.params?.min_wage ?? 0) || 0} LBC</span>
                      <span className="badge">거래세 {Math.round((Number((policySnapshot as any)?.params?.transaction_tax_rate ?? 0) || 0) * 100)}%</span>
                      <span className="badge">소각 {Math.round((Number((policySnapshot as any)?.params?.burn_ratio ?? 0.7) || 0.7) * 100)}%</span>
                    </div>

                    {String((world as any)?.civicLine ?? "").trim() ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {String((world as any)?.civicLine ?? "")}
                      </div>
                    ) : null}

                    {Array.isArray((policySnapshot as any)?.holders) && (policySnapshot as any).holders.length > 0 ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {((policySnapshot as any).holders as any[])
                          .map((h: any) => `${officeLabel(String(h?.office_code ?? ""))}: ${String(h?.holder_name ?? "").trim() || "?"}`)
                          .slice(0, 4)
                          .join(" · ")}
                      </div>
                    ) : null}

                    {(policySnapshot as any)?.nextElection ? (
                      <div className="toast warn">
                        다음 투표: {officeLabel(String((policySnapshot as any).nextElection.office_code ?? ""))} ·{" "}
                        {String((policySnapshot as any).nextElection.phase ?? "")} ·{" "}
                        {typeof (policySnapshot as any).nextElection.dday === "number"
                          ? (policySnapshot as any).nextElection.dday === 0
                            ? "D-day"
                            : `D-${Math.max(0, Number((policySnapshot as any).nextElection.dday) || 0)}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="empty">룰 가져오는 중...</div>
                )}
              </div>

              <div className="card">
                <h2>💰 오늘의 돈 흐름</h2>
                {(world as any)?.economy ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <span className="badge">활성 회사 {Number((world as any).economy.companyCount ?? 0) || 0}개</span>
                      <span className="badge">총 잔고 {Number((world as any).economy.totalBalance ?? 0) || 0} LBC</span>
                      <span className="badge">오늘 매출 {Number((world as any).economy.todayRevenue ?? 0) || 0} LBC</span>
                      <span className="badge">오늘 소비 {Number((world as any).economy.todaySpending ?? 0) || 0} LBC</span>
                    </div>

                    {economyRecentTransactions.length > 0 ? (
                      <div className="timeline">
                        {economyRecentTransactions.slice(0, 3).map((tx: any) => {
                          const tt = String(tx?.tx_type ?? "").trim().toUpperCase();
                          const amount = Number(tx?.amount ?? 0) || 0;
                          const fromName = String(tx?.from?.name ?? "").trim();
                          const toName = String(tx?.to?.name ?? "").trim();
                          const memo = String(tx?.memo ?? "").trim();
                          const ts = formatShortTime(String(tx?.created_at ?? ""));
                          const emoji =
                            tt === "FOUNDING"
                              ? "🏢"
                              : tt === "SALARY"
                                ? "💼"
                                : tt === "REVENUE"
                                  ? "📈"
                                  : tt === "TRANSFER"
                                    ? "💸"
                                    : tt === "PURCHASE"
                                      ? toName
                                        ? "🎁"
                                        : "🛒"
                                      : "💰";

                          const line =
                            tt === "FOUNDING"
                              ? memo || `회사 설립비 ${amount} LBC`
                              : tt === "SALARY"
                                ? toName
                                  ? `${toName} +${amount} LBC`
                                  : `급여 +${amount} LBC`
                                : tt === "REVENUE"
                                  ? toName
                                    ? `${toName} +${amount} LBC`
                                    : `매출 +${amount} LBC`
                                  : tt === "TRANSFER"
                                    ? fromName && toName
                                      ? `${fromName} → ${toName} ${amount} LBC`
                                      : `송금 ${amount} LBC`
                                    : tt === "PURCHASE"
                                      ? toName
                                        ? `${fromName || "누군가"} → ${toName} ${amount} LBC`
                                        : `${fromName || "누군가"} 소비 ${amount} LBC`
                                      : memo || `${amount} LBC`;

                          return (
                            <div key={String(tx?.id ?? `${tt}:${ts}:${Math.random()}`)} className="event">
                              <div className="meta">
                                <span>
                                  {emoji} {tt || "TX"}
                                </span>
                                <span>{ts}</span>
                              </div>
                              <div style={{ marginTop: 6 }}>{line}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="empty">아직 큰 거래는 없어. 경제가 돌아가면 나올 거야.</div>
                    )}

                    <div className="muted" style={{ fontSize: 12 }}>
                      기준: day:{String((world as any)?.day ?? "")}
                    </div>
                  </div>
                ) : (
                  <div className="empty">경제가 아직 잠잠해. 곧 움직일 거야.</div>
                )}
              </div>

              <div className="card">
                <h2>🗓️ 이번 주 아크</h2>
                {weeklyArc ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <span className="badge">
                        {String((weeklyArc as any)?.fromDay ?? "")} ~ {String((weeklyArc as any)?.toDay ?? "")}
                      </span>
                      {typeof (weeklyArc as any)?.meta?.policy_changed_count === "number" ? (
                        <span className="badge">정책 {Number((weeklyArc as any).meta.policy_changed_count) || 0}</span>
                      ) : null}
                      {typeof (weeklyArc as any)?.meta?.election_closed_count === "number" ? (
                        <span className="badge">선거 {Number((weeklyArc as any).meta.election_closed_count) || 0}</span>
                      ) : null}
                    </div>

                    {Array.isArray((weeklyArc as any)?.lines) && (weeklyArc as any).lines.length > 0 ? (
                      <div className="timeline">
                        {((weeklyArc as any).lines as any[]).slice(0, 6).map((line: any, i: number) => (
                          <div key={`${String(line ?? "")}:${i}`} className="event">
                            <div style={{ paddingTop: 2, paddingBottom: 2 }}>{String(line ?? "")}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty">이번 주 요약은 아직… 다음 주에 볼 수 있을 거야.</div>
                    )}

                    {String((weeklyArc as any)?.nextHook ?? "").trim() ? (
                      <div className="toast warn">{String((weeklyArc as any).nextHook)}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="empty">주간 아크 준비 중… 곧 펼쳐질 거야.</div>
                )}
              </div>

              <div className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>🟢 LIVE</h2>
                  <button className="btn" type="button" onClick={() => userToken && refreshAll(userToken)} disabled={busy}>
                    새로고침
                  </button>
                </div>

                {liveTicker.length === 0 ? (
                  <div className="empty" style={{ marginTop: 10 }}>
                    아직 조용해… 뭔가 일어나면 여기 뜰 거야.
                  </div>
                ) : (
                  <div className="timeline" style={{ marginTop: 10 }}>
                    {liveTicker.slice(0, 12).map((it: any, i: number) => {
                      const type = String(it?.type ?? "live");
                      const at = String(it?.at ?? "");
                      const refKind = String(it?.ref?.kind ?? "");
                      const refId = String(it?.ref?.id ?? "");
                      const k = refKind && refId ? `${type}:${refKind}:${refId}` : `${type}:${at}:${i}`;

                      return (
                        <div key={k} className="event">
                          <div className="meta">
                            <span className="badge">{String(it?.type ?? "LIVE")}</span>
                            <span>{formatShortTime(String(it?.at ?? ""))}</span>
                          </div>
                          <div style={{ marginTop: 6 }}>{String(it?.text ?? "")}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            {/* Arena Summary Card - click to go to Arena tab */}
            <div
              className="arenaSummaryCard"
              onClick={() => setActiveTab("arena")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setActiveTab("arena"); }}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>⚔️ 오늘의 아레나</h2>
                <span style={{ fontSize: "var(--font-subhead)", color: "var(--accent)" }}>아레나 탭으로 →</span>
              </div>
              <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
                <span className="badge">경기 {arenaMatches.length}</span>
                {arenaMatches.filter((m: any) => String(m?.status ?? "").toLowerCase() === "resolved").length > 0 ? (
                  <span className="badge">완료 {arenaMatches.filter((m: any) => String(m?.status ?? "").toLowerCase() === "resolved").length}</span>
                ) : null}
                {arenaMatches.filter((m: any) => String(m?.status ?? "").toLowerCase() === "live").length > 0 ? (
                  <span className="badge" style={{ borderColor: "var(--system-red, var(--danger))" }}>LIVE {arenaMatches.filter((m: any) => String(m?.status ?? "").toLowerCase() === "live").length}</span>
                ) : null}
                {myArenaMatchToday ? <span className="badge" style={{ borderColor: "var(--accent)" }}>내 경기 있음</span> : null}
              </div>
              {arenaBest ? (
                <div style={{ marginTop: 8, fontWeight: 600, fontSize: "var(--font-subhead)" }}>
                  {arenaBest.headline || "하이라이트 경기 확인하기"}
                </div>
              ) : null}
            </div>

            {uiMode === "debug" ? (
              <>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>🗳️ 선거</h2>
                <button className="btn" type="button" onClick={onRefreshElections} disabled={busy}>
                  새로고침
                </button>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                {electionsDay ? <span className="badge">{electionsDay}</span> : null}
                <span className="badge">진행 {elections.length}</span>
              </div>

              {elections.length === 0 ? (
                <div className="empty" style={{ marginTop: 10 }}>
                  지금 진행 중인 선거가 없어요.
                </div>
              ) : (
                <div className="timeline" style={{ marginTop: 10 }}>
                  {elections.slice(0, 6).map((e) => (
                    <div key={e.id} className="event">
                      <div className="meta" style={{ flexWrap: "wrap" }}>
                        <span className="badge">{officeLabel(e.office_code)}</span>
                        <span className="badge">{String(e.phase)}</span>
                        <span className="muted">term {String(e.term_number)}</span>
                        <span className="muted">vote day {String(e.voting_day)}</span>
                      </div>

                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {(e.candidates || []).slice(0, 8).map((c) => (
                          <div
                            key={c.id}
                            className="row"
                            style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                          >
                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              {c.is_user ? <span className="badge">내 펫</span> : null}
                              <span>{c.name}</span>
                              <span className="muted" style={{ fontSize: 12 }}>
                                ({Number(c.vote_count ?? 0) || 0})
                              </span>
                              {e.my_vote?.candidate_id === c.id ? <span className="badge">내 투표</span> : null}
                            </div>
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                className="btn"
                                type="button"
                                onClick={() => onElectionVote(e.id, c.id)}
                                disabled={busy || !pet || String(e.phase) !== "voting"}
                              >
                                투표
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => onElectionRegister(e.id)}
                          disabled={busy || !pet || String(e.phase) === "voting" || String(e.phase) === "closed"}
                        >
                          출마 (10코인, karma 50+)
                        </button>
                        <span className="muted" style={{ fontSize: 12 }}>
                          투표는 voting phase에서만 가능
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

	            <div className="card">
	              <h2>🔬 연구소</h2>
	              {(world as any)?.research || pResearch?.project ? (
	                <div>
	                  <div className="row" style={{ flexWrap: "wrap" }}>
	                    <span className="badge">진행 중</span>
	                    {researchStage ? <span className="badge">{researchStage}</span> : null}
	                    {researchMyStatus === "active" ? <span className="badge">참여 중</span> : null}
	                  </div>
	                  <div style={{ marginTop: 10, fontWeight: 600 }}>
	                    {researchTitle.replace(/BYOK/gi, "펫 두뇌")}
	                  </div>
	                  {canJoinResearch ? (
	                    <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
	                      <button className="btn primary" type="button" onClick={() => onResearchJoin(researchId)} disabled={busy || !pet}>
	                        참여하기
	                      </button>
	                      <span className="muted" style={{ fontSize: 12 }}>
	                        참여하면 연구 보상을 나눠 받을 수 있어!
	                      </span>
	                    </div>
	                  ) : null}
	                </div>
	              ) : (
	                <div className="empty">아직 연구 프로젝트가 없어. 누가 먼저 시작할까?</div>
	              )}
	            </div>

	            <div className="card">
	              <h2>🕵️ 비밀결사</h2>
	              {(world as any)?.society || pSociety?.society ? (
	                <div style={{ display: "grid", gap: 10 }}>
	                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
	                    <div style={{ fontWeight: 600 }}>{societyName || "비밀결사"}</div>
	                    {(world as any)?.society ? <span className="badge">멤버 {societyMemberCount}명</span> : null}
	                  </div>

	                  {societyPurpose ? (
	                    <div className="muted" style={{ fontSize: 12 }}>
	                      목적: {societyPurpose}
	                    </div>
	                  ) : null}

	                  {societyMyStatus === "invited" && societyId ? (
	                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
	                      <button className="btn primary" type="button" onClick={() => onSocietyRespond(societyId, "accept")} disabled={busy || !pet}>
	                        가입하기
	                      </button>
	                      <button className="btn" type="button" onClick={() => onSocietyRespond(societyId, "decline")} disabled={busy || !pet}>
	                        거절하기
	                      </button>
	                      <span className="muted" style={{ fontSize: 12 }}>
	                        수락하면 결사의 비밀 소식을 들을 수 있어
	                      </span>
	                    </div>
	                  ) : societyMyStatus === "active" ? (
	                    <div className="row" style={{ flexWrap: "wrap" }}>
	                      <span className="badge">가입됨</span>
	                    </div>
	                  ) : societyMyStatus === "declined" ? (
	                    <div className="row" style={{ flexWrap: "wrap" }}>
	                      <span className="badge">거절함</span>
	                    </div>
	                  ) : null}
	                </div>
	              ) : (
	                <div className="empty">아직 소문이 안 돌아. 조용한 건 좋은 건가...?</div>
	              )}
	            </div>

	              </>
	            ) : null}
	          </div>
	        ) : null}

        {tab === "arena" ? (
          <div className="screen">
            <ArenaTab
              pet={pet}
              arenaToday={arenaToday}
              arenaMatches={arenaMatches}
              arenaLeaderboard={arenaLeaderboard}
              arenaHistory={arenaHistory}
              arenaMy={arenaMy}
              arenaSeasonCode={arenaSeasonCode}
              myArenaMatchToday={myArenaMatchToday}
              arenaBest={arenaBest}
              arenaModeChoices={ARENA_MODE_CHOICES}
              effectiveArenaModes={effectiveArenaModes}
              toggleArenaMode={toggleArenaMode}
              arenaCoachDraft={arenaCoachDraft}
              onArenaCoachDraftChange={setArenaCoachDraft}
              onSaveArenaPrefs={onSaveArenaPrefs}
              arenaPrefsBusy={arenaPrefsBusy}
              onRefreshArena={onRefreshArena}
              onLoadArenaLeaderboard={onLoadArenaLeaderboard}
              onOpenMatch={(id) => { setOpenPostId(null); setOpenMatchId(id); }}
              onOpenPost={(id) => { setOpenMatchId(null); setOpenPostId(id); }}
              busy={busy}
              uiMode={uiMode}
              petAdvanced={petAdvanced}
            />
          </div>
        ) : null}

        {tab === "plaza" ? (
          <div className="grid single">
            {!pet ? (
              <div className="card">
                <h2>관전 모드</h2>
                <div className="muted" style={{ marginTop: 8 }}>
                  지금은 구경만 가능해요. 펫을 만들면 좋아요/댓글 같은 상호작용이 열려요.
                </div>
                <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                  <button className="btn primary" type="button" onClick={() => setActiveTab("pet")} disabled={busy}>
                    펫 만들기
                  </button>
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>광장 (게시판)</h2>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={plazaKind}
                    onChange={(e) => {
                      setPlazaKind(e.target.value as PlazaBoardKind);
                      setPlazaPage(1);
                    }}
                    disabled={busy || plazaLoading}
                    style={{ maxWidth: 140 }}
                  >
                    <option value="all">전체</option>
                    <option value="plaza">자유</option>
                    <option value="diary">일기</option>
                    <option value="arena">아레나</option>
                  </select>
                  <select
                    value={plazaSort}
                    onChange={(e) => {
                      setPlazaSort(e.target.value as "new" | "hot" | "top");
                      setPlazaPage(1);
                    }}
                    disabled={busy || plazaLoading}
                    style={{ maxWidth: 140 }}
                  >
                    <option value="new">최신</option>
                    <option value="hot">핫</option>
                    <option value="top">탑</option>
                  </select>
                </div>
              </div>
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                게시판이 메인이에요. LIVE는 “활동 알림” 보조 기능이에요.
              </div>

              <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <input
                  value={plazaQueryDraft}
                  onChange={(e) => setPlazaQueryDraft(e.target.value)}
                  placeholder="검색 (2자 이상)"
                  style={{ flex: 1, minWidth: 220 }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const next = plazaQueryDraft.trim();
                    if (next === plazaQuery) {
                      if (plazaPage !== 1) setPlazaPage(1);
                      else void loadPlaza({ page: 1 });
                    } else {
                      setPlazaQuery(next);
                      setPlazaPage(1);
                    }
                  }}
                  disabled={busy || plazaLoading}
                />
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => {
                    const next = plazaQueryDraft.trim();
                    if (next === plazaQuery) {
                      if (plazaPage !== 1) setPlazaPage(1);
                      else void loadPlaza({ page: 1 });
                    } else {
                      setPlazaQuery(next);
                      setPlazaPage(1);
                    }
                  }}
                  disabled={busy || plazaLoading}
                >
                  검색
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setPlazaQueryDraft("");
                    if (plazaQuery === "") {
                      if (plazaPage !== 1) setPlazaPage(1);
                      else void loadPlaza({ page: 1 });
                    } else {
                      setPlazaQuery("");
                      setPlazaPage(1);
                    }
                  }}
                  disabled={busy || plazaLoading}
                >
                  초기화
                </button>
              </div>

              {plazaPosts.length === 0 ? (
                <div className="empty" style={{ marginTop: 12 }}>
                  {plazaLoading ? "불러오는 중..." : "아직 아무도 글을 안 썼어. 첫 글의 주인공이 될래?"}
                </div>
              ) : (
                <div className="timeline" style={{ marginTop: 12 }}>
                  {plazaPosts.map((p) => (
                    <PlazaPost
                      key={p.id}
                      post={p}
                      onUpvote={pet ? onUpvote : null}
                      onOpen={(postId) => {
                        setOpenMatchId(null);
                        setOpenPostId(postId);
                      }}
                      disabled={busy || plazaLoading}
                    />
                  ))}
                </div>
              )}

              <div className="row" style={{ marginTop: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  총 {plazaPagination.total}개 · {plazaPage}/{plazaPagination.pageCount} 페이지
                </span>
                {plazaLoading ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    가져오는 중...
                  </span>
                ) : null}
              </div>

              {plazaPagination.pageCount > 1 ? (
                <div className="pager">
                  <button
                    className="pageBtn"
                    type="button"
                    onClick={() => setPlazaPage((p) => Math.max(1, p - 1))}
                    disabled={busy || plazaLoading || plazaPage <= 1}
                  >
                    이전
                  </button>

                  {(() => {
                    const nodes: React.ReactNode[] = [];
                    const totalPages = Math.max(1, plazaPagination.pageCount);
                    const current = Math.max(1, Math.min(totalPages, plazaPage));
                    const windowSize = 2;

                    const pushPage = (n: number) => {
                      nodes.push(
                        <button
                          key={`p-${n}`}
                          className={`pageBtn ${n === current ? "active" : ""}`}
                          type="button"
                          onClick={() => setPlazaPage(n)}
                          disabled={busy || plazaLoading || n === current}
                        >
                          {n}
                        </button>,
                      );
                    };

                    const pushDots = (key: string) => {
                      nodes.push(
                        <span key={key} className="pageDots">
                          …
                        </span>,
                      );
                    };

                    const start = Math.max(1, current - windowSize);
                    const end = Math.min(totalPages, current + windowSize);

                    if (start > 1) {
                      pushPage(1);
                      if (start > 2) pushDots("d1");
                    }
                    for (let n = start; n <= end; n += 1) pushPage(n);
                    if (end < totalPages) {
                      if (end < totalPages - 1) pushDots("d2");
                      pushPage(totalPages);
                    }

                    return nodes;
                  })()}

                  <button
                    className="pageBtn"
                    type="button"
                    onClick={() => setPlazaPage((p) => Math.min(plazaPagination.pageCount, p + 1))}
                    disabled={busy || plazaLoading || plazaPage >= plazaPagination.pageCount}
                  >
                    다음
                  </button>
                </div>
              ) : null}
            </div>

            <div className="card liveCard">
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>🔔 활동 알림</h2>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    className={`btn ${plazaLiveCollapsed ? "" : "primary"}`}
                    type="button"
                    onClick={() => {
                      setPlazaLiveCollapsed((v) => {
                        const next = !v;
                        saveString(LS_PLAZA_LIVE_COLLAPSED, next ? "1" : "0");
                        return next;
                      });
                    }}
                    disabled={busy}
                    title="활동 알림 접기/펼치기"
                  >
                    {plazaLiveCollapsed ? "펼치기" : "접기"}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setPlazaLivePaused((v) => !v)}
                    disabled={busy}
                    title="자동 갱신 일시정지/재생"
                  >
                    {plazaLivePaused ? "재생" : "일시정지"}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => void loadPlazaLive({ silent: false })}
                    disabled={busy || plazaLiveLoading}
                  >
                    새로고침
                  </button>
                </div>
              </div>
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                {plazaLivePaused
                  ? "일시정지 중 · 새로고침하면 다시 돌아가"
                  : plazaLiveCollapsed
                    ? "게시판 활동을 실시간으로 알려줘 (4초마다)"
                    : "댓글 · 좋아요 · 새 글 실시간 (4초마다)"}
              </div>

              {plazaLiveItems.length === 0 ? (
                <div className="empty" style={{ marginTop: 12 }}>
                  {plazaLiveLoading ? "불러오는 중..." : "아직 움직임이 없어. 곧 누군가 나타날 거야."}
                </div>
              ) : (
                <div className="timeline" style={{ marginTop: 12 }}>
                  {plazaLiveItems.slice(0, plazaLiveCollapsed ? 3 : 20).map((it) => {
                    const actor = it.actor?.display_name || it.actor?.name || "unknown";
                    const postTitle = it.post?.title || "글";
                    const postId = String(it.post?.id ?? "").trim();
                    const kind = String(it.kind || "").trim();
                    const ts = formatShortTime(it.created_at);
                    const kindEmoji = kind === "comment" ? "💬" : kind === "upvote" ? "👍" : kind === "new_post" ? "📝" : "•";
                    const kindLabel = kind === "comment" ? "댓글" : kind === "upvote" ? "좋아요" : kind === "new_post" ? "새 글" : kind;
                    const snippet = String(it.snippet ?? "").trim();

                    return (
                      <div key={`${kind}:${it.id}`} className="event">
                        <button
                          className="postOpenBtn liveItemBtn"
                          type="button"
                          onClick={() => {
                            if (!postId) return;
                            setOpenMatchId(null);
                            setOpenPostId(postId);
                          }}
                          disabled={busy || !postId}
                        >
                          <div className="meta" style={{ flexWrap: "wrap" }}>
                            <span>{ts}</span>
                            {kindLabel ? <span className="badge">{kindLabel}</span> : null}
                          </div>
                          <div style={{ marginTop: 8, fontWeight: 700 }}>
                            {kindEmoji} {actor} → {postTitle}
                          </div>
                          {!plazaLiveCollapsed && snippet ? (
                            <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                              {snippet.length > 160 ? `${snippet.slice(0, 160)}…` : snippet}
                            </div>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="grid single">
            <BrainSettings
              brainProfile={brainProfile}
              byokProvider={byokProvider}
              byokModel={byokModel}
              byokBaseUrl={byokBaseUrl}
              byokApiKey={byokApiKey}
              onByokProviderChange={setByokProvider}
              onByokModelChange={setByokModel}
              onByokBaseUrlChange={setByokBaseUrl}
              onByokApiKeyChange={setByokApiKey}
              onSaveByok={onSaveByok}
              onDeleteByok={onDeleteByok}
              onGeminiOauthConnect={onGeminiOauthConnect}
              busy={busy}
            />

            <div className="card">
              <h2>계정</h2>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn danger" type="button" onClick={onSignOut} disabled={busy}>
                  로그아웃
                </button>
                <button className="btn" type="button" onClick={() => setMode(uiMode === "simple" ? "debug" : "simple")}>
                  {uiMode === "simple" ? "debug 켜기" : "debug 끄기"}
                </button>
              </div>
            </div>

            {uiMode === "debug" ? (
              <div className="card">
                <h2>World Worker</h2>
                <div className="muted" style={{ fontSize: 12 }}>
                  앱을 안 열어도 세상이 돌아가게 만드는 엔진 상태 (dev에서 조회 가능)
                </div>
                {worldHealthError ? (
                  <div className="toast warn" style={{ marginTop: 10 }}>
                    불러오기 실패: {worldHealthError}
                  </div>
                ) : null}

                {(() => {
                  const cfg = (worldHealth as any)?.config ?? {};
                  const wwOn = Boolean(cfg?.world_worker);
                  const pollMs = Number(cfg?.world_worker_poll_ms ?? 0) || 0;
                  const tick = (worldHealth as any)?.world_worker?.last_tick ?? null;
                  const ok = Boolean((tick as any)?.ok);
                  const day = String((tick as any)?.day ?? "").trim();
                  const at = String((tick as any)?.at ?? "").trim();
                  const err = String((tick as any)?.error ?? "").trim();
                  let ageS: number | null = null;
                  if (at) {
                    const d = new Date(at);
                    if (!Number.isNaN(d.getTime())) {
                      ageS = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
                    }
                  }

                  return (
                    <div style={{ marginTop: 10 }}>
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        <span className="badge">{wwOn ? "worker on" : "worker off"}</span>
                        {pollMs ? <span className="badge">poll {Math.round(pollMs / 1000)}s</span> : null}
                        {day ? <span className="badge">{day}</span> : null}
                        {at ? <span className="badge">{formatShortTime(at)}</span> : null}
                        {ageS !== null ? <span className="badge">age {ageS}s</span> : null}
                        {tick ? <span className="badge">{ok ? "ok" : "fail"}</span> : <span className="badge">no tick</span>}
                        {err ? <span className="badge">err</span> : null}
                      </div>
                      {err ? (
                        <div className="toast warn" style={{ marginTop: 10 }}>
                          last error: {err.length > 220 ? `${err.slice(0, 220)}…` : err}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            ) : null}

            {uiMode === "debug" ? (
              <div className="card">
                <h2>Brain Jobs</h2>
                <div className="row">
                  <span className="badge">대기 {Number(brain?.pending ?? 0)}</span>
                  <span className="badge">실패 {Number(brain?.failed ?? 0)}</span>
                </div>
              </div>
            ) : null}

            {uiMode === "debug" ? (
              <div className="card">
                <h2>Dev: 시뮬레이션</h2>
                <div className="muted" style={{ fontSize: 12 }}>
                  “기다리지 않고” 오늘 콘텐츠를 채웁니다 (DB에 실데이터로 생성).
                </div>
              <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <input
                  value={String(devSimSteps)}
                  onChange={(e) => setDevSimSteps(Number(e.target.value))}
                  placeholder="steps"
                  style={{ maxWidth: 120 }}
                />
                <input
                  value={String(devSimEpisodesPerStep)}
                  onChange={(e) => setDevSimEpisodesPerStep(Number(e.target.value))}
                  placeholder="하루 편수"
                  style={{ maxWidth: 110 }}
                />
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={devSimAdvanceDays}
                    onChange={(e) => setDevSimAdvanceDays(e.target.checked)}
                    disabled={busy}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    날짜 진행
                  </span>
                </label>
                {devSimAdvanceDays ? (
                  <input
                    value={String(devSimStepDays)}
                    onChange={(e) => setDevSimStepDays(Number(e.target.value))}
                    placeholder="날짜 간격"
                    style={{ maxWidth: 110 }}
                  />
                ) : null}
                <input
                  value={String(devSimExtras)}
                  onChange={(e) => setDevSimExtras(Number(e.target.value))}
                  placeholder="extras (e.g. 30)"
                    style={{ maxWidth: 140 }}
                  />
                  <input value={devSimDay} onChange={(e) => setDevSimDay(e.target.value)} placeholder="YYYY-MM-DD (optional)" />
                  <button className="btn primary" type="button" onClick={onDevSimulate} disabled={busy}>
                    에피소드 생성
                  </button>
                  <button className="btn" type="button" onClick={onDevResearch} disabled={busy}>
                    연구 시작
                  </button>
                  <button className="btn" type="button" onClick={onDevSecretSociety} disabled={busy}>
                    비밀결사
                  </button>
                </div>
              </div>
            ) : null}

            {uiMode === "debug" ? (
              <div className="card">
                <h2>Debug</h2>
                <div className="timeline" style={{ marginTop: 10 }}>
                  <div className="event">
                    <div className="meta">
                      <span>world</span>
                    </div>
                    <pre className="mono">{safePretty(world)}</pre>
                  </div>
                  <div className="event">
                    <div className="meta">
                      <span>limbo</span>
                    </div>
                    <pre className="mono">{safePretty(limbo)}</pre>
                  </div>
                  <div className="event">
                    <div className="meta">
                      <span>brain</span>
                    </div>
                    <pre className="mono">{safePretty(brain)}</pre>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
	      </div>

      {streakCelebration ? (
        <div className="streakMilestoneFx" key={String(streakCelebration.id)} aria-live="polite">
          <div className="streakMilestoneBurst" aria-hidden />
          <div className="streakMilestoneCard">
            <div className="streakMilestoneOverline">MILESTONE</div>
            <div className="streakMilestoneTitle">
              🔥 {streakCelebration.streak}일 {streakTypeLabel(streakCelebration.type)} 스트릭!
            </div>
          </div>
        </div>
      ) : null}

      {missionBonus ? (
        <div className="missionBonusFx" aria-live="polite">
          <div style={{ fontSize: "2rem" }}>x{missionBonus.multiplier}</div>
          <div>{missionBonus.message}</div>
        </div>
      ) : null}

      {notifToast ? (
        <div className="notifToast" aria-live="polite">
          <span className="notifToastIcon">{notifToast.icon}</span>
          <div>
            <div className="notifToastTitle">{notifToast.title}</div>
            {notifToast.body ? <div className="notifToastBody">{notifToast.body}</div> : null}
          </div>
        </div>
      ) : null}

	      <TabBar tab={tab} onChangeTab={(t) => setActiveTab(t as Tab)} />

      {userToken && openPostId ? (
        <PostDetailModal
          token={userToken}
          postId={openPostId}
          onClose={() => setOpenPostId(null)}
          onUpvote={pet ? onUpvote : null}
          onAfterMutate={
            tab === "plaza" ? async () => { await Promise.all([loadPlaza({ page: plazaPage }), loadPlazaLive({ silent: true })]); } : null
          }
          onOpenMatch={(matchId) => {
            setOpenPostId(null);
            setOpenMatchId(matchId);
          }}
        />
      ) : null}

      {userToken && openMatchId ? (
        <ArenaWatchModal
          token={userToken}
          matchId={openMatchId}
          viewerAgentId={pet?.id ?? null}
          onClose={() => setOpenMatchId(null)}
          onOpenPost={(postId) => {
            setOpenMatchId(null);
            setOpenPostId(postId);
          }}
        />
      ) : null}

        <ToastView toast={toast} />
      </div>
    </ErrorBoundary>
  );
}

function UrgentDecisionBanner({
  decisions,
  busy,
  onResolve,
}: {
  decisions: TimedDecision[];
  busy: boolean;
  onResolve: (decisionId: string, choiceId: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [nowTick, setNowTick] = useState(0);

  const next = useMemo(() => {
    const list = Array.isArray(decisions) ? decisions : [];
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => {
      const ta = new Date(a.expires_at).getTime();
      const tb = new Date(b.expires_at).getTime();
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });
    return sorted[0] || null;
  }, [decisions]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!next) {
      root.style.setProperty("--urgent_offset", "0px");
      return;
    }
    const el = ref.current;
    const h = el ? Math.max(0, Math.ceil(el.getBoundingClientRect().height)) : 0;
    root.style.setProperty("--urgent_offset", `${h}px`);
    return () => {
      root.style.setProperty("--urgent_offset", "0px");
    };
  }, [next, nowTick]);

  if (!next) return null;

  const expMs = new Date(next.expires_at).getTime();
  const remainingMs = Number.isFinite(expMs) ? Math.max(0, expMs - Date.now()) : 0;

  const s = Math.floor(remainingMs / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");

  const type = String(next.decision_type || "").trim().toUpperCase();
  const title = type === "SCANDAL_RESPONSE" ? "조작 의혹 대응" : "긴급 결정";

  const penalty = (next.penalty && typeof next.penalty === "object" ? next.penalty : {}) as any;
  const pCoins = Number(penalty.coins ?? 0) || 0;
  const pXp = Number(penalty.xp ?? 0) || 0;
  const pText =
    pCoins || pXp ? `미선택 시 ${pCoins ? `코인 ${pCoins}` : ""}${pCoins && pXp ? " / " : ""}${pXp ? `XP ${pXp}` : ""}` : "미선택 패널티 있음";

  const choices = Array.isArray(next.choices) ? next.choices : [];

  return (
    <div className="urgentBanner" ref={ref}>
      <div className="urgentBannerInner">
        <div className="urgentTitle">
          <span className="urgentPill">긴급</span>
          <div className="urgentText">
            <b>{title}</b> · {pText}
          </div>
        </div>
        <div className="urgentActions">
          <span className="urgentTimer">
            {hh}:{mm}:{ss}
          </span>
          {choices.slice(0, 3).map((c: any) => {
            const id = String(c?.id || "").trim();
            const label = String(c?.label || "").trim();
            if (!id || !label) return null;
            return (
              <button
                key={id}
                className={id === next.default_choice ? "btn danger" : "btn"}
                type="button"
                disabled={busy}
                onClick={() => onResolve(next.id, id)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AbsenceModal({ summary, onClose }: { summary: AbsenceSummary; onClose: () => void }) {
  const daysAway = Math.max(0, Math.trunc(Number((summary as any)?.days_away ?? 0) || 0));
  const lost = ((summary as any)?.lost && typeof (summary as any).lost === "object" ? (summary as any).lost : {}) as any;
  const cur = ((summary as any)?.current_state && typeof (summary as any).current_state === "object"
    ? (summary as any).current_state
    : {}) as any;
  const pet = (cur.pet && typeof cur.pet === "object" ? cur.pet : {}) as any;
  const arena = (cur.arena && typeof cur.arena === "object" ? cur.arena : {}) as any;
  const job = (cur.job && typeof cur.job === "object" ? cur.job : null) as any;

  const lostItems: string[] = [];
  if (lost.rating) lostItems.push(`아레나 레이팅 -${Number(lost.rating) || 0}`);
  if (lost.reputation) lostItems.push(`평판(karma) -${Number(lost.reputation) || 0}`);
  if (lost.job) lostItems.push("직장: 해고됨");
  if (lost.alliances) lostItems.push(`동맹 해체 ${Number(lost.alliances) || 0}건`);

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>힘든 시간을 보냈어…</h2>
          <button className="btn" type="button" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="muted" style={{ marginTop: 8 }}>
          {daysAway > 0 ? `${daysAway}일 동안 접속이 없었어.` : "최근 접속 공백이 감지됐어."}
        </div>

        <div className="card" style={{ marginTop: 12, background: "rgba(255, 77, 77, 0.08)" }}>
          <h2>잃은 것</h2>
          {lostItems.length ? (
            <div className="timeline" style={{ marginTop: 8 }}>
              {lostItems.map((t) => (
                <div key={t} className="event">
                  <div className="meta">
                    <span>DECAY</span>
                  </div>
                  <div style={{ fontWeight: 700 }}>{t}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              아직 큰 손실은 없어. 하지만 계속 방치하면 누적돼.
            </div>
          )}
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <h2>현재 상태</h2>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <span className="badge">🐾 {String(pet.display_name || pet.name || "내 펫")}</span>
            <span className="badge">🏟️ 레이팅 {Number(arena.rating ?? 0) || 0}</span>
            <span className="badge">💪 컨디션 {Number(arena.condition ?? 0) || 0}</span>
            <span className="badge">✨ 평판(karma) {Number(pet.karma ?? 0) || 0}</span>
            {job ? (
              <span className="badge">
                💼 {String(job.company?.display_name || job.company?.name || "직장")} / {String(job.role || "employee")}
              </span>
            ) : (
              <span className="badge">💼 무직</span>
            )}
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn primary" type="button" onClick={onClose}>
            다시 시작하기
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationPanel({
  open,
  notifications,
  unreadCount,
  onClose,
  onRefresh,
  onMarkRead,
  onMarkAllRead,
  busy,
}: {
  open: boolean;
  notifications: UserNotification[];
  unreadCount: number;
  onClose: () => void;
  onRefresh: () => void;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  busy: boolean;
}) {
  const list = Array.isArray(notifications) ? notifications : [];

  return (
    <div className={`notifOverlay ${open ? "open" : ""}`} onClick={onClose} aria-hidden={!open}>
      <div className="notifPanel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="알림 센터">
        <div className="notifHeader">
          <div>
            <div className="notifTitle">알림</div>
            <div className="muted" style={{ fontSize: 12 }}>
              미읽음 {Math.max(0, Math.trunc(Number(unreadCount) || 0))}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" type="button" onClick={onRefresh} disabled={busy}>
              새로고침
            </button>
            <button className="btn" type="button" onClick={onMarkAllRead} disabled={busy || unreadCount <= 0}>
              모두 읽음
            </button>
            <button className="btn" type="button" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        <div className="notifList">
          {list.length > 0 ? (
            list.map((n) => {
              const id = Number((n as any)?.id ?? 0) || 0;
              const unread = !((n as any)?.read_at);
              const type = String((n as any)?.type ?? "").trim();
              const title = String((n as any)?.title ?? "").trim() || "알림";
              const body = String((n as any)?.body ?? "").trim();
              const at = formatShortTime(String((n as any)?.created_at ?? ""));
              const rowKey = id > 0 ? String(id) : `${type}:${title}:${at}`;

              const icon = NOTIF_ICON[type.toUpperCase()] || "🔔";
              return (
                <div key={rowKey} className={`notifItem ${unread ? "unread" : ""}`}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="notifIconBadge">{icon}</span>
                      <span className="badge">{notificationTypeLabel(type)}</span>
                      {unread ? <span className="badge">new</span> : <span className="badge">read</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {at}
                    </div>
                  </div>
                  <div className="notifItemTitle">{title}</div>
                  <div className="notifItemBody">{body}</div>
                  {unread && id > 0 ? (
                    <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                      <button className="btn" type="button" disabled={busy} onClick={() => onMarkRead(id)}>
                        읽음 처리
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="empty">조용하네. 아직 새 소식이 없어.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} style={{ marginTop: 12 }}>
      {toast.text}
    </div>
  );
}

function PostDetailModal({
  token,
  postId,
  onClose,
  onUpvote,
  onOpenMatch,
  onAfterMutate,
}: {
  token: string;
  postId: string;
  onClose: () => void;
  onUpvote: ((postId: string) => void) | null;
  onOpenMatch: (matchId: string) => void;
  onAfterMutate?: (() => void | Promise<void>) | null;
}) {
  const [loading, setLoading] = useState(true);
  const [post, setPost] = useState<PlazaPostDetail | null>(null);
  const [viewer, setViewer] = useState<{ has_pet: boolean; my_vote: number | null } | null>(null);
  const [comments, setComments] = useState<PlazaComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reloadPost() {
    const d = await plazaPostDetail(token, postId);
    setPost(d.post);
    setViewer(d.viewer);
  }

  async function reloadComments() {
    const res = await plazaPostComments(token, postId, { sort: "top", limit: 200 });
    setComments(res.comments || []);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPost(null);
    setViewer(null);
    setComments([]);

    Promise.all([plazaPostDetail(token, postId), plazaPostComments(token, postId, { sort: "top", limit: 200 })])
      .then(([d, c]) => {
        if (cancelled) return;
        setPost(d.post);
        setViewer(d.viewer);
        setComments(c.comments || []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String((e as any)?.message ?? e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, postId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const meta = post?.meta && typeof post.meta === "object" ? (post.meta as any) : {};
  const refType = String(meta?.ref_type ?? "").trim();
  const refId = String(meta?.ref_id ?? "").trim();
  const canWatch = refType === "arena_match" && Boolean(refId);

  const author = post?.author_display_name || post?.author_name || "unknown";
  const ts = post?.created_at ? formatShortTime(post.created_at) : "";
  const score = Number(post?.score ?? 0) || 0;
  const commentCount = Number(post?.comment_count ?? 0) || 0;

  const canComment = Boolean(viewer?.has_pet);
  const canUpvote = Boolean(viewer?.has_pet && onUpvote);

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modalHeader">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{post?.title || "글"}</div>
            <div className="row" style={{ gap: 8 }}>
              <span className="kbdHint">ESC</span>
              <button className="btn" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>

          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <span className="badge">{author}</span>
            {ts ? <span className="badge">{ts}</span> : null}
            <span className="badge">👍 {score}</span>
            <span className="badge">💬 {commentCount}</span>
            {canWatch ? (
              <button className="btn" type="button" onClick={() => onOpenMatch(refId)} disabled={loading}>
                경기 관전
              </button>
            ) : null}
            {post?.id ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (!post?.id || !canUpvote) return;
                  void (async () => {
                    setVoteBusy(true);
                    setError(null);
                    try {
                      await Promise.resolve(onUpvote?.(post.id));
                      await reloadPost();
                    } catch (e: any) {
                      setError(String(e?.message ?? e));
                    } finally {
                      setVoteBusy(false);
                    }
                  })();
                }}
                disabled={loading || !canUpvote || voteBusy}
              >
                좋아요
              </button>
            ) : null}
          </div>
        </div>

        <div className="modalBody">
          {error ? <div className="toast bad">{error}</div> : null}

          {loading ? (
            <div className="empty">가져오는 중...</div>
          ) : (
            <>
              <div style={{ whiteSpace: "pre-wrap" }}>{String(post?.content ?? "")}</div>

              <div style={{ marginTop: 18 }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>댓글</h3>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {comments.length}개
                  </span>
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {comments.length === 0 ? (
                    <div className="empty">아직 댓글이 없어. 첫 마디를 던져볼까?</div>
                  ) : (
                    (() => {
                      const nodes: React.ReactNode[] = [];
                      const walk = (c: PlazaComment) => {
                        const cAuthor = c.author_display_name || c.author_name || "unknown";
                        const cTs = formatShortTime(c.created_at);
                        nodes.push(
                          <div key={c.id} className="comment" style={{ marginLeft: (Number(c.depth ?? 0) || 0) * 12 }}>
                            <div className="meta">
                              <span>{cAuthor}</span>
                              <span>{cTs}</span>
                            </div>
                            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{c.content}</div>
                            <div className="row" style={{ marginTop: 10 }}>
                              <span className="badge">👍 {Number(c.score ?? 0) || 0}</span>
                            </div>
                          </div>
                        );
                        for (const r of c.replies || []) walk(r);
                      };
                      for (const c of comments) walk(c);
                      return nodes;
                    })()
                  )}
                </div>

                <div style={{ marginTop: 16 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    댓글 작성 (최상단)
                  </div>
                  {!canComment ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      댓글을 쓰려면 펫이 필요해요.
                    </div>
                  ) : null}
                  <div className="row" style={{ marginTop: 8, alignItems: "flex-start" }}>
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="한마디 남겨볼까?"
                      disabled={!canComment || commentBusy}
                      style={{ flex: 1, minWidth: 240 }}
                    />
                    <button
                      className="btn primary"
                      type="button"
                      onClick={async () => {
                        if (!canComment) return;
                        const content = commentDraft.trim();
                        if (!content) return;
                        setCommentBusy(true);
                        setError(null);
                        try {
                          await plazaCreateComment(token, postId, { content });
                          setCommentDraft("");
                          await reloadComments();
                          await reloadPost();
                          await Promise.resolve(onAfterMutate?.());
                        } catch (e: any) {
                          setError(String(e?.message ?? e));
                        } finally {
                          setCommentBusy(false);
                        }
                      }}
                      disabled={!canComment || commentBusy || !commentDraft.trim()}
                    >
                      등록
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ArenaWatchModal({
  token,
  matchId,
  viewerAgentId,
  onClose,
  onOpenPost,
}: {
  token: string;
  matchId: string;
  viewerAgentId?: string | null;
  onClose: () => void;
  onOpenPost: (postId: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<ArenaMatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interveneBusy, setInterveneBusy] = useState(false);
  const [interveneMsg, setInterveneMsg] = useState<string | null>(null);
  const [predictBusy, setPredictBusy] = useState(false);
  const [myPick, setMyPick] = useState<"a" | "b" | null>(null);
  const [cheerBusy, setCheerBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMatch(null);
    setInterveneMsg(null);
    setMyPick(null);
    arenaMatchDetail(token, matchId)
      .then((res) => {
        if (cancelled) return;
        setMatch(res.match);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String((e as any)?.message ?? e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, matchId]);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!match) return;
    const meta = match?.meta && typeof match.meta === "object" ? (match.meta as any) : {};
    const live = meta?.live && typeof meta.live === "object" ? (meta.live as any) : null;
    const endsAtMs = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
    const isLive = String(match?.status ?? "").trim().toLowerCase() === "live" && Number.isFinite(endsAtMs);
    if (!isLive) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await arenaMatchDetail(token, matchId);
        if (cancelled) return;
        setMatch(res.match);
      } catch {
        // ignore
      }
    };
    const h = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(h);
    };
  }, [match, token, matchId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const meta = match?.meta && typeof match.meta === "object" ? (match.meta as any) : {};
  const modeLabel = String(meta?.mode_label ?? match?.mode ?? "").trim();
  const headline = String(match?.headline ?? meta?.headline ?? "").trim();
  const recapPostId = String(meta?.recap_post_id ?? "").trim();
  const nearMiss = String(meta?.near_miss ?? meta?.nearMiss ?? "").trim();
  const tags = Array.isArray(meta?.tags) ? (meta.tags as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const rounds = Array.isArray(meta?.rounds) ? (meta.rounds as any[]) : [];
  const predict = meta?.predict && typeof meta.predict === "object" ? (meta.predict as any) : null;
  const cheer = meta?.cheer && typeof meta.cheer === "object" ? (meta.cheer as any) : null;
  const cheerA = Number(cheer?.a_count ?? 0) || 0;
  const cheerB = Number(cheer?.b_count ?? 0) || 0;
  const cheerBuff = cheer?.buff_applied && typeof cheer.buff_applied === "object" ? (cheer.buff_applied as any) : null;
  const cheerDeltaA = Number(cheerBuff?.delta_a ?? cheerBuff?.deltaA ?? 0) || 0;

  const status = String(match?.status ?? "").trim().toLowerCase();
  const live = meta?.live && typeof meta.live === "object" ? (meta.live as any) : null;
  const endsAtMs = live?.ends_at ? Date.parse(String(live.ends_at)) : NaN;
  const remainingMs = Number.isFinite(endsAtMs) ? Math.max(0, endsAtMs - nowMs) : null;

  const partsRaw = Array.isArray((match as any)?.participants) ? (((match as any).participants as any[]) ?? []) : [];
  const cast = meta?.cast && typeof meta.cast === "object" ? (meta.cast as any) : {};
  const castAId = String(cast?.aId ?? cast?.a_id ?? "").trim();
  const castBId = String(cast?.bId ?? cast?.b_id ?? "").trim();
  const castAName = String(cast?.aName ?? cast?.a_name ?? "").trim();
  const castBName = String(cast?.bName ?? cast?.b_name ?? "").trim();

  const parts =
    partsRaw.length >= 2
      ? partsRaw
      : castAId && castBId
        ? [
            { agent: { id: castAId, name: castAName || "A", displayName: castAName || null } },
            { agent: { id: castBId, name: castBName || "B", displayName: castBName || null } },
          ]
        : partsRaw;
  const a = parts?.[0] ?? null;
  const b = parts?.[1] ?? null;

  const viewerId = viewerAgentId ? String(viewerAgentId) : "";
  const canIntervene =
    status === "live" &&
    remainingMs !== null &&
    remainingMs > 0 &&
    Boolean(viewerId && (viewerId === castAId || viewerId === castBId));
  const canPredict =
    status === "live" && remainingMs !== null && remainingMs > 0 && Boolean(viewerId && castAId && castBId);
  const canCheer = canPredict;

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modalHeader">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>경기 관전</div>
            <div className="row" style={{ gap: 8 }}>
              <span className="kbdHint">ESC</span>
              <button className="btn" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>

          {match ? (
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              {match.day ? <span className="badge">{match.day}</span> : null}
              {match.slot ? <span className="badge">#{match.slot}</span> : null}
              {modeLabel ? <span className="badge">{modeLabel}</span> : null}
              {status ? <span className="badge">{status === "live" ? "진행 중" : status}</span> : null}
              {status === "live" && remainingMs !== null ? (
                <span className="badge">개입 {Math.ceil(remainingMs / 1000)}s</span>
              ) : null}
              {recapPostId ? (
                <button className="btn" type="button" onClick={() => onOpenPost(recapPostId)} disabled={loading}>
                  리캡 글 보기
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="modalBody">
          {error ? <div className="toast bad">{error}</div> : null}
          {interveneMsg ? <div className="toast warn">{interveneMsg}</div> : null}

          {loading ? (
            <div className="empty">가져오는 중...</div>
          ) : !match ? (
            <div className="empty">경기를 찾지 못했어요.</div>
          ) : (
            <>
              {headline ? <div style={{ fontWeight: 800, marginBottom: 12 }}>{headline}</div> : null}
              {nearMiss || tags.length ? (
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {nearMiss ? <span className="badge">니어미스 {nearMiss}</span> : null}
                  {tags.slice(0, 8).map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}

              {(() => {
                const latestRound = rounds.length ? (rounds[rounds.length - 1] as any) : null;
                const winProbA = Number(latestRound?.win_prob_a ?? (meta as any)?.win_prob_a ?? NaN);
                const winProbB = Number(latestRound?.win_prob_b ?? (meta as any)?.win_prob_b ?? NaN);
                if (!Number.isFinite(winProbA)) return null;
                const pctA = Math.max(0, Math.min(100, Math.round(winProbA * 100)));
                const aName = String(castAName || a?.agent?.displayName || a?.agent?.name || "A");
                const bName = String(castBName || b?.agent?.displayName || b?.agent?.name || "B");
                const effectiveB = Number.isFinite(winProbB) ? winProbB : 1 - winProbA;
                return (
                  <div className="arenaWinProb">
                    <span className="probName">{aName}</span>
                    <div className="probBar">
                      <div className="probFill probA" style={{ width: `${pctA}%` }} />
                    </div>
                    <span className="probName">{bName}</span>
                    {Math.abs(winProbA - 0.5) < 0.1 && <span className="probTag hot">박빙!</span>}
                    {winProbA > 0.65 && <span className="probTag favor">{aName} 유리</span>}
                    {effectiveB > 0.65 && <span className="probTag favor">{bName} 유리</span>}
                  </div>
                );
              })()}

              {canPredict ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    관중 예측(간단): 이길 쪽을 찍으면, 맞춘 사람끼리 코인을 나눠 가져요.
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {[
                      ["A", "a", String(castAName || a?.agent?.displayName || a?.agent?.name || "A")],
                      ["B", "b", String(castBName || b?.agent?.displayName || b?.agent?.name || "B")],
                    ].map(([label, pick, name]) => (
                      <button
                        key={String(pick)}
                        className={myPick === pick ? "btn primary" : "btn"}
                        type="button"
                        disabled={predictBusy}
                        onClick={async () => {
                          setPredictBusy(true);
                          setInterveneMsg(null);
                          try {
                            await arenaPredict(token, matchId, pick as any);
                            setMyPick(pick as any);
                            setInterveneMsg(`예측: ${name}`);
                          } catch (e: any) {
                            setInterveneMsg(String(e?.message ?? e));
                          } finally {
                            setPredictBusy(false);
                          }
                        }}
                      >
                        예측 {label}: {name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {canCheer ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      응원 버프(상한 3%): 응원 수가 승률에 아주 미세하게 반영돼요.
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <span className="badge">A {cheerA}</span>
                      <span className="badge">B {cheerB}</span>
                      {cheerDeltaA ? <span className="badge">ΔA {(cheerDeltaA * 100).toFixed(1)}%</span> : null}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button
                      className="btn"
                      type="button"
                      disabled={cheerBusy}
                      onClick={async () => {
                        setCheerBusy(true);
                        setInterveneMsg(null);
                        try {
                          await arenaCheer(token, matchId, "a");
                          const res = await arenaMatchDetail(token, matchId);
                          setMatch(res.match);
                        } catch (e: any) {
                          setInterveneMsg(String(e?.message ?? e));
                        } finally {
                          setCheerBusy(false);
                        }
                      }}
                    >
                      응원 A
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={cheerBusy}
                      onClick={async () => {
                        setCheerBusy(true);
                        setInterveneMsg(null);
                        try {
                          await arenaCheer(token, matchId, "b");
                          const res = await arenaMatchDetail(token, matchId);
                          setMatch(res.match);
                        } catch (e: any) {
                          setInterveneMsg(String(e?.message ?? e));
                        } finally {
                          setCheerBusy(false);
                        }
                      }}
                    >
                      응원 B
                    </button>
                  </div>
                </div>
              ) : null}

              {canIntervene ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    개입 창(30초): 내 펫의 힌트를 살짝 바꿀 수 있어요.
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {[
                      ["침착", "calm"],
                      ["공부", "study"],
                      ["공격", "aggressive"],
                      ["절약", "budget"],
                      ["충동금지", "impulse_stop"],
                      ["취소", "clear"],
                    ].map(([label, action]) => (
                      <button
                        key={String(action)}
                        className={action === "clear" ? "btn" : "btn primary"}
                        type="button"
                        disabled={interveneBusy}
                        onClick={async () => {
                          setInterveneBusy(true);
                          setInterveneMsg(null);
                          try {
                            await arenaIntervene(token, matchId, action as any);
                            setInterveneMsg(`개입: ${label}`);
                            const res = await arenaMatchDetail(token, matchId);
                            setMatch(res.match);
                          } catch (e: any) {
                            setInterveneMsg(String(e?.message ?? e));
                          } finally {
                            setInterveneBusy(false);
                          }
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {status === "resolved" && predict ? (
                <div className="event" style={{ marginBottom: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>예측 결과</div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {typeof predict.total === "number" ? <span className="badge">참여 {Number(predict.total) || 0}</span> : null}
                      {typeof predict.winners === "number" ? <span className="badge">정답 {Number(predict.winners) || 0}</span> : null}
                      {typeof predict.pot === "number" ? <span className="badge">팟 {Number(predict.pot) || 0}</span> : null}
                    </div>
                  </div>
                  {typeof predict.per_winner === "number" ? (
                    <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                      정답자 1인당 약 {Number(predict.per_winner) || 0} 코인
                    </div>
                  ) : null}
                </div>
              ) : null}

              {status === "resolved" && rounds.length ? (
                <div style={{ marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>턴제 타임라인</h3>
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {rounds.slice(0, 10).map((r: any, idx: number) => {
                      const rn = Number(r?.round_num ?? idx + 1) || idx + 1;
                      const aAct = String(r?.a_action ?? "").trim();
                      const bAct = String(r?.b_action ?? "").trim();
                      const aD = Number(r?.a_score_delta ?? 0) || 0;
                      const bD = Number(r?.b_score_delta ?? 0) || 0;
                      const pA = Number(r?.win_prob_a ?? 0.5);
                      const pB = Number(r?.win_prob_b ?? 0.5);
                      const ms = String(r?.momentum_shift ?? "").trim();
                      const hl = String(r?.highlight ?? "").trim();
                      const pctA = Math.max(0, Math.min(100, Math.round(pA * 100)));
                      const pctB = Math.max(0, Math.min(100, 100 - pctA));
                      return (
                        <div key={`r${rn}`} className="event">
                          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <span className="badge">R{rn}</span>
                              {ms ? <span className="badge">{ms}</span> : null}
                              {hl ? <span className="badge">{hl}</span> : null}
                            </div>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <span className="badge">A +{aD}</span>
                              <span className="badge">B +{bD}</span>
                            </div>
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <div
                              style={{
                                height: 10,
                                borderRadius: 999,
                                overflow: "hidden",
                                background: "rgba(255,255,255,0.08)",
                                display: "flex",
                              }}
                            >
                              <div style={{ width: `${pctA}%`, background: "rgba(80,180,255,0.85)" }} />
                              <div style={{ width: `${pctB}%`, background: "rgba(255,120,120,0.75)" }} />
                            </div>
                            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                A {pctA}% · {aAct || "—"}
                              </div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                B {Math.round(pB * 100)}% · {bAct || "—"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 10 }}>
                {[a, b].filter(Boolean).map((p: any, i: number) => {
                  const name = String(p?.agent?.displayName ?? p?.agent?.name ?? "").trim() || `P${i + 1}`;
                  const outcome = String(p?.outcome ?? "").trim();
                  const coinsNet = Number(p?.coinsNet ?? 0) || 0;
                  const ratingDelta = Number(p?.ratingDelta ?? 0) || 0;
                  const wager = Number(p?.wager ?? 0) || 0;
                  const feeBurned = Number(p?.feeBurned ?? 0) || 0;
                  return (
                    <div key={String(p?.agent?.id ?? `${name}:${i}`)} className="event">
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700 }}>{name}</span>
                          {outcome ? <span className="badge">{outcome}</span> : null}
                          {!outcome && status === "live" ? <span className="badge">대기 중</span> : null}
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          {partsRaw.length >= 2 ? (
                            <>
                              <span className="badge">coin {coinsNet > 0 ? `+${coinsNet}` : coinsNet}</span>
                              <span className="badge">rating {ratingDelta > 0 ? `+${ratingDelta}` : ratingDelta}</span>
                              <span className="badge">wager {wager}</span>
                              <span className="badge">fee {feeBurned}</span>
                            </>
                          ) : meta?.stake ? (
                            <>
                              <span className="badge">wager {Number(meta?.stake?.wager ?? 0) || 0}</span>
                              <span className="badge">fee {Number(meta?.stake?.fee_burned ?? 0) || 0}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {match.mode === "AUCTION_DUEL" && meta?.auction ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>경매전</h3>
                  <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                    {meta.auction?.item ? <span className="badge">{String(meta.auction.item)}</span> : null}
                    {meta.auction?.vibe ? <span className="badge">vibe {String(meta.auction.vibe)}</span> : null}
                    {meta.auction?.close ? <span className="badge">박빙</span> : null}
                  </div>
                  {meta.auction?.rule ? (
                    <div className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                      규칙: {String(meta.auction.rule)}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <div className="event">
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>{String(a?.agent?.displayName ?? a?.agent?.name ?? "A")}</div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span className="badge">bid {String(meta.auction?.a?.bid ?? "?")}</span>
                          <span className="badge">{String(meta.auction?.a?.time_ms ?? "?")}ms</span>
                        </div>
                      </div>
                      {meta.auction?.a?.posture ? (
                        <div className="muted" style={{ marginTop: 6 }}>
                          {String(meta.auction.a.posture)}
                        </div>
                      ) : null}
                      {meta.auction?.a?.line ? (
                        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(meta.auction.a.line)}</div>
                      ) : null}
                    </div>
                    <div className="event">
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 700 }}>{String(b?.agent?.displayName ?? b?.agent?.name ?? "B")}</div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <span className="badge">bid {String(meta.auction?.b?.bid ?? "?")}</span>
                          <span className="badge">{String(meta.auction?.b?.time_ms ?? "?")}ms</span>
                        </div>
                      </div>
                      {meta.auction?.b?.posture ? (
                        <div className="muted" style={{ marginTop: 6 }}>
                          {String(meta.auction.b.posture)}
                        </div>
                      ) : null}
                      {meta.auction?.b?.line ? (
                        <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(meta.auction.b.line)}</div>
                      ) : null}
                    </div>
                  </div>
                  {meta.auction?.result ? (
                    <div className="muted" style={{ marginTop: 10 }}>
                      결과: winner bid {String(meta.auction?.result?.winner_bid ?? "?")} / loser bid{" "}
                      {String(meta.auction?.result?.loser_bid ?? "?")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {match.mode === "DEBATE_CLASH" && meta?.debate ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>설전</h3>
                  {meta.debate?.topic ? (
                    <div style={{ marginTop: 8, fontWeight: 700, whiteSpace: "pre-wrap" }}>{String(meta.debate.topic)}</div>
                  ) : null}
                  {meta.debate?.rule ? (
                    <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                      규칙: {String(meta.debate.rule)}
                    </div>
                  ) : null}
                  {meta.debate?.judge ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      심사: {String(meta.debate.judge)}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {[{ who: a, perf: meta.debate?.a }, { who: b, perf: meta.debate?.b }].map((x: any, i: number) => {
                      const name = String(x?.who?.agent?.displayName ?? x?.who?.agent?.name ?? (i === 0 ? "A" : "B"));
                      const perf = x?.perf && typeof x.perf === "object" ? x.perf : {};
                      const pts = perf.points && typeof perf.points === "object" ? perf.points : {};
                      const claims = Array.isArray(perf.claims) ? perf.claims : [];
                      return (
                        <div key={`${name}:${i}`} className="event">
                          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <div style={{ fontWeight: 700 }}>{name}</div>
                              {perf.stance ? <span className="badge">{String(perf.stance)}</span> : null}
                            </div>
                            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <span className="badge">logic {String(pts.logic ?? "?")}</span>
                              <span className="badge">calm {String(pts.composure ?? "?")}</span>
                              <span className="badge">impact {String(pts.punch ?? "?")}</span>
                              <span className="badge">total {String(perf.total ?? "?")}</span>
                            </div>
                          </div>
                          {claims.length ? (
                            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                              {claims.slice(0, 3).map((c: any, j: number) => (
                                <div key={`${i}-${j}-${String(c)}`} className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                                  - {String(c)}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {perf.closer ? (
                            <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(perf.closer)}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {match.mode === "PUZZLE_SPRINT" && meta?.puzzle ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>퍼즐</h3>
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(meta.puzzle?.question ?? "")}</div>
                  <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                    정답: {String(meta.puzzle?.answer ?? "")}
                  </div>
                </div>
              ) : null}

              {match.mode === "MATH_RACE" && meta?.math_race ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>수학 레이스</h3>
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(meta.math_race?.question ?? "")}</div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    정답: {String(meta.math_race?.answer ?? "")}
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      A: {String(meta.math_race?.a?.answer ?? "?")} ({meta.math_race?.a?.correct ? "정답" : "오답"},{" "}
                      {String(meta.math_race?.a?.time_ms ?? "?")}ms)
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      B: {String(meta.math_race?.b?.answer ?? "?")} ({meta.math_race?.b?.correct ? "정답" : "오답"},{" "}
                      {String(meta.math_race?.b?.time_ms ?? "?")}ms)
                    </div>
                  </div>
                </div>
              ) : null}

              {match.mode === "COURT_TRIAL" && meta?.court_trial ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>재판</h3>
                  <div style={{ marginTop: 8, fontWeight: 700 }}>{String(meta.court_trial?.title ?? "")}</div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    혐의: {String(meta.court_trial?.charge ?? "")}
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    {(Array.isArray(meta.court_trial?.facts) ? meta.court_trial.facts : []).slice(0, 12).map((f: any, i: number) => (
                      <div key={`${i}-${String(f)}`} className="muted" style={{ fontSize: 12 }}>
                        - {String(f)}
                      </div>
                    ))}
                  </div>
                  <div className="muted" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                    규칙: {String(meta.court_trial?.statute ?? "")}
                  </div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    정답 판결: {String(meta.court_trial?.correct_verdict ?? "")}
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      A: {String(meta.court_trial?.a?.verdict ?? "?")} ({meta.court_trial?.a?.correct ? "정답" : "오답"},{" "}
                      {String(meta.court_trial?.a?.time_ms ?? "?")}ms)
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      B: {String(meta.court_trial?.b?.verdict ?? "?")} ({meta.court_trial?.b?.correct ? "정답" : "오답"},{" "}
                      {String(meta.court_trial?.b?.time_ms ?? "?")}ms)
                    </div>
                  </div>
                </div>
              ) : null}

              {match.mode === "PROMPT_BATTLE" && meta?.prompt_battle ? (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>프롬프트 배틀</h3>
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{String(meta.prompt_battle?.theme ?? "")}</div>
                  {Array.isArray(meta.prompt_battle?.required) && meta.prompt_battle.required.length ? (
                    <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                      {meta.prompt_battle.required.slice(0, 12).map((k: any) => (
                        <span key={String(k)} className="badge">
                          {String(k)}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                    <div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        A 프롬프트
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(meta.prompt_battle?.a_prompt ?? "")}</div>
                      {Array.isArray(meta.prompt_battle?.a_missing) && meta.prompt_battle.a_missing.length ? (
                        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                          missing: {(meta.prompt_battle.a_missing || []).map((x: any) => String(x)).join(", ")}
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        B 프롬프트
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{String(meta.prompt_battle?.b_prompt ?? "")}</div>
                      {Array.isArray(meta.prompt_battle?.b_missing) && meta.prompt_battle.b_missing.length ? (
                        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                          missing: {(meta.prompt_battle.b_missing || []).map((x: any) => String(x)).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OnboardingStyles() {
  return (
    <style>{`
      .onboardingCard {
        position: relative;
        overflow: hidden;
      }
      .onboardingBg {
        position: absolute;
        inset: 0;
        opacity: 0.85;
        pointer-events: none;
        background:
          radial-gradient(circle at 15% 25%, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 48%),
          radial-gradient(circle at 72% 22%, rgba(32, 211, 255, 0.26), rgba(32, 211, 255, 0) 50%),
          radial-gradient(circle at 42% 78%, rgba(255, 199, 0, 0.22), rgba(255, 199, 0, 0) 52%),
          radial-gradient(circle at 86% 78%, rgba(255, 105, 180, 0.18), rgba(255, 105, 180, 0) 54%);
        animation: onboardingDrift 6.2s ease-in-out infinite alternate;
        transform: translateZ(0);
      }
      .onboardingEnter {
        position: relative;
        animation: onboardingFadeUp 720ms ease-out both;
      }
      .onboardingCenter {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 8px 6px;
        min-height: 280px;
      }

      .gachaHint {
        margin-top: 12px;
        font-weight: 700;
        letter-spacing: -0.2px;
        animation: gachaPulse 1.1s ease-in-out infinite;
      }

      .jobCard {
        margin-top: 14px;
        width: 100%;
        max-width: 360px;
        border-radius: 14px;
        padding: 12px 14px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(18, 18, 22, 0.36);
        backdrop-filter: blur(6px);
      }

      .jobCardPop {
        animation: gachaPop 360ms ease-out both;
      }

      .jobCardTitle {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 8px;
        font-weight: 800;
      }

      .rarityBadge {
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        font-size: 12px;
        opacity: 0.9;
      }

      .companyReveal {
        margin-top: 10px;
        animation: gachaSlideUp 420ms ease-out both;
      }

      .jobCard.common {
        border-color: rgba(210, 210, 210, 0.25);
      }
      .jobCard.uncommon {
        border-color: rgba(98, 183, 255, 0.6);
        box-shadow: 0 0 0 1px rgba(98, 183, 255, 0.12), 0 16px 42px rgba(98, 183, 255, 0.12);
      }
      .jobCard.rare {
        border-color: rgba(176, 110, 255, 0.7);
        box-shadow: 0 0 0 1px rgba(176, 110, 255, 0.14), 0 18px 48px rgba(176, 110, 255, 0.14);
        animation: rareGlow 1.6s ease-in-out infinite alternate;
      }
      .jobCard.legendary {
        border-color: rgba(255, 214, 102, 0.95);
        box-shadow: 0 0 0 1px rgba(255, 214, 102, 0.18), 0 20px 58px rgba(255, 214, 102, 0.18);
        position: relative;
        overflow: hidden;
        animation: legendaryGlow 1.25s ease-in-out infinite alternate;
      }
      .jobCard.legendary::after {
        content: "";
        position: absolute;
        inset: -40px;
        opacity: 0.55;
        background:
          radial-gradient(circle at 30% 40%, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 55%),
          radial-gradient(circle at 70% 20%, rgba(255, 214, 102, 0.22), rgba(255, 214, 102, 0) 60%);
        animation: legendarySparkle 1.8s linear infinite;
      }

      @keyframes onboardingFadeUp {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes onboardingDrift {
        from {
          transform: translate3d(0, 0, 0);
        }
        to {
          transform: translate3d(10px, -12px, 0);
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
          transform: scale(0.94);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes gachaSlideUp {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes rareGlow {
        from {
          box-shadow: 0 0 0 1px rgba(176, 110, 255, 0.1), 0 18px 48px rgba(176, 110, 255, 0.12);
        }
        to {
          box-shadow: 0 0 0 1px rgba(176, 110, 255, 0.22), 0 22px 62px rgba(176, 110, 255, 0.22);
        }
      }

      @keyframes legendaryGlow {
        from {
          box-shadow: 0 0 0 1px rgba(255, 214, 102, 0.16), 0 20px 58px rgba(255, 214, 102, 0.12);
        }
        to {
          box-shadow: 0 0 0 1px rgba(255, 214, 102, 0.32), 0 26px 78px rgba(255, 214, 102, 0.26);
        }
      }

      @keyframes legendarySparkle {
        from {
          transform: translate3d(-8px, 6px, 0) rotate(0deg);
        }
        to {
          transform: translate3d(8px, -6px, 0) rotate(16deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .onboardingBg,
        .onboardingEnter {
          animation: none !important;
        }
        .gachaHint,
        .jobCardPop,
        .companyReveal,
        .jobCard.rare,
        .jobCard.legendary,
        .jobCard.legendary::after {
          animation: none !important;
        }
      }
    `}</style>
  );
}

function renderLimboSummary(limbo: any): React.ReactNode {
  const summary = (limbo as any)?.memory?.summary ?? null;
  const weeklySummary = (limbo as any)?.weekly?.summary ?? null;
  const job = (limbo as any)?.job ?? null;

  const blocks: React.ReactNode[] = [];

  if (summary && typeof summary === "object") {
    const memory5 = asList((summary as any)?.memory_5).slice(0, 5);
    const highlights = asList((summary as any)?.highlights).slice(0, 3);
    const moodFlow = asList((summary as any)?.mood_flow).slice(0, 3);
    const tomorrow = String((summary as any)?.tomorrow ?? "").trim();

    blocks.push(
      <div key="daily" className="roomPaper">
        <div className="muted" style={{ fontSize: 12 }}>
          기억 5줄
        </div>
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {memory5.length > 0 ? (
            memory5.map((line, i) => <div key={`${i}-${line}`}>• {line}</div>)
          ) : (
            <div className="empty">아직 요약이 없어. 하루가 쌓이면 생길 거야.</div>
          )}
        </div>

        {highlights.length > 0 ? (
          <>
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              대표 장면
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {highlights.map((line, i) => (
                <div key={`${i}-${line}`}>- {line}</div>
              ))}
            </div>
          </>
        ) : null}

        <div className="row" style={{ marginTop: 12 }}>
          <span className="badge">감정 흐름</span>
          {moodFlow.length > 0 ? <span className="muted">{moodFlow.join(" → ")}</span> : <span className="muted">…</span>}
        </div>

        {tomorrow ? (
          <div style={{ marginTop: 12 }}>
            <span className="badge">내일의 다짐</span>
            <div style={{ marginTop: 8, fontWeight: 600 }}>{tomorrow}</div>
          </div>
        ) : null}
      </div>
    );
  } else if (job) {
    blocks.push(
      <div key="pending" className="empty">
        브레인이 열심히 정리하는 중... 잠깐만 기다려!
      </div>
    );
  } else {
    blocks.push(
      <div key="empty" className="empty">
        아직 요약이 없어. 브레인을 연결하면 매일 기록해줄게!
      </div>
    );
  }

  if (weeklySummary && typeof weeklySummary === "object") {
    const weekStart = String((weeklySummary as any)?.week_start_day ?? "").trim();
    const weekEnd = String((weeklySummary as any)?.week_end_day ?? "").trim();
    const highlights = asList((weeklySummary as any)?.highlights).slice(0, 3);
    const moodFlow = asList((weeklySummary as any)?.mood_flow).slice(0, 3);
    const nudges = asList((weeklySummary as any)?.nudges).slice(0, 3);

    blocks.push(
      <div key="weekly" className="roomPaper">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            이번 주 요약
          </div>
          {weekStart && weekEnd ? <span className="badge">{`${weekStart}~${weekEnd}`}</span> : null}
        </div>

        {highlights.length > 0 ? (
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {highlights.map((line, i) => (
              <div key={`${i}-${line}`}>- {String(line)}</div>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ marginTop: 10 }}>
            아직 이번 주 요약이 없어. 일주일이 차면 정리해줄게.
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <span className="badge">주간 흐름</span>
          {moodFlow.length > 0 ? <span className="muted">{moodFlow.join(" → ")}</span> : <span className="muted">…</span>}
        </div>

        {nudges.length > 0 ? (
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <span className="badge">당부</span>
            {nudges.map((n, i) => (
              <span key={`${i}-${String((n as any)?.key ?? n)}`} className="badge">
                {String((n as any)?.key ?? n)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return <div style={{ display: "grid", gap: 12 }}>{blocks}</div>;
}

function safePretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}
