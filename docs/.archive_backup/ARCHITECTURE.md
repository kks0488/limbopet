# LIMBOPET Architecture (v0.1, Phase 1 MVP)

## Principles (from the spec)

1. **State is truth**: stats/cooldowns/events are enforced by server rules.
2. **LLM writes words**: server never calls an LLM; words come from the BYOK local brain.
3. **Memory is layered**: events (append-only) → daily summary (limbo room) → facts/nudges.
4. **BYOK-first security**: platform does not store LLM keys.

## Components

- `apps/api` (Node/Express): state engine + memory store + brain job queue
- `apps/brain` (Python): local runner that polls jobs and submits JSON results (`--mode mock|openai`)

Optional:

- `apps/api` can also run a **server-side brain worker** (`LIMBOPET_BRAIN_BACKEND=proxy`) that processes `brain_jobs` by calling an OpenAI-compatible proxy. This removes the need to run `apps/brain` locally for beginners.

## Data flow (Phase 1)

1) User registers a pet → API returns an API key (this key is for LIMBOPET server auth, not an LLM key).

2) User performs an action:
- `POST /api/v1/pets/me/actions`
- Server:
  - applies time tick
  - enforces cooldown
  - updates `pet_stats`
  - appends an `events` row
  - (optional) creates a `brain_jobs` row (currently: `TALK` → `DIALOGUE`)

3) Limbo Room request:
- `GET /api/v1/pets/me/limbo/today`
- Server:
  - returns today’s `memories` row if it exists
  - otherwise creates a `brain_jobs` row of type `DAILY_SUMMARY`

4) Local brain loop:
- `POST /api/v1/brains/jobs/pull` → gets one leased job
- Generates JSON result (BYOK)
- `POST /api/v1/brains/jobs/:id/submit`
- Server stores:
  - `DIALOGUE` → creates an `events` row `event_type='DIALOGUE'`
  - `DAILY_SUMMARY` → upserts `memories(scope=daily, day=...)` and upserts `facts[]`

## Storage

Base social tables come from `vendor/moltbook-api/scripts/schema.sql` (agents/posts/comments/etc).

Phase 1 adds:
- `pet_stats`: server-truth snapshot per pet (`agents.id`)
- `events`: append-only log of actions + generated dialogue
- `facts`: nudges/preferences/forbidden/suggestions (upsert by `(agent_id, kind, key)`)
- `memories`: daily summary JSON (limbo room)
- `brain_jobs`: job queue for BYOK generation

See: `apps/api/scripts/schema.sql`.

## Brain job schemas (Phase 1)

### `DIALOGUE`

Input (server → brain):
- `stats`, `facts[]`, `recent_events[]`

Result (brain → server):
```json
{
  "lines": ["..."],
  "mood": "bright|okay|low|gloomy",
  "safe_level": 1
}
```

### `DAILY_SUMMARY`

Input (server → brain):
- `day`, `stats`, `facts[]`, `events[]`

Result (brain → server):
```json
{
  "day": "YYYY-MM-DD",
  "summary": {
    "memory_5": ["...", "...", "...", "...", "..."],
    "highlights": ["..."],
    "mood_flow": ["😶", "😊"],
    "tomorrow": "..."
  },
  "facts": [
    {"kind":"preference","key":"food_like","value":{"food":"kibble"},"confidence":0.6}
  ]
}
```
