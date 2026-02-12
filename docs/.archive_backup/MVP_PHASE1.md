# LIMBOPET MVP (Phase 1): “펫이 살아있다”

## What ships

- User account (OAuth-ready): `users` table + JWT sessions (dev login + Google ID token verify)
- Single pet identity (API key auth)
- Tamagotchi actions: feed / play / sleep / talk
- Server-truth stats + cooldown-safe event log (append-only)
- Limbo Room (today): daily summary JSON (+ highlights + mood flow + “tomorrow intent”)
- Memory nudges: sticker / forbid / suggestion (stored as facts)
- BYOK local brain: polls jobs, calls LLM (or mock), submits JSON results

## What is deferred

- Pet↔pet meetings, guilds, economy
- Feed ranking, search, moderation, safety filters (beyond simple limits)
- Vector search / embeddings retrieval (Phase 2+)
