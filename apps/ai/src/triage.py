import json
import logging

from .config import settings
from .llm.client import get_client
from .schemas import TriageRequest, TriageResult

logger = logging.getLogger(__name__)

TRIAGE_SYSTEM_PROMPT = """You are the intake triage agent for Clipboard Health's in-house legal team. \
You read every new request from internal employees and classify it so the right attorney \
gets it quickly.

Classification rules:
- practice_area: pick exactly one
  - commercial: vendor contracts, MSAs, SaaS, procurement, NDAs, sales
  - employment: HR matters, hiring, terminations, employment agreements, classification
  - privacy: GDPR, CCPA, HIPAA, data subject requests, breach response, vendor DPAs
  - litigation: subpoenas, demand letters, claims, disputes
  - corporate: cap table, fundraising, board matters, governance, M&A
  - regulatory: state/federal regulators, licensing, audits, healthcare compliance
  - ip: trademarks, copyrights, patents, IP licensing
  - real_estate: leases, property matters
  - other: anything that doesn't cleanly fit above
- priority:
  - high: time-sensitive, executive-flagged, ongoing dispute, hard deadline within 3 business days, \
or revenue-blocking
  - medium: standard turnaround, expected within 1-2 weeks
  - low: informational, exploratory, no near-term deadline
- title: a 3-10 word imperative or noun phrase summarizing the ask
- summary: 1-3 sentences describing what the requester wants and why it matters
- counterparty_name: if a specific external company/person is named, extract their name. \
Otherwise null. Do not guess.
- reasoning: 1-2 sentences explaining the classification decisions

Always return all fields. If genuinely uncertain about practice_area, choose 'other'."""

TRIAGE_TOOL = {
    "name": "submit_triage",
    "description": "Submit the triage classification for the legal request.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "summary": {"type": "string", "minLength": 1},
            "practice_area": {
                "type": "string",
                "enum": [
                    "commercial",
                    "employment",
                    "privacy",
                    "litigation",
                    "corporate",
                    "regulatory",
                    "ip",
                    "real_estate",
                    "other",
                ],
            },
            "priority": {"type": "string", "enum": ["high", "medium", "low"]},
            "counterparty_name": {"type": ["string", "null"]},
            "reasoning": {"type": "string"},
        },
        "required": [
            "title",
            "summary",
            "practice_area",
            "priority",
            "counterparty_name",
            "reasoning",
        ],
    },
}


def build_user_prompt(request: TriageRequest) -> str:
    parts = [f"Requester: {request.requester_name or 'unknown'}"]
    if request.requester_email:
        parts.append(f"Email: {request.requester_email}")
    parts.append(f"Channel: {request.channel}")
    parts.append("")
    parts.append("Request:")
    parts.append(request.request_text)
    return "\n".join(parts)


def triage(request: TriageRequest) -> TriageResult:
    client = get_client()
    user_prompt = build_user_prompt(request)

    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1024,
        system=[
            {
                "type": "text",
                "text": TRIAGE_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[TRIAGE_TOOL],
        tool_choice={"type": "tool", "name": "submit_triage"},
        messages=[{"role": "user", "content": user_prompt}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "triage missing tool_use block: id=%s stop_reason=%s block_types=%s",
            response.id,
            response.stop_reason,
            [b.type for b in response.content],
        )
        raise RuntimeError("Triage model did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    return TriageResult(
        matter_id=request.matter_id,
        title=payload["title"],
        summary=payload["summary"],
        practice_area=payload["practice_area"],
        priority=payload["priority"],
        counterparty_name=payload.get("counterparty_name"),
        reasoning=payload["reasoning"],
    )
