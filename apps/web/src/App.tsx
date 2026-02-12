import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  brainStatus, createPlazaPostJob, createPet, deleteMyPromptProfile, deleteMyBrainProfile,
  devLogin, getMyBrainProfile, getMyPromptProfile, googleLogin, me, fetchNotifications,
  listMyBrainJobs, myPet, petArenaHistory, petAction, setGlobalAuthErrorHandler,
  setMyArenaPrefs, setMyBrainProfile, setMyPromptProfile, startGeminiOauth, timeline, upvotePost,
  type UserBrainProfile, type UserPromptProfile, type BrainJobSummary,
  worldArenaLeaderboard, retryMyBrainJob, worldArenaToday, worldToday,
  type Pet, type PetStats, type UserNotification, type PetProgression,
  type ArenaPrefs, type TimelineEvent, arenaChallenge, arenaModeStats,
} from "./lib/api";
import { ensureGoogleScriptLoaded } from "./lib/google-script";
import { friendlyError } from "./lib/errorMessages";
import { loadString, saveString } from "./lib/storage";
import { useNow } from "./lib/useNow";
import { TopBar } from "./components/TopBar";
import { TabBar } from "./components/TabBar";
import { ArenaTab } from "./components/ArenaTab";
import { ArenaWatchModal } from "./components/ArenaWatchModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PostDetailModal } from "./components/PostDetailModal";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToastView } from "./components/ToastView";
import { LoginScreen } from "./components/LoginScreen";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { PetHeader } from "./components/PetHeader";
import { PetTab } from "./components/PetTab";
import { PlazaTab } from "./components/PlazaTab";

const LS_USER_TOKEN = "limbopet_user_jwt", LS_TAB = "limbopet_tab";
const LS_ONBOARDED = "limbopet_onboarded", LS_ONBOARDING_STEP = "limbopet_onboarding_step";
const LS_NO_PET_CHOICE = "limbopet_no_pet_choice", LS_PET_ADVANCED = "limbopet_pet_advanced";
type Toast = { kind: "good" | "warn" | "bad"; text: string } | null;
type Tab = "pet" | "arena" | "plaza";
type PersistedOnboardingStep = "born" | "peek" | "done";
type NoPetChoice = "watch" | "create";
const COOLDOWNS_MS: Record<string, number> = { feed: 10 * 60 * 1000, play: 10 * 60 * 1000, sleep: 30 * 60 * 1000, talk: 0 };
const ARENA_MODE_CHOICES: Array<{ code: string; label: string; short: string }> = [{ code: "COURT_TRIAL", label: "모의재판", short: "재판" }, { code: "DEBATE_CLASH", label: "설전", short: "설전" }];
function moodLabel(mood: number): { label: string; emoji: string } { const m = Number(mood) || 0; if (m >= 75) return { label: "bright", emoji: "😊" }; if (m >= 55) return { label: "okay", emoji: "😐" }; if (m >= 35) return { label: "low", emoji: "😕" }; return { label: "gloomy", emoji: "😞" }; }
function asList(v: unknown): string[] { return Array.isArray(v) ? v.map((x) => String(x)) : []; }
function formatRemaining(ms: number): string { const s = Math.max(0, Math.ceil(ms / 1000)); const mm = Math.floor(s / 60); const ss = s % 60; return mm <= 0 ? `${ss}s` : `${mm}m ${String(ss).padStart(2, "0")}s`; }
const NOTIF_ICON: Record<string, string> = { SOCIAL_REACTION: "👍", RELATIONSHIP_LOVE: "💞", RELATIONSHIP_BREAKUP: "💔", RELATIONSHIP_JEALOUSY: "🔥", RELATIONSHIP_RIVALRY: "⚔️", RELATIONSHIP_BETRAYAL: "🗡️", ECONOMY_CYCLE: "📈", MISSION_ALL_CLEAR: "🎯", DAILY_HOOK_TEASE: "🎬", DAILY_HOOK_REVEAL: "🎉", SOCIAL_EVENT: "💬", ARENA_RESULT: "🏆" };

export function App() {
  // --- State ---
  const [userToken, setUserToken] = useState<string | null>(() => loadString(LS_USER_TOKEN));
  const [petAdvanced, setPetAdvanced] = useState<boolean>(() => loadString(LS_PET_ADVANCED) === "1");
  const [tab, setTab] = useState<Tab>(() => { const t = loadString(LS_TAB); return (t === "pet" || t === "arena" || t === "plaza") ? t : "pet"; });
  const [onboarded, setOnboarded] = useState<boolean>(() => loadString(LS_ONBOARDED) === "1");
  const [onboardingStep, setOnboardingStepRaw] = useState<PersistedOnboardingStep | null>(() => { const v = loadString(LS_ONBOARDING_STEP); if (v === "brain") return "done"; return (v === "born" || v === "peek" || v === "done") ? v : null; });
  const [noPetChoice, setNoPetChoiceRaw] = useState<NoPetChoice | null>(() => { const v = loadString(LS_NO_PET_CHOICE); return (v === "watch" || v === "create") ? v : null; });
  const [userEmail, setUserEmail] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bgRefreshing, setBgRefreshing] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [pet, setPet] = useState<Pet | null>(null);
  const [stats, setStats] = useState<PetStats | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [, setBrain] = useState<any>(null);
  const [brainProfile, setBrainProfile] = useState<UserBrainProfile | null>(null);
  const [promptProfile, setPromptProfile] = useState<UserPromptProfile | null>(null);
  const [promptEnabled, setPromptEnabled] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);
  const [failedBrainJobs, setFailedBrainJobs] = useState<BrainJobSummary[]>([]);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [facts, setFacts] = useState<any[]>([]);
  const [progression, setProgression] = useState<PetProgression | null>(null);
  const [petAnimClass, setPetAnimClass] = useState("");
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatSending, setChatSending] = useState(false);
  const [pendingChatMsg, setPendingChatMsg] = useState<string | null>(null);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const prevLevelRef = useRef<number>(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatPollAbortRef = useRef(false);
  const challengeLockRef = useRef(false);
  const [, setNotifToast] = useState<{ title: string; body: string; icon: string } | null>(null);
  const [, setArenaPrefs] = useState<ArenaPrefs | null>(null);
  const [arenaModesDraft, setArenaModesDraft] = useState<string[] | null>(null);
  const [arenaCoachDraft, setArenaCoachDraft] = useState<string>("");
  const [arenaPrefsBusy, setArenaPrefsBusy] = useState(false);
  const [arenaModeStatsData, setArenaModeStatsData] = useState<Record<string, any>>({});
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, setNotificationsBellShake] = useState(false);
  const [world, setWorld] = useState<any>(null);
  const [arenaToday, setArenaToday] = useState<any>(null);
  const [arenaLeaderboard, setArenaLeaderboard] = useState<any>(null);
  const [arenaHistory, setArenaHistory] = useState<any[]>([]);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [byokProvider, setByokProvider] = useState<string>("openai");
  const [byokModel, setByokModel] = useState<string>("");
  const [byokBaseUrl, setByokBaseUrl] = useState<string>("");
  const [byokApiKey, setByokApiKey] = useState<string>("");
  const [bornReveal, setBornReveal] = useState<{ job: any; company: any } | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const notificationsBootedRef = useRef(false);
  const notificationsPrevUnreadRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const [chatText, setChatText] = useState<string>("");
  const signedIn = Boolean(userToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  // --- Helpers ---
  const clearToastLater = () => { if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current); toastTimerRef.current = window.setTimeout(() => { setToast(null); toastTimerRef.current = null; }, 3200); };
  function setPersistedPetAdvanced(next: boolean) { saveString(LS_PET_ADVANCED, next ? "1" : "0"); setPetAdvanced(next); }
  function setActiveTab(next: Tab) { saveString(LS_TAB, next); setTab(next); if (next === "arena" && userToken) arenaModeStats(userToken).then(r => setArenaModeStatsData(r.stats || {})).catch(() => null); }
  function setPersistedOnboardingStep(next: PersistedOnboardingStep | null) { saveString(LS_ONBOARDING_STEP, next); setOnboardingStepRaw(next); }
  function setPersistedNoPetChoice(next: NoPetChoice | null) { saveString(LS_NO_PET_CHOICE, next); setNoPetChoiceRaw(next); }
  function markOnboarded() { saveString(LS_ONBOARDED, "1"); setOnboarded(true); setPersistedOnboardingStep(null); if (brainProfile) setChatOpen(true); }
  function showToast(kind: Toast extends null ? never : NonNullable<Toast>["kind"], text: string) { setToast({ kind, text }); clearToastLater(); }

  // --- refreshAll ---
  async function refreshAll(token: string, { silent = false }: { silent?: boolean } = {}) {
    if (!silent) setRefreshing(true);
    try {
      try { await me(token); } catch (e: any) {
        if (/User not found|Unauthorized|HTTP 401|HTTP 403/i.test(String(e?.message ?? e))) { onSignOut(); showToast("warn", "세션이 만료되었어요. 다시 로그인해 주세요."); return; }
        throw e;
      }
      const petRes = await myPet(token);
      setPet(petRes.pet); setStats((petRes as any).stats ?? null); setFacts(((petRes as any).facts ?? []) as any[]); setProgression(((petRes as any).progression ?? null) as any);
      const ap = ((petRes as any).arena_prefs ?? null) as ArenaPrefs | null;
      setArenaPrefs(ap); setArenaModesDraft(ap?.modes ?? null); setArenaCoachDraft(String(ap?.coach_note ?? ""));
      const [wt, at, bp, pp, nr, bj] = await Promise.all([
        worldToday(token), worldArenaToday(token), getMyBrainProfile(token),
        getMyPromptProfile(token).catch(() => ({ profile: { enabled: false, prompt_text: "", version: 0, updated_at: null, connected: false } })),
        fetchNotifications(token, { limit: 50 }).catch(() => ({ notifications: [] as UserNotification[], unread_count: 0 })),
        listMyBrainJobs(token, { status: "failed", limit: 6 }).catch(() => ({ jobs: [] as BrainJobSummary[] })),
      ]);
      setWorld(wt); setArenaToday(at); setBrainProfile(bp.profile); setPromptProfile(pp.profile);
      setPromptEnabled(Boolean(pp?.profile?.enabled)); setPromptText(String(pp?.profile?.prompt_text ?? ""));
      setNotifications(((nr as any)?.notifications ?? []) as UserNotification[]);
      setNotificationsUnread(Math.max(0, Math.trunc(Number((nr as any)?.unread_count ?? 0) || 0)));
      setFailedBrainJobs(((bj as any)?.jobs ?? []) as BrainJobSummary[]);
      if (petRes.pet) {
        const [t, bs, ah] = await Promise.all([timeline(token, 60), brainStatus(token), petArenaHistory(token, 8)]);
        setEvents(t.events); setBrain(bs.status); setArenaHistory(((ah as any)?.history ?? []) as any[]);
      } else { setEvents([]); setBrain(null); setArenaHistory([]); setProgression(null); }
    } finally { if (!silent) setRefreshing(false); setInitialLoadDone(true); }
  }

  async function refreshNotifications(token: string, { silent = false }: { silent?: boolean } = {}) {
    if (!token) return;
    try {
      const r = await fetchNotifications(token, { limit: 50 });
      setNotifications((r.notifications || []) as UserNotification[]);
      setNotificationsUnread(Math.max(0, Math.trunc(Number((r as any)?.unread_count ?? 0) || 0)));
    } catch (e: any) { if (!silent) showToast("bad", friendlyError(e)); }
  }

  // --- Effects ---
  useEffect(() => {
    if (!userToken) { setNotifications([]); setNotificationsUnread(0); setNotificationsOpen(false); setNotificationsBellShake(false); notificationsBootedRef.current = false; notificationsPrevUnreadRef.current = 0; return; }
    let cancelled = false;
    void refreshNotifications(userToken, { silent: true });
    const id = window.setInterval(() => { if (!cancelled) void refreshNotifications(userToken, { silent: true }); }, 10_000);
    return () => { cancelled = true; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userToken]);

  useEffect(() => { // Initial load
    if (!userToken) return;
    try {
      const qs = new URLSearchParams(window.location.search);
      const b = String(qs.get("brain") || qs.get("byok") || "").trim();
      if (b === "gemini_connected") {
        showToast("good", "Gemini 두뇌 연결 완료"); qs.delete("brain"); qs.delete("byok");
        const next = qs.toString(); window.history.replaceState({}, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
        if (loadString(LS_ONBOARDED) !== "1" && loadString(LS_ONBOARDING_STEP) === "brain") setPersistedOnboardingStep("done");
      }
    } catch { /* ignore */ }
    refreshAll(userToken).catch((e) => showToast("bad", friendlyError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userToken]);

  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  /** Tab-aware silent refresh — only fetches data relevant to the active tab. */
  async function refreshByTab(token: string) {
    const currentTab = tabRef.current;
    setBgRefreshing(true);
    try {
      // Auth check always
      try { await me(token); } catch (e: any) {
        if (/User not found|Unauthorized|HTTP 401|HTTP 403/i.test(String(e?.message ?? e))) { onSignOut(); showToast("warn", "세션이 만료되었어요. 다시 로그인해 주세요."); return; }
        throw e;
      }
      if (currentTab === "pet") {
        const petRes = await myPet(token);
        setPet(petRes.pet); setStats((petRes as any).stats ?? null); setFacts(((petRes as any).facts ?? []) as any[]); setProgression(((petRes as any).progression ?? null) as any);
        const ap = ((petRes as any).arena_prefs ?? null) as ArenaPrefs | null;
        setArenaPrefs(ap); setArenaModesDraft(ap?.modes ?? null); setArenaCoachDraft(String(ap?.coach_note ?? ""));
        const [bp, pp, bj] = await Promise.all([
          getMyBrainProfile(token),
          getMyPromptProfile(token).catch(() => ({ profile: { enabled: false, prompt_text: "", version: 0, updated_at: null, connected: false } })),
          listMyBrainJobs(token, { status: "failed", limit: 6 }).catch(() => ({ jobs: [] as BrainJobSummary[] })),
        ]);
        setBrainProfile(bp.profile); setPromptProfile(pp.profile);
        setPromptEnabled(Boolean(pp?.profile?.enabled)); setPromptText(String(pp?.profile?.prompt_text ?? ""));
        setFailedBrainJobs(((bj as any)?.jobs ?? []) as BrainJobSummary[]);
        if (petRes.pet) {
          const [t, bs] = await Promise.all([timeline(token, 60), brainStatus(token)]);
          setEvents(t.events); setBrain(bs.status);
        }
      } else if (currentTab === "arena") {
        const [petRes, at] = await Promise.all([myPet(token), worldArenaToday(token)]);
        setPet(petRes.pet); setStats((petRes as any).stats ?? null); setProgression(((petRes as any).progression ?? null) as any);
        const ap = ((petRes as any).arena_prefs ?? null) as ArenaPrefs | null;
        setArenaPrefs(ap); setArenaModesDraft(ap?.modes ?? null); setArenaCoachDraft(String(ap?.coach_note ?? ""));
        setArenaToday(at);
        if (petRes.pet) {
          const ah = await petArenaHistory(token, 8);
          setArenaHistory(((ah as any)?.history ?? []) as any[]);
        }
      } else {
        // plaza — minimal: just pet state for display
        const petRes = await myPet(token);
        setPet(petRes.pet); setStats((petRes as any).stats ?? null); setProgression(((petRes as any).progression ?? null) as any);
      }
    } catch { /* silent — swallow errors for background refresh */ } finally { setBgRefreshing(false); }
  }

  useEffect(() => { // Auto refresh — tab-aware selective fetch
    if (!userToken) return;
    const id = window.setInterval(() => { if (!busyRef.current) void refreshByTab(userToken); }, 30_000);
    return () => window.clearInterval(id);
  }, [userToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // Global 401 handler
    if (userToken) {
      setGlobalAuthErrorHandler(() => { onSignOut(); showToast("warn", "세션이 만료되었어요. 다시 로그인해 주세요."); });
    } else {
      setGlobalAuthErrorHandler(null);
    }
  }, [userToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // Hydrate brain-key form
    if (!brainProfile || byokApiKey.trim() || byokModel.trim() || byokBaseUrl.trim()) return;
    setByokProvider(brainProfile.provider || "openai"); setByokModel(String(brainProfile.model ?? "")); setByokBaseUrl(String(brainProfile.base_url ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainProfile]);

  useEffect(() => { return () => { chatPollAbortRef.current = true; }; }, []);

  useEffect(() => { // Back-compat onboarding skip
    if (signedIn && pet && !onboarded && !onboardingStep) markOnboarded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, pet?.id, onboarded, onboardingStep]);

  useEffect(() => { // BYOK 연결 후 자동 진행 (설정 페이지에서 연결 시)
    if (signedIn && pet && !onboarded && brainProfile) {
      markOnboarded(); setActiveTab("pet");
      showToast("good", "두뇌 업그레이드 완료!");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, pet?.id, onboarded, brainProfile]);

  useEffect(() => { // Level-up
    const lv = Number((progression as any)?.level ?? 0) || 0;
    if (lv > 0 && prevLevelRef.current > 0 && lv > prevLevelRef.current) { setShowLevelUp(true); const id = window.setTimeout(() => setShowLevelUp(false), 1200); return () => window.clearTimeout(id); }
    if (lv > 0) prevLevelRef.current = lv;
  }, [progression]);

  useEffect(() => { // Notification bell shake
    if (!signedIn) { notificationsBootedRef.current = false; notificationsPrevUnreadRef.current = 0; setNotificationsBellShake(false); return; }
    const prev = Math.max(0, Math.trunc(Number(notificationsPrevUnreadRef.current) || 0));
    const cur = Math.max(0, Math.trunc(Number(notificationsUnread) || 0));
    notificationsPrevUnreadRef.current = cur;
    if (!notificationsBootedRef.current) { notificationsBootedRef.current = true; return; }
    if (cur > prev) {
      setNotificationsBellShake(true);
      const id = window.setTimeout(() => setNotificationsBellShake(false), 720);
      const newest = (notifications ?? [])[0] as any;
      if (newest) {
        const nType = String(newest?.type ?? "").trim().toUpperCase();
        setNotifToast({ title: String(newest?.title ?? "").trim() || "알림", body: String(newest?.body ?? "").trim(), icon: NOTIF_ICON[nType] || "🔔" });
        const id2 = window.setTimeout(() => setNotifToast(null), 3000);
        return () => { window.clearTimeout(id); window.clearTimeout(id2); };
      }
      return () => window.clearTimeout(id);
    }
  }, [signedIn, notificationsUnread, notifications]);

  // --- Memos ---
  const profileBadges = useMemo(() => {
    const get = (key: string) => facts.find((f) => f?.kind === "profile" && f?.key === key)?.value ?? null;
    return { mbti: String(get("mbti")?.mbti ?? "").trim() || undefined, company: String(get("company")?.company ?? "").trim() || undefined, job: String(get("job")?.name ?? "").trim() || undefined, role: String(get("role")?.role ?? get("job_role")?.job_role ?? "").trim() || undefined, vibe: String(get("vibe")?.vibe ?? "").trim() || undefined };
  }, [facts]);

  const profileJob = useMemo(() => {
    const v = facts.find((f) => f?.kind === "profile" && f?.key === "job")?.value ?? null;
    if (!v || typeof v !== "object") return null;
    const code = String((v as any)?.code ?? "").trim(); if (!code) return null;
    return { code, displayName: String((v as any)?.name ?? (v as any)?.displayName ?? code).trim() || code, rarity: String((v as any)?.rarity ?? "common").trim() || "common", zone: String((v as any)?.zone ?? (v as any)?.zone_code ?? "").trim() };
  }, [facts]);

  const chatHistory = useMemo(() => (events || []).filter((e) => e?.event_type === "DIALOGUE").slice(0, 20).map((ev: any) => {
    const d = ev?.payload?.dialogue ?? null;
    const rawRefs = Array.isArray(ev?.payload?.memory_refs) ? (ev.payload.memory_refs as any[]) : [];
    const memory_refs = rawRefs.slice(0, 5).map((r: any) => ({ kind: String(r?.kind ?? "").trim(), text: String(r?.text ?? "").trim() })).filter((r: { text: string }) => r.text);
    return { created_at: ev?.created_at ?? null, user_message: String(ev?.payload?.user_message ?? "").trim() || null, mood: typeof d?.mood === "string" ? d.mood : "", lines: asList(d?.lines), memory_saved: Boolean(ev?.payload?.memory_saved), memory_cited: Boolean(ev?.payload?.memory_cited), memory_refs };
  }), [events]);

  useEffect(() => { if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatOpen, chatHistory, chatSending]);

  const now = useNow(signedIn && Boolean(pet));
  const lastActionAt = useMemo(() => { const map = new Map<string, Date>(); for (const ev of events) { const t = String(ev?.event_type ?? "").toLowerCase(); if (["feed", "play", "sleep", "talk"].includes(t) && !map.has(t)) map.set(t, new Date(ev.created_at)); } return map; }, [events]);
  const cooldownRemainingMs = useMemo(() => { const out: Record<string, number> = {}; for (const a of ["feed", "play", "sleep", "talk"]) { const la = lastActionAt.get(a); out[a] = la ? Math.max(0, (COOLDOWNS_MS[a] || 0) - (now.getTime() - la.getTime())) : 0; } return out; }, [lastActionAt, now]);
  const arenaMatches = useMemo(() => { const l = ((arenaToday as any)?.matches ?? (world as any)?.arena?.matches ?? []) as any[]; return Array.isArray(l) ? l : []; }, [arenaToday, world]);
  const arenaMy = (arenaToday as any)?.my ?? null;
  const myArenaMatchToday = useMemo(() => {
    if (!pet?.id) return null; const id = String(pet.id);
    return arenaMatches.find((m: any) => {
      const parts = Array.isArray(m?.participants) ? m.participants : [];
      if (parts.some((p: any) => String(p?.agent?.id ?? "") === id)) return true;
      const cast = (m?.meta && typeof m.meta === "object" ? (m.meta as any) : {})?.cast ?? {};
      const aId = String(cast?.aId ?? cast?.a_id ?? "").trim(), bId = String(cast?.bId ?? cast?.b_id ?? "").trim();
      return Boolean(aId && bId && (aId === id || bId === id));
    }) ?? null;
  }, [arenaMatches, pet?.id]);

  // --- Handlers ---
  async function onDevLogin() {
    setBusy(true);
    try { const res = await devLogin(userEmail); saveString(LS_USER_TOKEN, res.token); setUserToken(res.token); showToast("good", "로그인 완료"); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }
  async function onGoogleIdToken(idToken: string) {
    setBusy(true);
    try { const res = await googleLogin(idToken); saveString(LS_USER_TOKEN, res.token); setUserToken(res.token); showToast("good", "로그인 완료"); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (signedIn || !googleClientId || !googleButtonRef.current) return;
    let cancelled = false;
    ensureGoogleScriptLoaded().then(() => {
      if (cancelled) return; const g = (window as any).google?.accounts?.id; if (!g) return;
      g.initialize({ client_id: googleClientId, callback: (resp: any) => { const t = String(resp?.credential ?? "").trim(); if (t) void onGoogleIdToken(t); } });
      googleButtonRef.current!.innerHTML = ""; g.renderButton(googleButtonRef.current, { theme: "outline", size: "large", text: "signin_with", width: 260 });
    }).catch((e) => { if (!cancelled) showToast("bad", friendlyError(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, googleClientId]);

  function onSignOut() {
    chatPollAbortRef.current = true;
    saveString(LS_USER_TOKEN, null); setUserToken(null); setPet(null); setStats(null); setEvents([]); setBrain(null);
    setBrainProfile(null); setPromptProfile(null); setPromptEnabled(false); setPromptText(""); setPromptBusy(false);
    setFailedBrainJobs([]); setRetryingJobId(null); setFacts([]); setProgression(null);
    setArenaPrefs(null); setArenaModesDraft(null); setArenaCoachDraft(""); setArenaPrefsBusy(false);
    setNotifications([]); setNotificationsUnread(0); setNotificationsOpen(false); setNotificationsBellShake(false);
    notificationsBootedRef.current = false; notificationsPrevUnreadRef.current = 0;
    setWorld(null); setByokApiKey(""); setBornReveal(null);
    setOpenPostId(null); setOpenMatchId(null);
    setChatSending(false); setChatText(""); setPendingChatMsg(null);
    setChallengeBusy(false); challengeLockRef.current = false;
  }

  async function onCreatePetHandler(nameOverride?: string, descOverride?: string) {
    if (!userToken) return; setBusy(true);
    const n = nameOverride ?? createName;
    const d = descOverride ?? createDesc;
    try { const res = await createPet(userToken, n, d); setBornReveal({ job: (res as any)?.job ?? null, company: (res as any)?.company ?? null }); showToast("good", "펫 생성 완료"); setPersistedOnboardingStep("born"); await refreshAll(userToken); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onAction(action: "feed" | "play" | "sleep" | "talk", payloadOverride: Record<string, unknown> | null = null) {
    if (!userToken) return;
    // 기본 AI 제공: brainProfile 없어도 대화 가능 (서버에서 ProxyBrain 폴백)
    if (action !== "talk" && cooldownRemainingMs[action] > 0) { showToast("warn", `쿨다운: ${formatRemaining(cooldownRemainingMs[action])}`); return; }
    setBusy(true);
    const feedbackMap: Record<string, { anim: string; emoji: string; lines: string[] }> = {
      feed: { anim: "petEatAnim", emoji: "🍖", lines: ["맛있다!", "배부르다~", "냠냠!", "이거 좋아!", "더 줘!", "고마워!"] },
      play: { anim: "petPlayAnim", emoji: "🎮", lines: ["재밌다!", "하하!", "한판 더!", "신난다~", "이겼다!", "같이 놀자~"] },
      sleep: { anim: "petSleepAnim", emoji: "💤", lines: ["zzZ...", "꿈나라...", "잘자~", "피곤했어...", "좋은 꿈...", "스르륵..."] },
      talk: { anim: "petTalkAnim", emoji: "💬", lines: [] },
    };
    const fb = feedbackMap[action];
    if (fb) { setPetAnimClass(fb.anim); const line = fb.lines.length > 0 ? fb.lines[Math.floor(Math.random() * fb.lines.length)] : fb.emoji; setActionFeedback(`${fb.emoji} ${line}`); window.setTimeout(() => { setPetAnimClass(""); setActionFeedback(null); }, 2000); }
    try {
      await petAction(userToken, action, payloadOverride ?? (action === "feed" ? { food: "kibble" } : {}));
      await refreshAll(userToken);
      if (action === "talk") {
        chatPollAbortRef.current = false;
        for (const waitMs of [1200, 2500, 4500, 7000]) {
          if (chatPollAbortRef.current) break;
          await new Promise((r) => window.setTimeout(r, waitMs));
          if (chatPollAbortRef.current) break;
          try { const freshTl = await timeline(userToken, 5); if ((freshTl.events || []).find((e) => e?.event_type === "DIALOGUE" && new Date(e.created_at).getTime() > Date.now() - 30_000)) break; } catch { /* ignore */ }
        }
        if (!chatPollAbortRef.current) await refreshAll(userToken).catch(() => null);
        try { const freshTl = await timeline(userToken, 5); if ((freshTl.events || []).find((e) => e?.event_type === "DIALOGUE" && (e as any)?.payload?.memory_saved)) showToast("good", "기억했어요!"); } catch { /* ignore */ }
      }
    } catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onSendChat() {
    if (!userToken || chatSending) return; const msg = chatText.trim(); if (!msg) return;
    // 기본 AI 제공: brainProfile 없어도 대화 가능 (서버에서 ProxyBrain 폴백)
    if (msg.length > 400) { showToast("bad", "메시지가 너무 길어요. 400자 이하로 줄여 주세요."); return; }
    setChatText(""); setChatSending(true); setPendingChatMsg(msg);
    chatPollAbortRef.current = false;
    try {
      await petAction(userToken, "talk", { message: msg });
      let responded = false;
      for (const ms of [1200, 2500, 4500, 7000, 10000]) {
        if (chatPollAbortRef.current) break;
        await new Promise(r => setTimeout(r, ms));
        if (chatPollAbortRef.current) break;
        try { const freshTl = await timeline(userToken, 5); if ((freshTl.events || []).find((e) => e?.event_type === "DIALOGUE" && new Date(e.created_at).getTime() > Date.now() - 30_000)) { responded = true; break; } } catch { /* ignore */ }
      }
      if (!chatPollAbortRef.current) await refreshAll(userToken).catch(() => null);
      if (!responded && !chatPollAbortRef.current) showToast("warn", "응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.");
      try { const freshTl = await timeline(userToken, 5); if ((freshTl.events || []).find((e) => e?.event_type === "DIALOGUE" && (e as any)?.payload?.memory_saved)) showToast("good", "기억했어요!"); } catch { /* ignore */ }
    } catch (e: any) { showToast("bad", friendlyError(e)); setChatText(msg); } finally { setChatSending(false); setPendingChatMsg(null); }
  }

  function effectiveArenaModes(): string[] { const s = arenaModesDraft; if (!s || s.length === 0) return ARENA_MODE_CHOICES.map(c => c.code); const allow = new Set(ARENA_MODE_CHOICES.map(c => c.code)); return s.map(x => String(x || "").trim().toUpperCase()).filter(m => allow.has(m)); }
  function toggleArenaMode(code: string) {
    const c = String(code || "").trim().toUpperCase(); if (!c) return;
    const all = ARENA_MODE_CHOICES.map(x => x.code); const cur = effectiveArenaModes(); const set = new Set(cur);
    if (set.has(c)) set.delete(c); else set.add(c); const next = all.filter(m => set.has(m));
    if (next.length === 0) { showToast("warn", "아레나 종목은 최소 1개는 선택해야 해요."); return; }
    setArenaModesDraft(next.length === all.length ? null : next);
  }

  async function onSaveArenaPrefs() {
    if (!userToken || !pet || arenaPrefsBusy) return;
    const all = ARENA_MODE_CHOICES.map(x => x.code); const selected = effectiveArenaModes();
    setArenaPrefsBusy(true);
    try {
      const res = await setMyArenaPrefs(userToken, { modes: selected.length === all.length ? null : selected, coach_note: arenaCoachDraft.trim() || null });
      setArenaPrefs(res.prefs); setArenaModesDraft(res.prefs?.modes ?? null); setArenaCoachDraft(String(res.prefs?.coach_note ?? ""));
      showToast("good", "아레나 설정 저장"); await refreshAll(userToken, { silent: true });
    } catch (e: any) { showToast("bad", friendlyError(e)); } finally { setArenaPrefsBusy(false); }
  }

  async function onCreatePlazaPost() {
    if (!userToken) return;
    // 기본 AI 제공: brainProfile 없어도 광장 글 생성 가능
    setBusy(true);
    try { const res = await createPlazaPostJob(userToken, "general"); showToast(res.reused ? "warn" : "good", res.reused ? "이미 대기 중인 글이 있어요." : "광장 글 생성 중... 두뇌가 쓰고 있어요."); await refreshAll(userToken); setActiveTab("plaza"); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onUpvote(postId: string) {
    if (!userToken) return; setBusy(true);
    try { await upvotePost(userToken, postId); await refreshAll(userToken, { silent: true }); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onRefreshArena() {
    if (!userToken) return; setBusy(true);
    try { const res = await worldArenaToday(userToken, { limit: 20 }); setArenaToday(res); arenaModeStats(userToken).then(r => setArenaModeStatsData(r.stats || {})).catch(() => null); showToast("good", "아레나 새로고침"); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onArenaChallenge(mode: string) {
    if (!userToken || challengeBusy || challengeLockRef.current) return;
    challengeLockRef.current = true; setChallengeBusy(true);
    try { const res = await arenaChallenge(userToken, mode); if (res.match_id) { setOpenMatchId(res.match_id); showToast("good", `${mode} 도전 매치 생성!`); } else if (res.already) { setOpenMatchId(res.match_id); showToast("warn", "이미 진행 중인 매치가 있어요."); } }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setChallengeBusy(false); challengeLockRef.current = false; }
  }

  async function onLoadArenaLeaderboard() {
    if (!userToken) return; setBusy(true);
    try { setArenaLeaderboard(await worldArenaLeaderboard(userToken, { limit: 25 })); showToast("good", "리더보드 불러옴"); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onSaveByok() {
    if (!userToken) return;
    if (!byokProvider.trim()) { showToast("bad", "제공자를 선택해 주세요."); return; }
    if (!byokModel.trim()) { showToast("bad", "모델을 입력해 주세요."); return; }
    if (!byokApiKey.trim()) { showToast("bad", "API 키를 입력해 주세요."); return; }
    setBusy(true);
    try { const res = await setMyBrainProfile(userToken, { provider: byokProvider, model: byokModel.trim(), api_key: byokApiKey.trim(), base_url: byokBaseUrl.trim() || null }); setBrainProfile(res.profile); setByokApiKey(""); showToast("good", "두뇌 연결 완료"); await refreshAll(userToken, { silent: true }); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onDeleteByok() {
    if (!userToken) return; setBusy(true);
    try { await deleteMyBrainProfile(userToken); setBrainProfile(null); showToast("good", "두뇌 분리 완료"); await refreshAll(userToken, { silent: true }); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  async function onSavePrompt() {
    if (!userToken) return; setPromptBusy(true);
    try { const res = await setMyPromptProfile(userToken, { enabled: promptEnabled, prompt_text: String(promptText || "") }); setPromptProfile(res.profile); setPromptEnabled(Boolean(res.profile.enabled)); setPromptText(String(res.profile.prompt_text || "")); showToast("good", "프롬프트 저장 완료"); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setPromptBusy(false); }
  }

  async function onDeletePrompt() {
    if (!userToken) return; setPromptBusy(true);
    try { await deleteMyPromptProfile(userToken); setPromptProfile(null); setPromptEnabled(false); setPromptText(""); showToast("good", "프롬프트 초기화 완료"); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setPromptBusy(false); }
  }

  async function onRetryBrainJob(jobId: string) {
    if (!userToken) return; const id = String(jobId || "").trim(); if (!id) return; setRetryingJobId(id);
    try { await retryMyBrainJob(userToken, id); showToast("good", "재시도 중이에요."); await refreshAll(userToken, { silent: true }); }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setRetryingJobId(null); }
  }

  async function onGeminiOauthConnect() {
    if (!userToken) return; setBusy(true);
    try {
      const { url } = await startGeminiOauth(userToken);
      const popup = window.open(url, "gemini_oauth", "popup,width=520,height=680");
      showToast("good", "팝업에서 구글 연결을 진행해 주세요.");
      for (const w of [1200, 2200, 4000, 6500]) {
        if (popup && popup.closed) { showToast("warn", "구글 연결 창이 닫혔어요. 다시 시도해 주세요."); return; }
        await new Promise(r => window.setTimeout(r, w));
        if (popup && popup.closed) break;
        await refreshAll(userToken, { silent: true });
      }
      try { const check = await getMyBrainProfile(userToken); if (!check?.profile) showToast("warn", "구글 연결이 아직 완료되지 않았어요. 팝업에서 연결을 완료해 주세요."); } catch { /* ignore */ }
    }
    catch (e: any) { showToast("bad", friendlyError(e)); } finally { setBusy(false); }
  }

  // --- Screens ---
  const petName = pet ? pet.display_name || pet.name : "";

  if (!signedIn) return <LoginScreen appTitle="LIMBOPET" googleClientId={googleClientId} googleButtonRef={googleButtonRef as React.RefObject<HTMLDivElement>} userEmail={userEmail} onEmailChange={setUserEmail} onDevLogin={onDevLogin} busy={busy} toast={toast} />;

  // Wait for initial data load before deciding onboarding — prevents flash
  if (signedIn && !initialLoadDone) return <div className="container appShell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}><div className="petChatTyping"><span className="typingDot" /><span className="typingDot" /><span className="typingDot" /></div></div>;

  const onboardingStep_ = (!pet && !noPetChoice) ? "choice" : (!pet && noPetChoice === "create" && !onboarded) ? "create" : (!onboarded && onboardingStep) ? onboardingStep : null;
  if (onboardingStep_) return (
    <OnboardingFlow step={onboardingStep_} token={userToken} pet={pet} petName={petName} onboarded={onboarded} profileBadges={profileBadges} profileJob={profileJob} brainProfile={brainProfile} busy={busy} refreshing={refreshing} bornReveal={bornReveal}
      onCreatePet={(name, desc) => { setCreateName(name); setCreateDesc(desc); onCreatePetHandler(name, desc); }} onMarkOnboarded={markOnboarded} onSetOnboardingStep={setPersistedOnboardingStep}
      onSetNoPetChoice={setPersistedNoPetChoice} onSetActiveTab={(t) => setActiveTab(t as Tab)} onRefreshAll={() => userToken && refreshAll(userToken)} onSignOut={onSignOut} toast={toast}
      byokProvider={byokProvider} byokModel={byokModel} byokBaseUrl={byokBaseUrl} byokApiKey={byokApiKey}
      onByokProviderChange={setByokProvider} onByokModelChange={setByokModel} onByokBaseUrlChange={setByokBaseUrl} onByokApiKeyChange={setByokApiKey} onSaveByok={onSaveByok} />
  );

  const mood = moodLabel(stats?.mood ?? 50);
  return (
    <ErrorBoundary>
      <div className="container appShell">
        {bgRefreshing ? <div className="bgRefreshBar" /> : null}
        {pet ? (
          <PetHeader pet={pet} stats={stats} mood={mood} progression={progression} onSettingsToggle={() => setSettingsOpen(v => !v)}
            chatSending={chatSending} chatHistory={chatHistory} petAnimClass={petAnimClass} facts={facts} />
        ) : (
          <TopBar title="LIMBOPET" right={<button className="settingsGearBtn" type="button" onClick={() => setSettingsOpen(v => !v)} title="설정">{"\u2699\uFE0F"}</button>} />
        )}

        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} brainProfile={brainProfile}
          byokProvider={byokProvider} byokModel={byokModel} byokBaseUrl={byokBaseUrl} byokApiKey={byokApiKey}
          onByokProviderChange={setByokProvider} onByokModelChange={setByokModel} onByokBaseUrlChange={setByokBaseUrl} onByokApiKeyChange={setByokApiKey}
          onSaveByok={onSaveByok} onDeleteByok={onDeleteByok} onGeminiOauthConnect={onGeminiOauthConnect} userToken={userToken} onSignOut={onSignOut}
          onBrainProfileChange={() => { if (userToken) getMyBrainProfile(userToken).then(r => setBrainProfile(r.profile)).catch(() => showToast("warn", "두뇌 프로필 갱신 실패")); }}
          promptEnabled={promptEnabled} promptText={promptText} promptVersion={Math.max(0, Math.trunc(Number(promptProfile?.version ?? 0) || 0))}
          promptUpdatedAt={promptProfile?.updated_at ?? null} promptBusy={promptBusy} onPromptEnabledChange={setPromptEnabled} onPromptTextChange={setPromptText}
          onSavePrompt={onSavePrompt} onDeletePrompt={onDeletePrompt} failedJobs={failedBrainJobs} retryingJobId={retryingJobId} onRetryJob={onRetryBrainJob}
          busy={busy} />

        <div className="screen">
          {tab === "pet" ? (
            <PetTab pet={pet} mood={mood} showLevelUp={showLevelUp} actionFeedback={actionFeedback}
              chatHistory={chatHistory} chatSending={chatSending} chatText={chatText} onChatTextChange={setChatText} onSendChat={onSendChat}
              chatEndRef={chatEndRef as React.RefObject<HTMLDivElement>} createName={createName} createDesc={createDesc} onCreateNameChange={setCreateName} onCreateDescChange={setCreateDesc} onCreatePet={onCreatePetHandler} busy={busy}
              facts={facts} pendingChatMsg={pendingChatMsg} />
          ) : null}

          {tab === "arena" ? (
              <ArenaTab pet={pet} arenaLeaderboard={arenaLeaderboard} arenaHistory={arenaHistory} arenaMy={arenaMy} myArenaMatchToday={myArenaMatchToday}
                onRefreshArena={onRefreshArena} onLoadArenaLeaderboard={onLoadArenaLeaderboard}
                onOpenMatch={(id) => { setOpenPostId(null); setOpenMatchId(id); }}
                onChallenge={onArenaChallenge} challengeBusy={challengeBusy} busy={busy} />
          ) : null}

          {tab === "plaza" && userToken ? (
            <PlazaTab token={userToken} pet={pet} busy={busy} onCreatePost={onCreatePlazaPost} onUpvote={pet ? onUpvote : null}
              onOpenPost={(id) => { setOpenMatchId(null); setOpenPostId(id); }} onOpenMatch={(id) => { setOpenPostId(null); setOpenMatchId(id); }}
              onSetActiveTab={(t) => setActiveTab(t as Tab)} onSetToast={setToast} />
          ) : null}
        </div>

        <TabBar tab={tab} onChangeTab={(t) => setActiveTab(t as Tab)} />

        {userToken && openPostId ? (
          <PostDetailModal token={userToken} postId={openPostId} onClose={() => setOpenPostId(null)} onUpvote={pet ? onUpvote : null} onAfterMutate={null}
            onOpenMatch={(matchId) => { setOpenPostId(null); setOpenMatchId(matchId); }} />
        ) : null}

        {userToken && openMatchId ? (
          <ArenaWatchModal token={userToken} matchId={openMatchId} viewerAgentId={pet?.id ?? null} onClose={() => setOpenMatchId(null)}
            onOpenPost={(postId) => { setOpenMatchId(null); setOpenPostId(postId); }} />
        ) : null}

        <ToastView toast={toast} />
      </div>
    </ErrorBoundary>
  );
}
