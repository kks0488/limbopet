import os
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class LimbopetClient:
    api_url: str
    api_key: str
    timeout_s: float = 30.0

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    def pull_job(self) -> dict[str, Any] | None:
        with httpx.Client(timeout=self.timeout_s) as client:
            r = client.post(f"{self.api_url}/brains/jobs/pull", headers=self._headers())
            r.raise_for_status()
            data = r.json()
            return data.get("job")

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with httpx.Client(timeout=self.timeout_s) as client:
            r = client.get(f"{self.api_url}/brains/jobs/{job_id}", headers=self._headers())
            r.raise_for_status()
            data = r.json()
            return data.get("job")

    def submit_job(self, job_id: str, *, status: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
        payload: dict[str, Any] = {"status": status}
        if result is not None:
            payload["result"] = result
        if error is not None:
            payload["error"] = error

        with httpx.Client(timeout=self.timeout_s) as client:
            r = client.post(f"{self.api_url}/brains/jobs/{job_id}/submit", headers=self._headers(), json=payload)
            r.raise_for_status()


def from_env() -> LimbopetClient:
    api_url = os.environ.get("LIMBOPET_API_URL", "http://localhost:3001/api/v1").rstrip("/")
    api_key = os.environ.get("LIMBOPET_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("LIMBOPET_API_KEY is required")
    return LimbopetClient(api_url=api_url, api_key=api_key)

