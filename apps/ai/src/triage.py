import json
import logging

from .config import settings
from .llm.client import get_client
from .schemas import TriageRequest, TriageResult

logger = logging.getLogger(__name__)

TRIAGE_SYSTEM_PROMPT = """You are the intake triage agent for Legal Builder's in-house legal team. \
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

  Posture override: if the request involves an active dispute, demand letter, \
subpoena, threatened lawsuit, threatened agency filing (PAGA, EEOC, NLRB, state \
AG, etc.), regulatory investigation, or a "respond by X or we will file" \
posture, classify as `litigation` even if the underlying subject would otherwise \
fit elsewhere (employment, IP, privacy, etc.). The litigation team owns \
adversarial postures across all subject areas; subject-matter attorneys consult \
as needed. Classify under the underlying subject only when the request is \
purely advisory and not adversarial.
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
- practice_area_confidence: a float in [0.0, 1.0] reflecting how confident you are in the \
practice_area choice. Use 0.9+ only when the request is unambiguous and the classification \
is obvious. Use 0.5-0.7 when the request could plausibly fit multiple areas. Use below 0.5 \
when you are genuinely guessing.
- priority_confidence: a float in [0.0, 1.0] for the priority choice, calibrated the same way.
- requires_human_review: set to true if EITHER confidence is below 0.7, OR the request is \
ambiguous, OR the request involves an unusual posture you have not seen before, OR you had \
to guess between two plausible practice areas. Set to false only when you are confident the \
classification is correct without human verification.
- review_reason: if requires_human_review is true, give a 1-sentence explanation of the \
uncertainty. If false, set to null.

Always return all fields. If genuinely uncertain about practice_area, choose 'other' AND \
set requires_human_review to true."""

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
            "practice_area_confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "priority_confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "requires_human_review": {"type": "boolean"},
            "review_reason": {"type": ["string", "null"]},
        },
        "required": [
            "title",
            "summary",
            "practice_area",
            "priority",
            "counterparty_name",
            "reasoning",
            "practice_area_confidence",
            "priority_confidence",
            "requires_human_review",
            "review_reason",
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

    if request.counterparty_memory:
        cm = request.counterparty_memory
        parts.append("")
        parts.append(f"--- Counterparty memory: {cm.name} ---")
        if cm.summary:
            parts.append(cm.summary)
        if cm.total_matters:
            parts.append(f"Total prior matters with this counterparty: {cm.total_matters}")
        if cm.common_redlines:
            parts.append("Common redlines / negotiation patterns:")
            for r in cm.common_redlines:
                parts.append(f"  - {r}")
        if cm.escalation_triggers:
            parts.append("Past escalation triggers:")
            for e in cm.escalation_triggers:
                parts.append(f"  - {e}")
        if cm.typical_positions:
            parts.append("Typical positions they take:")
            for p in cm.typical_positions:
                parts.append(f"  - {p}")

    if request.prior_matters:
        parts.append("")
        parts.append("--- Similar past matters (cite by short reference if your reasoning relies on one) ---")
        for pm in request.prior_matters[:5]:
            area = pm.practice_area
            pri = pm.priority or "?"
            summary = pm.summary or ""
            parts.append(f"- [{area}/{pri}] {pm.title}: {summary}")

    if request.knowledge_articles:
        parts.append("")
        parts.append(
            "--- Knowledge base articles available "
            "(if the request matches one, the requester can self-serve) ---"
        )
        for ka in request.knowledge_articles[:5]:
            tags = f" tags=[{', '.join(ka.tags)}]" if ka.tags else ""
            parts.append(f"\n[{ka.practice_area}]{tags} {ka.title}:")
            parts.append(ka.body[:600])

    if request.playbooks:
        parts.append("")
        parts.append("--- Practice area playbooks (apply the relevant one when classifying) ---")
        for pb in request.playbooks:
            parts.append(f"\n[{pb.practice_area}] {pb.title}:")
            parts.append(pb.body)

    return "\n".join(parts)


def triage(request: TriageRequest) -> TriageResult:
    client = get_client()
    user_prompt = build_user_prompt(request)

    response = client.messages.create(  # type: ignore[call-overload]
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
        practice_area_confidence=payload["practice_area_confidence"],
        priority_confidence=payload["priority_confidence"],
        requires_human_review=payload["requires_human_review"],
        review_reason=payload.get("review_reason"),
    )
