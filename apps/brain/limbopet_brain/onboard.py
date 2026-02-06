from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


def _is_tty() -> bool:
    try:
        return sys.stdin.isatty()
    except Exception:  # noqa: BLE001
        return False


def _prompt(label: str, *, default: str | None = None) -> str:
    if not _is_tty():
        raise RuntimeError(f"Missing required value: {label} (run interactively or pass flags)")

    suffix = f" [{default}]" if default is not None and default != "" else ""
    value = input(f"{label}{suffix}: ").strip()
    return value if value else (default or "")


def _upsert_env(path: Path, updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()

    remaining = dict(updates)
    next_lines: list[str] = []

    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            next_lines.append(line)
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        if key in remaining:
            next_lines.append(f"{key}={remaining.pop(key)}")
        else:
            next_lines.append(line)

    for key, value in remaining.items():
        next_lines.append(f"{key}={value}")

    path.write_text("\n".join(next_lines).rstrip() + "\n", encoding="utf-8")


def _default_repo_root() -> Path:
    # .../apps/brain/limbopet_brain/onboard.py -> root is 3 parents up from limbopet_brain/
    return Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class OnboardResult:
    user_token: str
    pet_api_key: str
    pet_id: str


def dev_login(*, api_url: str, email: str) -> tuple[str, dict[str, Any]]:
    with httpx.Client(timeout=30.0) as client:
        r = client.post(f"{api_url}/auth/dev", json={"email": email})
        r.raise_for_status()
        data = r.json()
    return str(data["token"]), data.get("user") or {}


def create_pet(*, api_url: str, user_token: str, name: str, description: str) -> dict[str, Any]:
    with httpx.Client(timeout=30.0) as client:
        r = client.post(
            f"{api_url}/pets/create",
            headers={"Authorization": f"Bearer {user_token}"},
            json={"name": name, "description": description},
        )
        r.raise_for_status()
        return r.json()


def run_onboard(
    *,
    api_url: str | None = None,
    email: str | None = None,
    pet_name: str | None = None,
    pet_description: str | None = None,
    mode: str | None = None,
    model: str | None = None,
    env_file: str | None = None,
) -> OnboardResult:
    api_url = (api_url or os.environ.get("LIMBOPET_API_URL") or "http://localhost:3001/api/v1").rstrip("/")

    email = email or os.environ.get("LIMBOPET_EMAIL") or ""
    if not email:
        email = _prompt("Email (dev login)", default="me@example.com")

    pet_name = pet_name or os.environ.get("LIMBOPET_PET_NAME") or ""
    if not pet_name:
        pet_name = _prompt("Pet name (letters/numbers/_)", default="limbo")

    pet_description = pet_description if pet_description is not None else os.environ.get("LIMBOPET_PET_DESCRIPTION", "")

    # Provider selection is optional, but we store it for a no-flag run experience.
    mode = mode or os.environ.get("LIMBOPET_MODE") or ""
    if mode not in {"", "mock", "openai", "anthropic", "google", "xai"}:
        mode = ""
    if not mode:
        mode = _prompt("Brain mode (mock/openai/anthropic/google/xai)", default="mock")

    model = model if model is not None else os.environ.get("LIMBOPET_MODEL", "")
    if mode != "mock" and not model:
        model = _prompt("Model (optional)", default="")

    user_token, _user = dev_login(api_url=api_url, email=email)
    created = create_pet(api_url=api_url, user_token=user_token, name=pet_name, description=pet_description)

    pet_api_key = str((created.get("agent") or {}).get("api_key") or "")
    pet_id = str((created.get("pet") or {}).get("id") or "")
    if not pet_api_key:
        raise RuntimeError("Missing api_key in response from /pets/create")

    # Map mode -> provider key env var
    provider_key_env: dict[str, str] = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "google": "GOOGLE_API_KEY",
        "xai": "XAI_API_KEY",
    }
    provider_model_env: dict[str, str] = {
        "openai": "OPENAI_MODEL",
        "anthropic": "ANTHROPIC_MODEL",
        "google": "GOOGLE_MODEL",
        "xai": "XAI_MODEL",
    }

    updates: dict[str, str] = {
        "LIMBOPET_API_URL": api_url,
        "LIMBOPET_API_KEY": pet_api_key,
        "LIMBOPET_MODE": mode,
    }

    if model:
        env_key = provider_model_env.get(mode)
        if env_key:
            updates[env_key] = model

    if mode != "mock":
        key_env = provider_key_env.get(mode)
        if key_env and not os.environ.get(key_env, "").strip():
            secret = _prompt(f"{key_env} (paste key)", default="")
            if secret:
                updates[key_env] = secret

    # Write to root .env by default
    env_path = Path(env_file) if env_file else (_default_repo_root() / ".env")
    _upsert_env(env_path, updates)

    return OnboardResult(user_token=user_token, pet_api_key=pet_api_key, pet_id=pet_id)

