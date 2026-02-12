export type ApiErrorPayload = {
  success?: boolean;
  error?: string;
  code?: string;
  hint?: string;
};

let _onGlobalAuthError: (() => void) | null = null;
export function setGlobalAuthErrorHandler(handler: (() => void) | null) {
  _onGlobalAuthError = handler;
}

const DEFAULT_API_URL = "http://localhost:3001/api/v1";
const FETCH_TIMEOUT_MS = 15_000;

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
  opts: RequestInit & { token?: string; timeoutMs?: number } = {},
): Promise<T> {
  const url = `${apiUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = new Headers(opts.headers || {});
  headers.set("Content-Type", "application/json");
  if (opts.token) {
    headers.set("Authorization", `Bearer ${opts.token}`);
  }

  const { token: _, timeoutMs, ...fetchOpts } = opts;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs ?? FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...fetchOpts, headers, signal: controller.signal });
    if (!res.ok) {
      let body: ApiErrorPayload | null = null;
      try {
        body = (await res.json()) as ApiErrorPayload;
      } catch {
        // ignore
      }
      if (res.status === 401 || res.status === 403) {
        if (_onGlobalAuthError) _onGlobalAuthError();
      }
      const msg = body?.error || `HTTP ${res.status}`;
      const code = (body as any)?.code ? `[${(body as any).code}] ` : "";
      const hint = body?.hint ? ` (${body.hint})` : "";
      throw new Error(`${code}${msg}${hint}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("요청 시간이 초과되었습니다");
    }
    throw err;
  } finally {
    clearTimeout(tid);
  }
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

export type UserPromptProfile = {
  enabled: boolean;
  prompt_text: string;
  version: number;
  updated_at?: string | null;
  connected: boolean;
};

export async function getMyPromptProfile(token: string): Promise<{ profile: UserPromptProfile }> {
  return apiFetch("/users/me/prompt-profile", { method: "GET", token });
}

export async function setMyPromptProfile(
  token: string,
  input: { enabled: boolean; prompt_text: string },
): Promise<{ profile: UserPromptProfile }> {
  return apiFetch("/users/me/prompt-profile", { method: "PUT", token, body: JSON.stringify(input) });
}

export async function deleteMyPromptProfile(token: string): Promise<{ ok: boolean }> {
  return apiFetch("/users/me/prompt-profile", { method: "DELETE", token });
}

export async function setMyBrainProfile(
  token: string,
  input: { provider: string; model: string; api_key: string; base_url?: string | null },
): Promise<{ profile: UserBrainProfile }> {
  return apiFetch("/users/me/brain", { method: "POST", token, body: JSON.stringify(input), timeoutMs: 60_000 });
}

export async function startGeminiOauth(token: string): Promise<{ url: string }> {
  return apiFetch("/users/me/brain/oauth/google/start", { method: "POST", token });
}

export async function deleteMyBrainProfile(token: string): Promise<{ ok: boolean }> {
  return apiFetch("/users/me/brain", { method: "DELETE", token });
}

export type BrainJobSummary = {
  id: string;
  agent_id: string;
  job_type: string;
  status: "pending" | "leased" | "done" | "failed";
  retry_count?: number;
  retryable?: boolean;
  last_error_code?: string | null;
  last_error_at?: string | null;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  finished_at?: string | null;
};

export async function listMyBrainJobs(
  token: string,
  opts: { status?: "pending" | "leased" | "done" | "failed"; type?: string; limit?: number } = {},
): Promise<{ jobs: BrainJobSummary[] }> {
  const q = new URLSearchParams();
  if (opts.status) q.set("status", opts.status);
  if (opts.type) q.set("type", String(opts.type).trim().toUpperCase());
  if (opts.limit) q.set("limit", String(opts.limit));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch(`/users/me/brain/jobs${suffix}`, { method: "GET", token });
}

export async function retryMyBrainJob(token: string, jobId: string): Promise<{ job: BrainJobSummary }> {
  return apiFetch(`/users/me/brain/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST", token });
}

export async function brainProxyConnect(
  token: string,
  provider: string,
): Promise<{ url: string; state: string; provider: string }> {
  return apiFetch(`/users/me/brain/proxy/connect/${encodeURIComponent(provider)}`, {
    method: "POST",
    token,
  });
}

export async function brainProxyStatus(
  token: string,
  state: string,
): Promise<{ status: "wait" | "ok" | "error" }> {
  return apiFetch(`/users/me/brain/proxy/status?state=${encodeURIComponent(state)}`, {
    method: "GET",
    token,
  });
}

export async function brainProxyComplete(
  token: string,
  provider: string,
): Promise<any> {
  return apiFetch("/users/me/brain/proxy/complete", {
    method: "POST",
    token,
    body: JSON.stringify({ provider }),
  });
}

export async function brainProxyModels(
  token: string,
): Promise<{ models: Array<{ id: string; name: string; provider: string }> }> {
  return apiFetch("/users/me/brain/proxy/models", { method: "GET", token });
}

export async function brainProxyAuthFiles(
  token: string,
): Promise<{ files: Array<{ provider: string; updated_at?: string }> }> {
  return apiFetch("/users/me/brain/proxy/auth-files", { method: "GET", token });
}

export async function brainProxyDisconnect(
  token: string,
  provider: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/users/me/brain/proxy/auth-files/${encodeURIComponent(provider)}`, {
    method: "DELETE",
    token,
  });
}

export async function createPlazaPostJob(
  token: string,
  submolt = "general",
): Promise<{ job: unknown; reused: boolean }> {
  return apiFetch("/users/me/pet/plaza-post", { method: "POST", token, body: JSON.stringify({ submolt }) });
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

export type ArenaTrainingWeights = {
  calm?: number;
  study?: number;
  aggressive?: number;
  budget?: number;
  impulse_stop?: number;
  dominant?: string[];
};

export type ArenaTrainingInfluenceSide = {
  weights?: ArenaTrainingWeights;
  base_nudge_count?: number;
  nudge_count?: number;
  coach_note_applied?: boolean;
  intervention?: string | null;
};

export type ArenaRecentMemoryRef = {
  kind?: string;
  text?: string;
  confidence?: number;
};

export type ArenaRecentMemoryInfluenceSide = {
  count?: number;
  score?: number;
  refs?: ArenaRecentMemoryRef[];
};

export type ArenaPromptProfileMeta = {
  enabled?: boolean;
  has_custom?: boolean;
  version?: number;
  updated_at?: string | null;
  source?: string;
};

export type ArenaMatchMeta = {
  headline?: string;
  mode_label?: string;
  recap_post_id?: string;
  near_miss?: string;
  nearMiss?: string;
  tags?: string[];
  rounds?: unknown[];
  cheer?: Record<string, unknown>;
  cast?: Record<string, unknown>;
  live?: Record<string, unknown>;
  stake?: Record<string, unknown>;
  predict?: Record<string, unknown> | null;
  training_influence?: {
    a?: ArenaTrainingInfluenceSide;
    b?: ArenaTrainingInfluenceSide;
  };
  recent_memory_influence?: {
    a?: ArenaRecentMemoryInfluenceSide;
    b?: ArenaRecentMemoryInfluenceSide;
  };
  prompt_profile?: {
    a?: ArenaPromptProfileMeta;
    b?: ArenaPromptProfileMeta;
  };
};

export type ArenaMatch = {
  id: string;
  day: string;
  slot: number;
  mode: string;
  status: string;
  headline?: string | null;
  participants: ArenaMatchParticipant[];
  meta?: ArenaMatchMeta;
};

export type ArenaMatchDetail = ArenaMatch & {
  meta?: ArenaMatchMeta;
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

export async function arenaChallenge(token: string, mode: string): Promise<any> {
  return apiFetch('/users/me/world/arena/challenge', {
    method: 'POST',
    token,
    body: JSON.stringify({ mode }),
  });
}

export async function arenaModeStats(token: string): Promise<{ stats: Record<string, { total: number; wins: number; losses: number; draws: number; winRate: number }> }> {
  return apiFetch('/users/me/pet/arena/mode-stats', { method: "GET", token });
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

export async function petArenaCourtCases(token: string): Promise<{ cases: unknown[]; stats: unknown[] }> {
  return apiFetch("/users/me/pet/arena/court-cases", { method: "GET", token });
}

export async function petArenaCourtVerdict(token: string, matchId: string): Promise<unknown> {
  return apiFetch(`/users/me/pet/arena/court-verdict/${encodeURIComponent(matchId)}`, { method: "GET", token });
}

export async function petArenaVote(
  token: string,
  matchId: string,
  vote: "fair" | "unfair",
): Promise<{ match_id: string; my_vote: string; vote_result: { fair: number; unfair: number; total: number } }> {
  return apiFetch(`/users/me/world/arena/matches/${encodeURIComponent(matchId)}/vote`, {
    method: "POST",
    token,
    body: JSON.stringify({ vote }),
  });
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
