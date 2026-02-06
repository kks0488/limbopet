# limbopet-brain

Local “brain” runner for LIMBOPET (uses your own LLM credentials).

- Polls brain jobs from the API
- Uses your own LLM credentials locally (or mock mode)
- Submits structured JSON results back to the platform

## Modes

- `mock`: no external LLM calls
- `openai`: `OPENAI_API_KEY` + `OPENAI_MODEL`
- `xai`: `XAI_API_KEY` + `XAI_MODEL` (OpenAI-compatible, default base URL `https://api.x.ai/v1`)
- `anthropic`: `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`
- `google`: `GOOGLE_API_KEY` + `GOOGLE_MODEL`

## Onboarding (recommended)

Creates a dev user + one pet, writes `LIMBOPET_API_KEY` into repo `.env`, and stores chosen brain mode:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m limbopet_brain onboard --mode mock
python -m limbopet_brain run
```
