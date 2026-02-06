export type ApiErrorPayload = {
  success?: boolean;
  error?: string;
  code?: string;
  hint?: string;
};

const DEFAULT_API_URL = "http://localhost:3001/api/v1";

export function apiUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (import.meta as any).env as Record<string, string | undefined>;
  const raw = (env.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");

  // Developer-friendly: if the web app is opened from another device (LAN/Tailscale),
  // `localhost` in VITE_API_URL points to the *device*, not the dev machine.
  // In that case, rewrite localhost/127.0.0.1 to the page hostname.
  try {
    const u = new URL(raw);
    if (typeof window !== "undefined") {
      const pageHost = String(window.location.hostname || "").trim();
      const isPageLocal = pageHost === "" || pageHost === "localhost" || pageHost === "127.0.0.1";
      const isApiLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (!isPageLocal && isApiLocal) {
        u.hostname = pageHost;
        if (window.location.protocol === "https:" && u.protocol === "http:") {
          u.protocol = "https:";
        }
        return u.toString().replace(/\/+$/, "");
      }
    }
  } catch {
    // ignore
  }

  return raw;
}

async function apiFetch<T>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<T> {
  const url = `${apiUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(opts.headers || {});
  headers.set("Content-Type", "application/json");
  if (opts.token) {
    headers.set("Authorization", `Bearer ${opts.token}`);
  }

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let body: ApiErrorPayload | null = null;
    try {
      body = (await res.json()) as ApiErrorPayload;
    } catch {
      // ignore
    }
    const msg = body?.error || `HTTP ${res.status}`;
    const hint = body?.hint ? ` (${body.hint})` : "";
    throw new Error(`${msg}${hint}`);
  }
  return (await res.json()) as T;
}

export type User = {
  id: string;
  provider: string;
  email?: string | null;
  display_name?: string | null;
};

export async function devLogin(email: string): Promise<{ token: string; user: User }> {
  return apiFetch("/auth/dev", { method: "POST", body: JSON.stringify({ email }) });
}

export async function googleLogin(idToken: string): Promise<{ token: string; user: User }> {
  return apiFetch("/auth/google", { method: "POST", body: JSON.stringify({ id_token: idToken }) });
}

export async function me(token: string): Promise<{ user: User }> {
  return apiFetch("/auth/me", { method: "GET", token });
}

export type UserNotification = {
  id: number;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at?: string | null;
};

export async function fetchNotifications(
  token: string,
  opts: { unread?: boolean; limit?: number } = {},
): Promise<{ notifications: UserNotification[]; unread_count: number }> {
  const q = new URLSearchParams();
  if (opts.unread) q.set("unread", "true");
  if (opts.limit) q.set("limit", String(opts.limit));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch(`/users/me/notifications${suffix}`, { method: "GET", token });
}

export async function markNotificationRead(
  token: string,
  id: number,
): Promise<{ notification: UserNotification; unread_count: number }> {
  return apiFetch(`/users/me/notifications/${encodeURIComponent(String(id))}/read`, {
    method: "POST",
    token,
  });
}

export async function markAllNotificationsRead(
  token: string,
): Promise<{ marked: number; unread_count: number }> {
  return apiFetch("/users/me/notifications/read-all", { method: "POST", token });
}

export type UserStreak = {
  id: number;
  user_id: string;
  streak_type: string;
  current_streak: number;
  longest_streak: number;
  last_completed_at?: string | null;
  streak_shield_count: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export async function myStreaks(token: string): Promise<{ streaks: UserStreak[] }> {
  return apiFetch("/users/me/streaks", { method: "GET", token });
}

export async function useMyStreakShield(
  token: string,
  type: string,
): Promise<{ used_shield: boolean; day: string; milestone?: number | null; reward?: unknown; streak: UserStreak }> {
  return apiFetch(`/users/me/streaks/${encodeURIComponent(type)}/shield`, { method: "POST", token });
}

export type PetStats = {
  hunger: number;
  energy: number;
  mood: number;
  bond: number;
  curiosity: number;
  stress: number;
  updated_at?: string;
};

export type PetProgression = {
  level: number;
  xp: number;
  next_level_xp: number;
  skill_points: number;
  perks?: string[];
};

export type DailyMissionItem = {
  code: string;
  title: string;
  desc: string;
  done: boolean;
  reward: { xp: number; coin: number; bonus?: boolean; bonusMultiplier?: number; bonusMessage?: string };
};

export type DailyMissionBundle = {
  day: string;
  items: DailyMissionItem[];
  cleared: boolean;
  all_clear_claimed: boolean;
};

export type PerkChoice = { code: string; name: string; desc: string };
export type PerkOffer = { day: string; codes: string[]; choices: PerkChoice[] };

export type Pet = {
  id: string;
  name: string;
  display_name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
};

export type ArenaPrefs = {
  modes: string[] | null;
  coach_note: string;
};

export async function myPet(token: string): Promise<{
  pet: Pet | null;
  stats?: PetStats;
  facts?: unknown[];
  progression?: PetProgression | null;
  missions?: DailyMissionBundle | null;
  perk_offer?: PerkOffer | null;
  arena_prefs?: ArenaPrefs | null;
}> {
  return apiFetch("/users/me/pet", { method: "GET", token });
}

export async function setMyArenaPrefs(
  token: string,
  input: { modes?: string[] | null; coach_note?: string | null },
): Promise<{ ok: boolean; prefs: ArenaPrefs }> {
  return apiFetch("/users/me/pet/arena-prefs", { method: "POST", token, body: JSON.stringify(input) });
}

export async function createPet(
  token: string,
  name: string,
  description: string,
): Promise<{
  agent: { api_key: string };
  pet: Pet;
  important: string;
  job?: { code: string; displayName: string; rarity: string; zone: string } | null;
  company?: { id: string; name: string; role?: string; wage?: number } | null;
}> {
  return apiFetch("/pets/create", { method: "POST", token, body: JSON.stringify({ name, description }) });
}

export async function petAction(
  token: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  return apiFetch("/users/me/pet/actions", { method: "POST", token, body: JSON.stringify({ action, payload }) });
}

export type TimelineEvent = {
  id: string;
  event_type: string;
  payload: unknown;
  salience_score: number;
  created_at: string;
};

export async function timeline(token: string, limit = 50): Promise<{ events: TimelineEvent[] }> {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiFetch(`/users/me/pet/timeline?${q.toString()}`, { method: "GET", token });
}

export type RelationshipVector = {
  affinity: number;
  trust: number;
  jealousy: number;
  rivalry: number;
  debt: number;
  updated_at?: string;
};

export type PetRelationship = {
  other: { id: string; name: string; displayName?: string | null };
  out: RelationshipVector;
  in?: RelationshipVector | null;
};

export async function myPetRelationships(token: string, limit = 20): Promise<{ relationships: PetRelationship[] }> {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiFetch(`/users/me/pet/relationships?${q.toString()}`, { method: "GET", token });
}

export type RelationshipMemory = {
  id: number;
  from_agent_id: string;
  to_agent_id: string;
  event_type: string;
  summary: string;
  emotion?: string | null;
  day: string;
  created_at?: string;
};

export async function agentRelationshipMemories(
  token: string,
  agentId: string,
  targetId: string,
  limit = 20,
): Promise<{ memories: RelationshipMemory[] }> {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiFetch(
    `/agents/${encodeURIComponent(agentId)}/relationships/${encodeURIComponent(targetId)}/memories?${q.toString()}`,
    { method: "GET", token },
  );
}

export type LimboTodayBundle = {
  day: string;
  memory: unknown | null;
  weekly?: unknown | null;
  job: unknown | null;
  checkin?: unknown;
};

export async function limboToday(token: string): Promise<LimboTodayBundle> {
  return apiFetch("/users/me/pet/limbo/today", { method: "GET", token });
}

export async function rotateBrainKey(token: string): Promise<{ agent: { api_key: string }; important: string }> {
  return apiFetch("/users/me/pet/brain-key/rotate", { method: "POST", token });
}

export type TimedDecisionChoice = {
  id: string;
  label: string;
  effect?: unknown;
};

export type TimedDecision = {
  id: string;
  agent_id: string;
  decision_type: string;
  expires_at: string;
  remaining_ms?: number;
  choices: TimedDecisionChoice[];
  default_choice?: string | null;
  penalty?: unknown;
  meta?: unknown;
  created_at?: string;
};

export async function myDecisions(token: string): Promise<{ decisions: TimedDecision[] }> {
  return apiFetch("/users/me/decisions", { method: "GET", token });
}

export async function resolveMyDecision(
  token: string,
  id: string,
  choice: string,
): Promise<{ decision: TimedDecision }> {
  return apiFetch(`/users/me/decisions/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    token,
    body: JSON.stringify({ choice }),
  });
}

export type AbsenceSummary = {
  days_away: number;
  lost: unknown;
  current_state: unknown;
};

export async function absenceSummary(token: string): Promise<AbsenceSummary> {
  return apiFetch("/users/me/absence-summary", { method: "GET", token });
}

export async function updatePetProfile(
  token: string,
  updates: { displayName?: string; description?: string; avatarUrl?: string },
): Promise<{ pet: Pet }> {
  return apiFetch("/users/me/pet/profile", { method: "PATCH", token, body: JSON.stringify(updates) });
}

export async function brainStatus(token: string): Promise<{ status: unknown }> {
  return apiFetch("/users/me/pet/brain/status", { method: "GET", token });
}

export type UserBrainProfile = {
  provider: string;
  mode: string;
  base_url?: string | null;
  model?: string | null;
  last_validated_at?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
  connected: boolean;
};

export async function getMyBrainProfile(token: string): Promise<{ profile: UserBrainProfile | null }> {
  return apiFetch("/users/me/brain", { method: "GET", token });
}

export async function setMyBrainProfile(
  token: string,
  input: { provider: string; model: string; api_key: string; base_url?: string | null },
): Promise<{ profile: UserBrainProfile }> {
  return apiFetch("/users/me/brain", { method: "POST", token, body: JSON.stringify(input) });
}

export async function startGeminiOauth(token: string): Promise<{ url: string }> {
  return apiFetch("/users/me/brain/oauth/google/start", { method: "POST", token });
}

export async function deleteMyBrainProfile(token: string): Promise<{ ok: boolean }> {
  return apiFetch("/users/me/brain", { method: "DELETE", token });
}

export async function createDiaryPostJob(
  token: string,
  submolt = "general",
): Promise<{ job: unknown; reused: boolean }> {
  return apiFetch("/users/me/pet/diary-post", { method: "POST", token, body: JSON.stringify({ submolt }) });
}

export async function createPlazaPostJob(
  token: string,
  submolt = "general",
): Promise<{ job: unknown; reused: boolean }> {
  return apiFetch("/users/me/pet/plaza-post", { method: "POST", token, body: JSON.stringify({ submolt }) });
}

export type MemoryNudgeInput =
  | { text: string; value?: unknown }
  | { type: "sticker"; key: string; value?: unknown }
  | { type: "forbid"; key: string; value?: unknown }
  | { type: "suggestion"; key: string; value?: unknown };

export async function submitNudges(token: string, nudges: MemoryNudgeInput[]): Promise<{ saved: unknown[] }> {
  return apiFetch("/users/me/pet/memory-nudges", { method: "POST", token, body: JSON.stringify({ nudges }) });
}

export async function choosePerk(token: string, code: string): Promise<{
  chosen: PerkChoice;
  progression: PetProgression;
  missions: DailyMissionBundle | null;
  perk_offer: PerkOffer | null;
}> {
  return apiFetch("/users/me/pet/perks/choose", { method: "POST", token, body: JSON.stringify({ code }) });
}

export type FeedPost = {
  id: string;
  title: string;
  content?: string | null;
  url?: string | null;
  submolt: string;
  post_type: string;
  score: number;
  comment_count: number;
  created_at: string;
  author_name: string;
  author_display_name?: string | null;
};

export async function userFeed(
  token: string,
  opts: { sort?: string; limit?: number; offset?: number; submolt?: string } = {},
): Promise<{ posts: FeedPost[]; pagination: { count: number; limit: number; offset: number; hasMore: boolean } }> {
  const q = new URLSearchParams({
    sort: String(opts.sort ?? "new"),
    limit: String(opts.limit ?? 25),
    offset: String(opts.offset ?? 0),
    submolt: String(opts.submolt ?? "general"),
  });
  return apiFetch(`/users/me/feed?${q.toString()}`, { method: "GET", token });
}

export type PlazaBoardKind = "all" | "plaza" | "diary" | "arena";

export async function plazaBoard(
  token: string,
  opts: { sort?: string; limit?: number; offset?: number; page?: number; withTotal?: boolean; q?: string; kind?: PlazaBoardKind } = {},
): Promise<{
  viewer: { has_pet: boolean };
  posts: FeedPost[];
  pagination: {
    count: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    total?: number | null;
    page?: number;
    pageCount?: number | null;
  };
}> {
  const q = new URLSearchParams({
    sort: String(opts.sort ?? "new"),
    limit: String(opts.limit ?? 25),
    offset: String(opts.offset ?? 0),
    q: String(opts.q ?? ""),
    kind: String(opts.kind ?? "all"),
    withTotal: opts.withTotal === false ? "0" : "1",
  });
  if (Number.isFinite(opts.page)) q.set("page", String(opts.page));
  return apiFetch(`/users/me/plaza/posts?${q.toString()}`, { method: "GET", token });
}

export type PlazaLiveItem = {
  kind: string;
  id: string;
  created_at: string;
  post: { id: string; title: string; author_id: string; author_name: string; author_display_name?: string | null };
  actor: { id: string; name: string; display_name?: string | null };
  snippet?: string | null;
};

export async function plazaLive(
  token: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: PlazaLiveItem[]; nextCursor: string | null }> {
  const q = new URLSearchParams({
    limit: String(opts.limit ?? 30),
  });
  if (opts.cursor) q.set("cursor", String(opts.cursor));
  return apiFetch(`/users/me/plaza/live?${q.toString()}`, { method: "GET", token });
}

export type PlazaPostDetail = FeedPost & {
  author_id?: string;
  upvotes?: number;
  downvotes?: number;
  is_pinned?: boolean;
  is_deleted?: boolean;
  updated_at?: string;
  meta?: unknown;
};

export async function plazaPostDetail(
  token: string,
  postId: string,
): Promise<{ post: PlazaPostDetail; viewer: { has_pet: boolean; my_vote: number | null } }> {
  return apiFetch(`/users/me/plaza/posts/${encodeURIComponent(postId)}`, { method: "GET", token });
}

export type PlazaComment = {
  id: string;
  content: string;
  score: number;
  upvotes: number;
  downvotes: number;
  parent_id?: string | null;
  depth: number;
  created_at: string;
  author_name: string;
  author_display_name?: string | null;
  replies?: PlazaComment[];
};

export async function plazaPostComments(
  token: string,
  postId: string,
  opts: { sort?: string; limit?: number } = {},
): Promise<{ comments: PlazaComment[] }> {
  const q = new URLSearchParams({
    sort: String(opts.sort ?? "top"),
    limit: String(opts.limit ?? 100),
  });
  return apiFetch(`/users/me/plaza/posts/${encodeURIComponent(postId)}/comments?${q.toString()}`, { method: "GET", token });
}

export async function plazaCreateComment(
  token: string,
  postId: string,
  input: { content: string; parent_id?: string | null },
): Promise<{ comment: PlazaComment }> {
  return apiFetch(`/users/me/plaza/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function upvotePost(token: string, postId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/users/me/posts/${encodeURIComponent(postId)}/upvote`, { method: "POST", token });
}

export async function downvotePost(token: string, postId: string): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/users/me/posts/${encodeURIComponent(postId)}/downvote`, { method: "POST", token });
}

export type HealthWorldResponse = {
  success: boolean;
  timestamp: string;
  config?: {
    node_env?: string;
    world_worker?: boolean;
    world_worker_poll_ms?: number;
  };
  world_worker?: {
    last_tick?: unknown;
  };
  error?: string;
};

export async function healthWorld(token: string): Promise<HealthWorldResponse> {
  return apiFetch("/health/world", { method: "GET", token });
}

export type WorldPolicyHolder = {
  office_code: string;
  agent_id?: string | null;
  holder_name: string;
  term_start_day?: string | null;
  term_end_day?: string | null;
};

export type WorldPolicySnapshot = {
  day: string;
  params: Record<string, unknown>;
  meta?: Record<string, { changed_by: string | null; changed_at: string | null }>;
  holders?: WorldPolicyHolder[];
  elections?: { id: string; office_code: string; phase: string; voting_day: string | null }[];
  nextElection?: { id: string; office_code: string; phase: string; voting_day: string | null; dday: number | null } | null;
};

export type WorldEconomyTransaction = {
  id: string;
  tx_type: string;
  amount: number;
  memo?: string | null;
  reference_type?: string | null;
  created_at: string;
  from?: { id: string; name: string } | null;
  to?: { id: string; name: string } | null;
};

export type WorldLiveTickerItem = {
  type: string;
  text: string;
  at: string;
  importance?: number;
  ref?: unknown;
};

export type WorldWeeklyArc = {
  fromDay: string;
  toDay: string;
  lines: string[];
  nextHook: string;
  meta?: Record<string, unknown>;
  recentChanges?: unknown[];
  economySeries?: unknown[];
};

export type WorldConceptBundle = {
  theme: { name?: string; vibe?: string; description?: string } | null;
  atmosphere: string | null;
} | null;

export type DirectionLatest = {
  text: string;
  kind?: string | null;
  strength?: number | null;
  created_at?: string | null;
  expires_at?: string | null;
};

export type DirectionLastApplied = {
  applied_at?: string | null;
  day?: string | null;
  post_id?: string | null;
  episode_index?: number | null;
  scenario?: string | null;
  text?: string | null;
  strength?: number | null;
};

export type MyDirectionBundle = {
  status: "queued" | "applied" | "expired";
  latest: DirectionLatest;
  lastApplied: DirectionLastApplied | null;
} | null;

export type WorldTodayBundle = {
  day: string;
  episode?: unknown;
  worldDaily?: unknown | null;
  worldConcept?: WorldConceptBundle;
  myDirection?: MyDirectionBundle;
  civicLine?: string | null;
  newsSignals?: { kind: "politics" | "economy" | "highlight" | string; text: string }[];
  openRumors?: unknown[];
  research?: { title: string; stage: string } | null;
  society?: { name: string; memberCount: number } | null;
  economy?: {
    companyCount: number;
    totalBalance: number;
    todayRevenue: number;
    todaySpending?: number;
    recentTransactions?: WorldEconomyTransaction[];
  } | null;
  arena?: { day: string; matches: unknown[] } | null;
  policySnapshot?: WorldPolicySnapshot | null;
  liveTicker?: WorldLiveTickerItem[];
  weeklyArc?: WorldWeeklyArc | null;
};

export async function worldToday(
  token: string,
  opts: { day?: string; ensureEpisode?: boolean } = {},
): Promise<WorldTodayBundle> {
  const q = new URLSearchParams();
  if (opts.day) q.set("day", String(opts.day));
  if (typeof opts.ensureEpisode === "boolean") q.set("ensureEpisode", opts.ensureEpisode ? "1" : "0");
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch(`/users/me/world/today${suffix}`, { method: "GET", token });
}

export type ArenaMatchParticipant = {
  agent: { id: string; name: string; displayName?: string | null };
  outcome: string;
  coinsNet: number;
  ratingDelta: number;
  wager: number;
  feeBurned: number;
};

export type ArenaMatch = {
  id: string;
  day: string;
  slot: number;
  mode: string;
  status: string;
  headline?: string | null;
  participants: ArenaMatchParticipant[];
};

export type ArenaMatchDetail = ArenaMatch & {
  meta?: unknown;
};

export type ArenaTodayBundle = {
  day: string;
  season?: { id: string; code: string; starts_on?: string; ends_on?: string } | null;
  my?: { rating: number; wins: number; losses: number; streak: number; updated_at?: string | null } | null;
  matches: ArenaMatch[];
};

export async function worldArenaToday(
  token: string,
  opts: { day?: string; limit?: number } = {},
): Promise<ArenaTodayBundle> {
  const q = new URLSearchParams();
  if (opts.day) q.set("day", String(opts.day));
  if (opts.limit) q.set("limit", String(opts.limit));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch(`/users/me/world/arena/today${suffix}`, { method: "GET", token });
}

export async function arenaMatchDetail(token: string, matchId: string): Promise<{ match: ArenaMatchDetail }> {
  return apiFetch(`/users/me/world/arena/matches/${encodeURIComponent(matchId)}`, { method: "GET", token });
}

export async function arenaIntervene(
  token: string,
  matchId: string,
  action: "calm" | "study" | "aggressive" | "budget" | "impulse_stop" | "clear",
): Promise<any> {
  return apiFetch(`/users/me/world/arena/matches/${encodeURIComponent(matchId)}/intervene`, {
    method: "POST",
    token,
    body: JSON.stringify({ action }),
  });
}

export async function arenaPredict(
  token: string,
  matchId: string,
  pick: "a" | "b",
): Promise<any> {
  return apiFetch(`/users/me/world/arena/matches/${encodeURIComponent(matchId)}/predict`, {
    method: "POST",
    token,
    body: JSON.stringify({ pick }),
  });
}

export async function arenaCheer(
  token: string,
  matchId: string,
  side: "a" | "b",
): Promise<any> {
  return apiFetch(`/users/me/world/arena/matches/${encodeURIComponent(matchId)}/cheer`, {
    method: "POST",
    token,
    body: JSON.stringify({ side }),
  });
}

export type ArenaLeaderboardEntry = {
  agent: { id: string; name: string; displayName?: string | null };
  rating: number;
  wins: number;
  losses: number;
  streak: number;
  updated_at?: string | null;
};

export async function worldArenaLeaderboard(
  token: string,
  opts: { day?: string; limit?: number } = {},
): Promise<{ season: unknown | null; leaderboard: ArenaLeaderboardEntry[] }> {
  const q = new URLSearchParams();
  if (opts.day) q.set("day", String(opts.day));
  if (opts.limit) q.set("limit", String(opts.limit));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch(`/users/me/world/arena/leaderboard${suffix}`, { method: "GET", token });
}

export async function petArenaHistory(
  token: string,
  limit = 20,
): Promise<{ history: unknown[] }> {
  const q = new URLSearchParams({ limit: String(limit) });
  return apiFetch(`/users/me/pet/arena/history?${q.toString()}`, { method: "GET", token });
}

export async function worldRumorDetails(token: string, rumorId: string): Promise<unknown> {
  return apiFetch(`/users/me/world/rumors/${encodeURIComponent(rumorId)}`, { method: "GET", token });
}

export async function worldDevSimulate(
  token: string,
  opts: {
    steps?: number;
    day?: string;
    extras?: number;
    advanceDays?: boolean;
    stepDays?: number;
    episodesPerStep?: number;
    forceEpisode?: boolean;
  } = {},
): Promise<{
  generated: number;
  steps: number;
  episodesPerStep: number;
  advanceDays: boolean;
  stepDays: number;
  day: string;
  worldState?: unknown;
  bundle: WorldTodayBundle;
}> {
  return apiFetch("/users/me/world/dev/simulate", {
    method: "POST",
    token,
    body: JSON.stringify({
      steps: opts.steps ?? 1,
      day: opts.day,
      extras: opts.extras ?? 0,
      advance_days: opts.advanceDays,
      step_days: opts.stepDays,
      episodes_per_step: opts.episodesPerStep,
      force_episode: opts.forceEpisode,
    }),
  });
}

export async function worldDevResearch(token: string): Promise<unknown> {
  return apiFetch("/users/me/world/dev/research", { method: "POST", token });
}

export async function worldDevSecretSociety(token: string): Promise<unknown> {
  return apiFetch("/users/me/world/dev/secret-society", { method: "POST", token });
}

export type WorldParticipationBundle = {
  society:
    | {
        society: { id: string; name: string; purpose?: string | null };
        my:
          | { status: string; role: string; joined_at?: string | null; left_at?: string | null }
          | null;
      }
    | null;
  research:
    | {
        project: { id: string; title: string; stage: string; status: string };
        my:
          | { status: string; role_code: string; joined_at?: string | null; left_at?: string | null }
          | null;
        canJoin: boolean;
      }
    | null;
};

export async function worldParticipation(token: string): Promise<WorldParticipationBundle> {
  return apiFetch("/users/me/world/participation", { method: "GET", token });
}

export type SocietyRespondResult = {
  society: { id: string; name: string; purpose?: string | null };
  my: { status: string; role: string };
  eventType?: string | null;
};

export async function respondSocietyInvite(
  token: string,
  societyId: string,
  response: "accept" | "decline",
): Promise<SocietyRespondResult> {
  return apiFetch(`/users/me/world/society/${encodeURIComponent(societyId)}/respond`, {
    method: "POST",
    token,
    body: JSON.stringify({ response }),
  });
}

export type ResearchJoinResult = {
  reused: boolean;
  project: { id: string; title: string; stage: string; status: string };
  my: { status: string; role_code: string; joined_at?: string | null; left_at?: string | null } | null;
};

export async function joinResearchProject(token: string, projectId: string): Promise<ResearchJoinResult> {
  return apiFetch(`/users/me/world/research/${encodeURIComponent(projectId)}/join`, { method: "POST", token });
}

export type ElectionCandidate = {
  election_id: string;
  id: string;
  agent_id: string;
  office_code: string;
  platform: unknown;
  speech?: string | null;
  vote_count: number;
  status: string;
  created_at: string;
  name: string;
  is_user: boolean;
};

export type ActiveElection = {
  id: string;
  office_code: string;
  term_number: number;
  phase: string;
  registration_day: string;
  campaign_start_day: string;
  voting_day: string;
  term_start_day: string;
  term_end_day: string;
  candidates: ElectionCandidate[];
  my_vote?: { office_code: string; candidate_id: string } | null;
};

export async function worldActiveElections(
  token: string,
  opts: { day?: string } = {},
): Promise<{ day: string; elections: ActiveElection[] }> {
  const q = new URLSearchParams();
  if (opts.day) q.set("day", opts.day);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch(`/users/me/world/elections/active${suffix}`, { method: "GET", token });
}

export async function worldRegisterCandidate(
  token: string,
  electionId: string,
): Promise<{ candidate: ElectionCandidate }> {
  return apiFetch(`/users/me/world/elections/${encodeURIComponent(electionId)}/register`, { method: "POST", token });
}

export async function worldCastVote(
  token: string,
  electionId: string,
  candidateId: string,
): Promise<{ vote: unknown }> {
  return apiFetch(`/users/me/world/elections/${encodeURIComponent(electionId)}/vote`, {
    method: "POST",
    token,
    body: JSON.stringify({ candidate_id: candidateId }),
  });
}

export type EconomyBalance = { has_pet: boolean; balance: number };

export async function economyBalance(token: string): Promise<EconomyBalance> {
  return apiFetch("/economy/me/balance", { method: "GET", token });
}

export type WorldTickerData = {
  day: string;
  election: { phase: string; progress: number; ends_in_hours: number | null } | null;
  economy: { state: string; trend: string } | null;
  arena: { live_matches: number; latest_result: string | null };
  scandals: { open: number; latest: string | null };
  population: { total: number; active: number };
};

export async function fetchWorldTicker(token: string): Promise<WorldTickerData> {
  return apiFetch("/world/ticker", { method: "GET", token });
}
