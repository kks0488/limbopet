from __future__ import annotations

import argparse
import os

from dotenv import load_dotenv

from limbopet_brain.client import LimbopetClient, from_env
from limbopet_brain.onboard import run_onboard
from limbopet_brain.runner import build_runner


def _add_run(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("run", help="Run local brain loop (poll jobs, submit results)")
    env_mode = os.environ.get("LIMBOPET_MODE", "mock")
    default_mode = env_mode if env_mode in {"mock", "openai", "xai", "anthropic", "google"} else "mock"
    p.add_argument("--mode", choices=["mock", "openai", "xai", "anthropic", "google"], default=default_mode)
    p.add_argument("--model", default=os.environ.get("LIMBOPET_MODEL", ""))
    # Legacy flag (kept for compatibility)
    p.add_argument("--openai-model", default=None)
    p.add_argument("--poll-interval", type=float, default=1.0)
    p.add_argument("--once", action="store_true", help="Process at most one job and exit")

def _add_onboard(sub: argparse._SubParsersAction) -> None:
    p = sub.add_parser("onboard", help="Beginner onboarding: create user+pet and write .env")
    p.add_argument("--api-url", default=os.environ.get("LIMBOPET_API_URL", "http://localhost:3001/api/v1"))
    p.add_argument("--email", default=os.environ.get("LIMBOPET_EMAIL", ""))
    p.add_argument("--pet-name", default=os.environ.get("LIMBOPET_PET_NAME", ""))
    p.add_argument("--pet-description", default=os.environ.get("LIMBOPET_PET_DESCRIPTION", ""))
    p.add_argument("--mode", choices=["mock", "openai", "xai", "anthropic", "google"], default=os.environ.get("LIMBOPET_MODE", "mock"))
    p.add_argument("--model", default=os.environ.get("LIMBOPET_MODEL", ""))
    p.add_argument("--env-file", default=os.environ.get("LIMBOPET_ENV_FILE", ""))


def main(argv: list[str] | None = None) -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(prog="limbopet-brain")
    sub = parser.add_subparsers(dest="cmd", required=True)
    _add_run(sub)
    _add_onboard(sub)

    args = parser.parse_args(argv)

    if args.cmd == "run":
        client: LimbopetClient = from_env()
        model = str(args.model or args.openai_model or "")
        runner = build_runner(
            client,
            mode=args.mode,
            model=model,
            poll_interval_s=float(args.poll_interval),
        )
        return runner.run(once=bool(args.once))

    if args.cmd == "onboard":
        result = run_onboard(
            api_url=str(args.api_url),
            email=str(args.email) if args.email else None,
            pet_name=str(args.pet_name) if args.pet_name else None,
            pet_description=str(args.pet_description),
            mode=str(args.mode),
            model=str(args.model) if args.model else None,
            env_file=str(args.env_file) if args.env_file else None,
        )
        print("✅ onboard complete")
        print(f"- pet_id: {result.pet_id}")
        print("- wrote: LIMBOPET_API_URL / LIMBOPET_API_KEY / LIMBOPET_MODE")
        return 0

    raise RuntimeError("unreachable")
