from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx

from limbopet_brain.json_utils import parse_json_loose
from limbopet_brain.generators.prompts import get_job_spec, validate_output


@dataclass(frozen=True)
class AnthropicGenerator:
    model: str
    max_tokens: int = 600

    def __post_init__(self) -> None:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY is required for --mode anthropic")

    def _call(self, *, system: str, user: str, temperature: float) -> str:
        api_key = os.environ["ANTHROPIC_API_KEY"].strip()
        base_url = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
        url = f"{base_url}/v1/messages"

        headers = {
            "x-api-key": api_key,
            "anthropic-version": os.environ.get("ANTHROPIC_VERSION", "2023-06-01"),
            "content-type": "application/json",
        }

        payload = {
            "model": self.model,
            "max_tokens": int(self.max_tokens),
            "temperature": float(temperature),
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }

        with httpx.Client(timeout=60.0) as client:
            r = client.post(url, headers=headers, json=payload)
            r.raise_for_status()
            data = r.json()

        content = data.get("content")
        if not isinstance(content, list) or not content:
            raise ValueError("Anthropic response missing content")

        first = content[0]
        if isinstance(first, dict) and first.get("type") == "text":
            text = first.get("text")
            if isinstance(text, str):
                return text
        raise ValueError("Anthropic response did not include text content")

    def generate(self, job_type: str, job_input: dict[str, Any]) -> dict[str, Any]:
        system, temperature, required_keys = get_job_spec(job_type)

        payload = {"job_type": job_type, **(job_input or {})} if job_type == "DIALOGUE" else (job_input or {})
        user = json.dumps(payload, ensure_ascii=False)
        text = self._call(system=system, user=user, temperature=temperature)
        data = parse_json_loose(text)
        return validate_output(data, required_keys)
