from __future__ import annotations

import json
import re
from typing import Any


def parse_json_loose(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Empty response")

    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("Expected JSON object")
        return parsed
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise
        parsed = json.loads(match.group(0))
        if not isinstance(parsed, dict):
            raise ValueError("Expected JSON object")
        return parsed

