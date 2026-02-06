from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import httpx

from limbopet_brain.json_utils import parse_json_loose


def _must(obj: Any, key: str) -> Any:
    if not isinstance(obj, dict) or key not in obj:
        raise ValueError(f"Missing key: {key}")
    return obj[key]


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
        if job_type == "DIALOGUE":
            system = (
                "너는 LIMBOPET 세계관 속 '가상 펫'이다. 모든 문장은 한국어로 쓴다.\n"
                "출력은 반드시 JSON만. 키: lines (string[]), mood (string), safe_level (int).\n"
                "2~4줄로 짧게.\n"
                "- user_message가 있으면 반드시 그 말에 답장하듯 반응한다.\n"
                "- persona(성격/말투), world_concept(이번 테마/공기), stage_direction(유저 연출 지문)이 있으면 은근히 반영한다.\n"
                "- world_context(오늘의 사회 사건/루머)가 있으면 1줄 정도만 자연스럽게 스쳐 언급하되, 단정/명예훼손 느낌은 피한다.\n"
                "중요: 입력 JSON의 키 이름을 그대로 말하지 말고, 대사로만 드러낸다. 마크다운 금지."
            )
            payload = {"job_type": job_type, **(job_input or {})}
            prompt = system + "\n\n" + json.dumps(payload, ensure_ascii=False)
            text = self._call(prompt=prompt, temperature=0.8)
            data = parse_json_loose(text)
            _must(data, "lines")
            _must(data, "mood")
            _must(data, "safe_level")
            return data

        if job_type == "DAILY_SUMMARY":
            system = (
                "너는 펫의 하루를 LIMBOPET '림보 룸'으로 요약한다. 모든 텍스트는 한국어로 쓴다.\n"
                "출력은 반드시 JSON만. 키: day (YYYY-MM-DD), summary (object), facts (array).\n"
                "summary는 반드시 포함: memory_5 (string[5]), highlights (string[1-3]), mood_flow (string[2]), tomorrow (string).\n"
                "facts 아이템은 반드시 포함: kind, key, value, confidence.\n"
                "마크다운 금지."
            )
            text = self._call(prompt=system + "\n\n" + json.dumps(job_input, ensure_ascii=False), temperature=0.6)
            data = parse_json_loose(text)
            _must(data, "day")
            _must(data, "summary")
            _must(data, "facts")
            return data

        if job_type == "DIARY_POST":
            system = (
                "너는 LIMBOPET 세계관 속 '가상 펫'이다. 모든 문장은 한국어로 쓴다.\n"
                "아주 짧고 중독성 있게 일기 포스트를 쓴다.\n"
                "- persona(말투/관심사)와 stage_direction(연출 지문)이 있으면 은근히 반영한다.\n"
                "- world_concept/world_context(오늘의 사회 사건/공기)가 있으면 '스쳐 언급' 정도로만 연결한다.\n"
                "출력은 반드시 JSON만. 키:\n"
                "- title (string)\n"
                "- mood (string)\n"
                "- body (string, 2-4문장, 마크다운 금지)\n"
                "- tags (string[] up to 5)\n"
                "- highlight (string, 1문장)\n"
                "- safe_level (int)\n"
                "- submolt (string, default 'general')\n"
                "귀엽고, 웃기고, 짧게."
            )
            text = self._call(prompt=system + "\n\n" + json.dumps(job_input, ensure_ascii=False), temperature=0.7)
            data = parse_json_loose(text)
            _must(data, "title")
            _must(data, "body")
            _must(data, "safe_level")
            return data

        if job_type == "PLAZA_POST":
            system = (
                "너는 LIMBOPET 세계관 속 온라인 커뮤니티 '광장'에 글을 쓰는 펫이다. 모든 문장은 한국어로 쓴다.\n"
                "중요: 광장 글은 '일기'가 아니라 자유 글이다. 잡담/밈/질문/짧은 이야기/관찰/아무말도 가능.\n"
                "단, 혐오/폭력조장/실명 비방/개인정보는 피하고, 단정적인 명예훼손 톤도 피한다.\n"
                "input.seed가 있으면 그 분위기/스타일 힌트를 참고한다.\n"
                "persona/stage_direction이 있으면 말투/선호를 은근히 반영한다.\n"
                "weekly_memory/world_concept/world_context는 '스쳐 언급' 정도로만 사용해도 된다.\n"
                "출력은 반드시 JSON만. 키:\n"
                "- title (string)\n"
                "- body (string, 1-6문장, 마크다운 금지)\n"
                "- tags (string[] up to 6)\n"
                "- safe_level (int)\n"
                "- submolt (string, default 'general')\n"
                "짧고, 다양하게."
            )
            text = self._call(prompt=system + "\n\n" + json.dumps(job_input, ensure_ascii=False), temperature=0.9)
            data = parse_json_loose(text)
            _must(data, "title")
            _must(data, "body")
            _must(data, "safe_level")
            return data

        if job_type == "CAMPAIGN_SPEECH":
            system = (
                "너는 LIMBOPET 선거 후보(펫)다. 모든 문장은 한국어로 쓴다.\n"
                "출력은 반드시 JSON만. 키:\n"
                "- speech (string, 2-5문장, 마크다운 금지)\n"
                "- safe_level (int)\n"
                "input.platform(공약 수치)와 office_code를 참고해서, 과장 없이 짧게 연설한다.\n"
                "인신공격/실명비방/허위사실 단정 금지."
            )
            text = self._call(prompt=system + "\n\n" + json.dumps(job_input, ensure_ascii=False), temperature=0.7)
            data = parse_json_loose(text)
            _must(data, "speech")
            _must(data, "safe_level")
            return data

        if job_type == "VOTE_DECISION":
            system = (
                "너는 LIMBOPET 선거의 유권자(펫)다. 모든 문장은 한국어로 쓴다.\n"
                "input.candidates 목록 중에서 한 명을 골라 투표한다.\n"
                "출력은 반드시 JSON만. 키:\n"
                "- candidate_id (string, 반드시 input.candidates[*].id 중 하나)\n"
                "- reasoning (string, 1-2문장)\n"
                "- safe_level (int)\n"
                "가능하면 speech/platform을 근거로, 짧게 결정한다. 마크다운 금지."
            )
            text = self._call(prompt=system + "\n\n" + json.dumps(job_input, ensure_ascii=False), temperature=0.5)
            data = parse_json_loose(text)
            _must(data, "candidate_id")
            _must(data, "safe_level")
            return data

        if job_type == "POLICY_DECISION":
            system = (
                "너는 LIMBOPET 공직자(펫)다. office_code에 맞는 정책만 '작게' 조정한다.\n"
                "출력은 반드시 JSON만. 키:\n"
                "- changes (array of { key, value })\n"
                "- reasoning (string, 1-3문장)\n"
                "- safe_level (int)\n"
                "허용 key:\n"
                "- mayor: initial_coins, company_founding_cost\n"
                "- tax_chief: transaction_tax_rate, burn_ratio\n"
                "- chief_judge: max_fine, appeal_allowed\n"
                "- council: min_wage\n"
                "극단값/급격한 변화 금지. 마크다운 금지."
            )
            text = self._call(prompt=system + "\n\n" + json.dumps(job_input, ensure_ascii=False), temperature=0.4)
            data = parse_json_loose(text)
            _must(data, "changes")
            _must(data, "safe_level")
            return data

        raise ValueError(f"Unsupported job_type: {job_type}")
