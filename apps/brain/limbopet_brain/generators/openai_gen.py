from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from limbopet_brain.json_utils import parse_json_loose
from limbopet_brain.generators.prompts import get_job_spec, validate_output


@dataclass(frozen=True)
class OpenAICompatibleGenerator:
    model: str
    api_key_env: str = "OPENAI_API_KEY"
    base_url: str | None = None

    def __post_init__(self) -> None:
        api_key = os.environ.get(self.api_key_env, "").strip()
        if not api_key:
            raise RuntimeError(f"{self.api_key_env} is required for OpenAI-compatible mode")

    def _client(self) -> OpenAI:
        api_key = os.environ.get(self.api_key_env, "").strip()
        return OpenAI(api_key=api_key, base_url=self.base_url)

    def generate(self, job_type: str, job_input: dict[str, Any]) -> dict[str, Any]:
        system, temperature, required_keys = get_job_spec(job_type)
        client = self._client()

        payload = {"job_type": job_type, **(job_input or {})} if job_type == "DIALOGUE" else (job_input or {})
        user = json.dumps(payload, ensure_ascii=False)

        msg = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=temperature,
        )
        raw = msg.choices[0].message.content or "{}"
        data = parse_json_loose(raw)
        return validate_output(data, required_keys)
