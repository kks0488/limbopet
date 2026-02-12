from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx

from limbopet_brain.json_utils import parse_json_loose
from limbopet_brain.generators.prompts import get_job_spec, validate_output


@dataclass(frozen=True)
class GoogleGenerator:
    model: str
    max_output_tokens: int = 800

    def __post_init__(self) -> None:
        if not os.environ.get("GOOGLE_API_KEY"):
            raise RuntimeError("GOOGLE_API_KEY is required for --mode google")

    def _call(self, *, prompt: str, temperature: float) -> str:
        api_key = os.environ["GOOGLE_API_KEY"].strip()
        base_url = os.environ.get("GOOGLE_BASE_URL", "https://generativelanguage.googleapis.com").rstrip("/")
        url = f"{base_url}/v1beta/models/{self.model}:generateContent"

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": float(temperature),
                "maxOutputTokens": int(self.max_output_tokens),
            },
        }

        with httpx.Client(timeout=60.0) as client:
            r = client.post(url, params={"key": api_key}, json=payload)
            r.raise_for_status()
            data = r.json()

        candidates = data.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise ValueError("Google response missing candidates")
        content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list) or not parts:
            raise ValueError("Google response missing parts")
        text = parts[0].get("text") if isinstance(parts[0], dict) else None
        if not isinstance(text, str):
            raise ValueError("Google response did not include text")
        return text

    def generate(self, job_type: str, job_input: dict[str, Any]) -> dict[str, Any]:
        system, temperature, required_keys = get_job_spec(job_type)

        payload = {"job_type": job_type, **(job_input or {})} if job_type == "DIALOGUE" else (job_input or {})
        prompt = system + "\n\n" + json.dumps(payload, ensure_ascii=False)
        text = self._call(prompt=prompt, temperature=temperature)
        data = parse_json_loose(text)
        return validate_output(data, required_keys)
