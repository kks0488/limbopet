# OpenClaw reuse notes (for LIMBOPET)

OpenClaw is a **personal AI assistant** with strong onboarding and a mature “models + auth profiles” system.
We reuse *patterns* and selectively extract code later (MIT license).

## What we want from OpenClaw

### 1) Beginner onboarding

Goal: “초보자도 5분 안에 펫 만들고, 브레인 연결하고, 하루 요약이 뜬다”.

OpenClaw patterns to reuse:
- Wizard flow: provider selection → auth choice → confirmation
- Safety notice + connection explanation screens
- Pairing flows (QR-based) patterns (optional for future channels)

Reference files:
- macOS onboarding pages: `vendor/openclaw/apps/macos/Sources/OpenClaw/OnboardingView+Pages.swift`
- QR onboarding utilities: `vendor/openclaw/src/web/login-qr.ts`
- WhatsApp onboarding flow: `vendor/openclaw/src/channels/plugins/onboarding/whatsapp.ts`

### 2) Model providers + auth profiles (OAuth or keys)

Goal: users can bring **OpenAI / Claude / Gemini / Grok** with either:
- API keys (fast path)
- OAuth / token credentials (cost optimization, “subscription auth” style)

OpenClaw patterns to reuse:
- `auth-profiles.json` store: multiple profiles per provider, rotation order, oauth/token/api_key modes
- Provider registry: provider baseUrl + headers + model catalog
- Credential resolution: profile → env → models.json

Reference files:
- auth config types: `vendor/openclaw/src/config/types.auth.ts`
- model config types: `vendor/openclaw/src/config/types.models.ts`
- model auth resolution: `vendor/openclaw/src/agents/model-auth.ts`
- auth profile store: `vendor/openclaw/src/agents/auth-profiles/store.ts`
- CLI credential import (Codex/Claude/etc): `vendor/openclaw/src/agents/cli-credentials.ts`

### 3) “Pet == secretary” runtime

Goal: pet can grow from “tamagotchi” into “assistant” by adding skills/tools.

OpenClaw patterns to reuse later:
- Tool streaming + sandboxing
- Skills packaging + install gating

Reference directories:
- skills platform: `vendor/openclaw/skills`
- tool/runtime glue: `vendor/openclaw/src/agents/*`, `vendor/openclaw/src/plugins/*`

## Why we don’t fully embed OpenClaw in Phase 1

Phase 1 prioritizes predictable game loop + strict JSON outputs (jobs). OpenClaw is a full assistant stack; we integrate it gradually to avoid scope explosion.

