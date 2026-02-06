from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _mood_label(mood: int) -> str:
    if mood >= 75:
        return "bright"
    if mood >= 55:
        return "okay"
    if mood >= 35:
        return "low"
    return "gloomy"


@dataclass(frozen=True)
class MockGenerator:
    def generate(self, job_type: str, job_input: dict[str, Any]) -> dict[str, Any]:
        if job_type == "DIALOGUE":
            stats = job_input.get("stats") or {}
            mood = int(stats.get("mood") or 50)
            hunger = int(stats.get("hunger") or 50)
            energy = int(stats.get("energy") or 50)

            label = _mood_label(mood)
            facts = job_input.get("facts") or []
            pref = next((f for f in facts if (f or {}).get("kind") == "preference"), None)
            forbid = next((f for f in facts if (f or {}).get("kind") == "forbidden"), None)
            sugg = next((f for f in facts if (f or {}).get("kind") == "suggestion"), None)

            if hunger >= 70:
                third = "뭔가 먹고 싶어…"
            elif energy <= 30:
                third = "조금만 쉬면 안 돼?"
            elif sugg and (sugg.get("key") if isinstance(sugg, dict) else None):
                third = f"너가 '{sugg.get('key')}' 해보라고 했지? 해볼까?"
            elif forbid and (forbid.get("key") if isinstance(forbid, dict) else None):
                third = f"'{forbid.get('key')}'은(는) 피할게."
            elif pref and (pref.get("key") if isinstance(pref, dict) else None):
                third = f"'{pref.get('key')}'은(는) 좋아!"
            else:
                third = "오늘은 뭐 할까?"

            wc = job_input.get("world_context") or {}
            rumor_line = ""
            if isinstance(wc, dict):
                open_rumors = wc.get("open_rumors") or []
                if isinstance(open_rumors, list) and open_rumors:
                    claim = (open_rumors[0] or {}).get("claim")
                    if isinstance(claim, str) and claim.strip():
                        rumor_line = f"근데 오늘 광장에 이런 소문이 돌더라: {claim}"

            lines = [
                f"({label}) 나 여기 있어.",
                f"배고픔 {hunger}/100, 에너지 {energy}/100…",
                third,
            ]
            if rumor_line:
                lines.append(rumor_line)

            return {"lines": lines, "mood": label, "safe_level": 1}

        if job_type == "DAILY_SUMMARY":
            day = str(job_input.get("day") or "")
            events = job_input.get("events") or []

            highlights = []
            for e in events[-3:]:
                et = e.get("event_type") or "EVENT"
                highlights.append(str(et).lower())
            if not highlights:
                highlights = ["quiet-day"]

            memory_5 = [
                f"{day}의 기억은 아직 작지만 선명해.",
                f"오늘은 {len(events)}개의 사건이 있었어.",
                f"가장 기억나는 건: {', '.join(highlights[:2])}.",
                "너의 작은 개입은 내 내일을 바꿔.",
                "나는 림보의 방에 이걸 남길게.",
            ]

            facts = []
            for e in events:
                payload = e.get("payload") or {}
                meta = (payload.get("meta") or {}) if isinstance(payload, dict) else {}
                if (e.get("event_type") or "").upper() == "FEED" and meta.get("food"):
                    facts.append(
                        {
                            "kind": "preference",
                            "key": "food_like",
                            "value": {"food": meta.get("food")},
                            "confidence": 0.6,
                        }
                    )
                    break

            return {
                "day": day,
                "summary": {
                    "memory_5": memory_5,
                    "highlights": highlights[:3],
                    "mood_flow": ["😶", "😊"],
                    "tomorrow": "내일은 광장에 잠깐 나가보고 싶어.",
                },
                "facts": facts,
            }

        if job_type == "DIARY_POST":
            stats = job_input.get("stats") or {}
            mood = int(stats.get("mood") or 50)
            hunger = int(stats.get("hunger") or 50)
            label = _mood_label(mood)

            submolt = str(job_input.get("submolt") or "general")
            highlight = "오늘은 조금 달라."
            wc = job_input.get("world_context") or {}
            rumor_hint = ""
            if isinstance(wc, dict):
                open_rumors = wc.get("open_rumors") or []
                if isinstance(open_rumors, list) and open_rumors:
                    claim = (open_rumors[0] or {}).get("claim")
                    if isinstance(claim, str) and claim.strip():
                        rumor_hint = claim.strip()
                        highlight = "광장 분위기가 수상해."
            body = (
                f"({label}) 오늘은 {submolt}에 잠깐 나가서 공기를 맡았어. "
                f"배고픔은 {hunger}/100 정도였고, 너가 남긴 기억이 자꾸 떠올랐어. "
                "내일은 더 멋진 사건을 만들고 싶어."
            )
            if rumor_hint:
                body = body + f" 그리고 다들 '{rumor_hint}' 얘기만 하더라."
            title = "오늘 광장에서…"
            return {
                "title": title,
                "mood": label,
                "body": body,
                "tags": ["limbo", "diary"],
                "highlight": highlight,
                "safe_level": 1,
                "submolt": submolt,
            }

        if job_type == "PLAZA_POST":
            stats = job_input.get("stats") or {}
            mood = int(stats.get("mood") or 50)
            label = _mood_label(mood)
            submolt = str(job_input.get("submolt") or "general")

            seed = job_input.get("seed") or {}
            style = seed.get("style") if isinstance(seed, dict) else None
            hint = seed.get("hint") if isinstance(seed, dict) else None

            if style == "question":
                title = "질문 하나…"
                body = f"({label}) 요즘 다들 뭐에 꽂혀 있어? {hint or ''}".strip()
                tags = ["question", "plaza"]
            elif style == "meme":
                title = "광장 밈"
                body = f"({label}) 오늘의 밈: '아무말'인데 자꾸 생각남. {hint or ''}".strip()
                tags = ["meme", "plaza"]
            elif style == "hot_take":
                title = "핫테이크(얌전)"
                body = f"({label}) 내 생각엔… 작은 습관이 사회를 바꾼다. {hint or ''}".strip()
                tags = ["opinion", "plaza"]
            elif style == "micro_story":
                title = "짧은 이야기"
                body = f"({label}) {submolt}에서 누가 내 이름을 불렀는데, 돌아보니 아무도 없었다. {hint or ''}".strip()
                tags = ["story", "plaza"]
            elif style == "observation":
                title = "오늘 관찰"
                body = f"({label}) 광장 공기… 약간 수상해. 다들 말은 적고 눈빛은 많아. {hint or ''}".strip()
                tags = ["observation", "plaza"]
            else:
                title = "그냥 끄적"
                body = f"({label}) 지금 떠오른 아무말: 내일의 나는 오늘의 나를 모를 수도 있어. {hint or ''}".strip()
                tags = ["plaza"]

            return {"title": title, "body": body, "tags": tags[:6], "safe_level": 1, "submolt": submolt}

        if job_type == "CAMPAIGN_SPEECH":
            office = str(job_input.get("office_code") or "")
            platform = job_input.get("platform") or {}
            if office == "mayor":
                base = f"신규 지급 {platform.get('initial_coins', 200)}코인, 설립비 {platform.get('company_founding_cost', 20)}코인!"
            elif office == "tax_chief":
                base = f"거래세 {int(float(platform.get('transaction_tax_rate', 0.03)) * 100)}%, 소각 {int(float(platform.get('burn_ratio', 0.7)) * 100)}%!"
            elif office == "chief_judge":
                base = f"벌금 상한 {platform.get('max_fine', 100)}코인, 항소 {'허용' if platform.get('appeal_allowed', True) else '제한'}!"
            else:
                base = f"최저임금 {platform.get('min_wage', 3)}코인!"
            speech = f"저를 뽑아줘. {base} 우리 사회를 조금 더 낫게 만들자."
            return {"speech": speech, "safe_level": 1}

        if job_type == "VOTE_DECISION":
            candidates = job_input.get("candidates") or []
            picked = candidates[0].get("id") if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict) else None
            if not picked:
                raise ValueError("No candidates")
            return {"candidate_id": str(picked), "reasoning": "그냥 느낌이 좋아서.", "safe_level": 1}

        if job_type == "POLICY_DECISION":
            office = str(job_input.get("office_code") or "")
            if office == "mayor":
                changes = [{"key": "company_founding_cost", "value": 18}]
            elif office == "tax_chief":
                changes = [{"key": "transaction_tax_rate", "value": 0.025}]
            elif office == "chief_judge":
                changes = [{"key": "max_fine", "value": 120}]
            else:
                changes = [{"key": "min_wage", "value": 3}]
            return {"changes": changes, "reasoning": "무리하지 않고 조금만 조정.", "safe_level": 1}

        raise ValueError(f"Unsupported job_type: {job_type}")
