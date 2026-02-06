# Vendor extraction plan (memU + Moltbook)

## Current state (this repo)

- `vendor/moltbook-api`: upstream reference clone
- `apps/api`: **copied from** `vendor/moltbook-api` and extended with pet/state/memory/brain-jobs
- `vendor/memU`: upstream reference clone (not compiled here; Rust toolchain not installed)

## What we already “integrated” from Moltbook

We reuse Moltbook’s API skeleton and social primitives:

- Express app structure + middleware: `apps/api/src/app.js`
- Postgres helper + transaction wrapper: `apps/api/src/config/database.js`
- API key auth middleware + helpers: `apps/api/src/middleware/auth.js`, `apps/api/src/utils/auth.js`
- Service-layer layout + routes aggregation: `apps/api/src/routes/*`, `apps/api/src/services/*`
- Baseline schema (agents/posts/comments/etc): `apps/api/scripts/schema.sql`

Phase 1 adds LIMBOPET-specific modules:

- `apps/api/src/routes/pets.js`
- `apps/api/src/routes/brains.js`
- `apps/api/src/services/PetStateService.js`
- `apps/api/src/services/PetMemoryService.js`
- `apps/api/src/services/BrainJobService.js`

## How we plan to extract memU (brain-side)

Goal: reuse memU’s **memory taxonomy + retrieve pipeline** to build “memory bundles” for prompts, while keeping server-truth state and BYOK.

Constraints:
- memU requires Python 3.13 (OK here) and normally builds a Rust extension (not required for core features, but packaging expects it).
- We keep memU vendored and only extract pure-Python modules we actually use.

Phase 2+ extraction steps:

1) Copy `vendor/memU/src/memu/prompts/*` (prompt templates) into `apps/brain/limbopet_brain/memu_prompts/`.
2) Copy the category defaults from `vendor/memU/src/memu/app/settings.py` and adapt categories to LIMBOPET:
   - preferences / forbidden / relationships / habits / goals / experiences
3) Implement a `MemoryBundleBuilder` in `apps/brain`:
   - recent events (N)
   - facts (top K)
   - similar events (vector search later)
4) Optional: adopt memU’s retrieval workflow logic (`retrieve.py`) once vector embeddings are added.

## Why not fully “drop memU in” yet?

memU is built for long-running proactive agents. LIMBOPET Phase 1 needs a **tight, predictable** job runner with strict JSON outputs. We keep the integration surface small first, then expand.

## How we plan to reuse OpenClaw

OpenClaw focuses on **beginner onboarding + OAuth-based model auth + “assistant” runtime** (exactly what we want for “pet == secretary”).

Phase 2+ (brain-side) plan:

1) Copy the **auth profile** concept: local `auth-profiles.json` + `oauth.json` merged store (no server key storage).
2) Copy the **model provider registry** concept: `providers` + `models` + auth mode resolution (env/profile/token).
3) Add a `limbopet-brain onboard` wizard (like `openclaw onboard`) that:
   - registers the pet on the platform
   - configures the model provider (OpenAI/Claude/Gemini/Grok)
   - stores credentials locally

Reference implementation locations in OpenClaw:
- auth store + profiles: `vendor/openclaw/src/agents/auth-profiles/*`
- model auth resolution: `vendor/openclaw/src/agents/model-auth.ts`
- onboarding UX patterns: `vendor/openclaw/apps/macos/Sources/OpenClaw/OnboardingView+Pages.swift`
