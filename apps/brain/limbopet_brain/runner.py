from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Protocol

from limbopet_brain.client import LimbopetClient
from limbopet_brain.generators.mock import MockGenerator
from limbopet_brain.generators.anthropic_gen import AnthropicGenerator
from limbopet_brain.generators.google_gen import GoogleGenerator
from limbopet_brain.generators.openai_gen import OpenAICompatibleGenerator


class Generator(Protocol):
    def generate(self, job_type: str, job_input: dict[str, Any]) -> dict[str, Any]: ...


@dataclass(frozen=True)
class Runner:
    client: LimbopetClient
    generator: Generator
    poll_interval_s: float = 1.0

    def run(self, *, once: bool = False) -> int:
        backoff = self.poll_interval_s
        max_backoff = 30.0
        while True:
            try:
                job = self.client.pull_job()
            except Exception as e:  # noqa: BLE001
                print(f"⚠️ pull_job failed: {e}, retry in {backoff:.0f}s")
                time.sleep(backoff)
                backoff = min(backoff * 2, max_backoff)
                if once:
                    return 1
                continue

            backoff = self.poll_interval_s

            if not job:
                if once:
                    return 0
                time.sleep(self.poll_interval_s)
                continue

            job_id = str(job.get("id"))
            job_type = str(job.get("job_type"))
            job_input = job.get("input") or {}

            try:
                result = self.generator.generate(job_type, job_input)
                self.client.submit_job(job_id, status="done", result=result)
                print(f"✅ done {job_type} {job_id}")
            except Exception as e:  # noqa: BLE001
                print(f"❌ failed {job_type} {job_id}: {e}")
                try:
                    self.client.submit_job(job_id, status="failed", error=str(e))
                except Exception as submit_err:  # noqa: BLE001
                    print(f"⚠️ submit_job(failed) also failed: {submit_err}")

            if once:
                return 0


def build_runner(client: LimbopetClient, *, mode: str, model: str, poll_interval_s: float) -> Runner:
    if mode == "mock":
        gen: Generator = MockGenerator()
    elif mode == "openai":
        resolved = model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        base_url = os.environ.get("OPENAI_BASE_URL") or None
        gen = OpenAICompatibleGenerator(model=resolved, api_key_env="OPENAI_API_KEY", base_url=base_url)
    elif mode == "xai":
        resolved = model or os.environ.get("XAI_MODEL", "grok-2-latest")
        base_url = os.environ.get("XAI_BASE_URL", "https://api.x.ai/v1").rstrip("/")
        gen = OpenAICompatibleGenerator(model=resolved, api_key_env="XAI_API_KEY", base_url=base_url)
    elif mode == "anthropic":
        resolved = model or os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")
        gen = AnthropicGenerator(model=resolved)
    elif mode == "google":
        resolved = model or os.environ.get("GOOGLE_MODEL", "gemini-1.5-flash")
        gen = GoogleGenerator(model=resolved)
    elif mode == "proxy":
        # Route through CLIProxyAPI (OpenAI-compatible endpoint)
        resolved = model or os.environ.get("CLIPROXY_MODEL", "gemini-2.5-flash")
        proxy_url = os.environ.get("CLIPROXY_BASE_URL", "http://127.0.0.1:8317").rstrip("/") + "/v1"
        gen = OpenAICompatibleGenerator(model=resolved, api_key_env="CLIPROXY_API_KEY", base_url=proxy_url)
    else:
        raise ValueError("mode must be one of: mock, openai, xai, anthropic, google, proxy")

    return Runner(client=client, generator=gen, poll_interval_s=poll_interval_s)
