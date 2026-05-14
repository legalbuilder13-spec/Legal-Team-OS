import json
import logging

from pydantic import BaseModel, Field

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)

ENRICH_SYSTEM_PROMPT = """You are an analyst building behavioral profiles of counterparties \
for an in-house legal team. You are given the history of legal matters with a single \
counterparty — titles, summaries, notes, and timestamps — and extract patterns that will \
help future attorneys handle new matters with this counterparty more efficiently.

Extract concisely:
- negotiation_positions: array of topics this counterparty cares about, with their typical \
position vs. ours and the outcome of the most recent matter on that topic. Examples: \
"liability cap" (theirs: uncapped, ours: 2x ACV, last outcome: 3x ACV mutual). Include \
only topics that came up in 2+ matters or were materially negotiated.
- response_latency_days: typical days from initial outreach to substantive reply. Estimate \
from matter timestamps and notes; null if unclear.
- escalation_frequency: float [0, 1] — fraction of matters that escalated (DNR, complaint, \
threatened suit, etc.). 0 if no escalations evident.
- executive_involvement: 'high' / 'medium' / 'low' / 'unknown'. High = their executives \
typically join calls or sign documents directly. Low = handled at staff level.
- summary: 1-2 sentence narrative summarizing what an attorney should know going in.

Base everything strictly on the provided matter history. Do not invent patterns. If a \
field can't be answered from the data, return null or 'unknown' as appropriate."""


class EnrichRequest(BaseModel):
    counterparty_id: str
    counterparty_name: str
    matters: list[dict]  # title, summary, practice_area, status, created_at, closed_at
    notes: list[dict]  # matter_short_id, body, source, created_at


class NegotiationPosition(BaseModel):
    topic: str
    their_position: str | None = None
    our_position: str | None = None
    last_outcome: str | None = None


class EnrichResult(BaseModel):
    counterparty_id: str
    summary: str = Field(min_length=1)
    negotiation_positions: list[NegotiationPosition] = []
    response_latency_days: float | None = None
    escalation_frequency: float = Field(ge=0.0, le=1.0)
    executive_involvement: str  # 'high' | 'medium' | 'low' | 'unknown'


ENRICH_TOOL = {
    "name": "submit_enrichment",
    "description": "Submit the behavioral profile for the counterparty.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "minLength": 1},
            "negotiation_positions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string"},
                        "their_position": {"type": ["string", "null"]},
                        "our_position": {"type": ["string", "null"]},
                        "last_outcome": {"type": ["string", "null"]},
                    },
                    "required": ["topic"],
                },
            },
            "response_latency_days": {"type": ["number", "null"]},
            "escalation_frequency": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "executive_involvement": {
                "type": "string",
                "enum": ["high", "medium", "low", "unknown"],
            },
        },
        "required": [
            "summary",
            "negotiation_positions",
            "response_latency_days",
            "escalation_frequency",
            "executive_involvement",
        ],
    },
}


def _build_user_prompt(request: EnrichRequest) -> str:
    parts = [f"Counterparty: {request.counterparty_name}", ""]
    parts.append(f"--- Matter history ({len(request.matters)} matters) ---")
    for m in request.matters[:25]:
        line = (
            f"[{m.get('practice_area', '?')}/{m.get('status', '?')}] "
            f"{m.get('title', '(no title)')} "
            f"(created {m.get('created_at', '?')[:10]})"
        )
        if m.get("closed_at"):
            line += f" (closed {m['closed_at'][:10]})"
        parts.append(line)
        if m.get("summary"):
            parts.append(f"  {m['summary'][:300]}")

    if request.notes:
        parts.append("")
        parts.append(f"--- Notes ({len(request.notes)} notes) ---")
        for n in request.notes[:50]:
            shortid = n.get("matter_short_id", "?")
            src = n.get("source", "?")
            body = (n.get("body") or "")[:300]
            parts.append(f"[{shortid}/{src}] {body}")

    return "\n".join(parts)


def enrich_counterparty(request: EnrichRequest) -> EnrichResult:
    client = get_client()
    user_prompt = _build_user_prompt(request)

    response = client.messages.create(  # type: ignore[call-overload]
        model=settings.anthropic_model,
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": ENRICH_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[ENRICH_TOOL],
        tool_choice={"type": "tool", "name": "submit_enrichment"},
        messages=[{"role": "user", "content": user_prompt}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        raise RuntimeError("enrich model did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    return EnrichResult(
        counterparty_id=request.counterparty_id,
        summary=payload["summary"],
        negotiation_positions=[
            NegotiationPosition(**p) for p in payload.get("negotiation_positions", [])
        ],
        response_latency_days=payload.get("response_latency_days"),
        escalation_frequency=payload["escalation_frequency"],
        executive_involvement=payload["executive_involvement"],
    )
