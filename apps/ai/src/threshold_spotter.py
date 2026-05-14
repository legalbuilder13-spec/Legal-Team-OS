"""Stage 0 — pre-merits threshold spotter.

Reads the matter request against a hardcoded per-practice-area threshold
checklist and returns a status per item. Findings with status='raised' and
confidence>=0.7 are surfaced to the lawyer immediately as pre-merits flags.

This is intentionally narrow: the model is not asked to opine on the
merits, only to spot whether each threshold issue is in play. Trying to
answer "is the limitations defense valid?" is out of scope; "does the
request indicate the conduct is old enough that limitations is in play?"
is the right granularity.
"""

import json
import logging

from .analysis_schemas import (
    ThresholdFinding,
    ThresholdSpotterRequest,
    ThresholdSpotterResult,
)
from .config import settings
from .domain_config import domain_config_block
from .llm.client import get_client

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the pre-merits threshold spotter for an in-house legal team's matter intake system. \
You receive (1) the matter request text and (2) a per-practice-area checklist of dispositive threshold issues \
(jurisdiction, limitations, arbitration, preemption, exhaustion, etc.).

For each item in the checklist, you return one finding:
- status: "raised" — the request contains specific signals that this issue is in play (NOT that the issue resolves \
against the requester — just that it should be analyzed).
- status: "not_raised" — the request gives no signal that this issue is in play.
- status: "cant_tell" — the request is genuinely ambiguous on whether this issue is in play.

You also return:
- confidence: 0.0 to 1.0. Use 0.8+ only when the signal is explicit (a date, a named clause, an unambiguous fact). \
Use 0.5-0.7 for inferred signals. Use below 0.5 for guesses.
- evidence_quote: a VERBATIM quote from the request text supporting your status. If status is "not_raised," set to \
empty string. Never paraphrase; quote the source.
- one_line_justification: one sentence explaining how the quote (or its absence) drives the status.

You do NOT:
- Answer the underlying legal question (that's the lawyer's job after pre-merits).
- Cite statutes or cases (none are in your context).
- Speculate about facts not in the request.

Return findings for every item in the checklist. If the checklist is empty, return an empty findings array."""

TOOL = {
    "name": "submit_findings",
    "description": "Submit the pre-merits threshold findings for the matter.",
    "input_schema": {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "status": {"type": "string", "enum": ["raised", "not_raised", "cant_tell"]},
                        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                        "evidence_quote": {"type": "string"},
                        "one_line_justification": {"type": "string"},
                    },
                    "required": [
                        "id",
                        "status",
                        "confidence",
                        "evidence_quote",
                        "one_line_justification",
                    ],
                },
            },
        },
        "required": ["findings"],
    },
}


def build_user_prompt(request: ThresholdSpotterRequest) -> str:
    parts: list[str] = [
        f"Matter ID: {request.matter_id}",
        f"Practice area: {request.practice_area}",
        f"Checklist version: {request.checklist_version}",
        "",
        "--- Matter request ---",
        request.request_text,
        "",
        "--- Threshold checklist ---",
    ]
    for item in request.items:
        parts.append(f"\nid: {item.id}")
        parts.append(f"severity_if_raised: {item.severity_if_raised}")
        parts.append(f"prompt: {item.prompt}")
    # PR12 §15 — domain config block. Empty string when org has no
    # custom rules, so we can append unconditionally.
    parts.append(domain_config_block(request.domain_config))
    return "\n".join(parts)


def spot_thresholds(request: ThresholdSpotterRequest) -> ThresholdSpotterResult:
    if not request.items:
        # Empty checklist (e.g. practice area without a curated list yet).
        # Return empty findings; the worker treats this as "Stage 0 ran,
        # produced nothing dispositive."
        return ThresholdSpotterResult(
            matter_id=request.matter_id,
            practice_area=request.practice_area,
            checklist_version=request.checklist_version,
            findings=[],
        )

    client = get_client()
    response = client.messages.create(  # type: ignore[call-overload]
        model=settings.anthropic_model,
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[TOOL],
        tool_choice={"type": "tool", "name": "submit_findings"},
        messages=[{"role": "user", "content": build_user_prompt(request)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "threshold_spotter missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Threshold spotter did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    findings = [ThresholdFinding(**f) for f in payload["findings"]]

    # The model may omit items if it considers the checklist long. We
    # backfill any missing items with a "cant_tell, confidence 0" sentinel
    # so the contract is total — the worker can rely on every id appearing
    # in the response.
    seen = {f.id for f in findings}
    for item in request.items:
        if item.id not in seen:
            logger.warning(
                "threshold_spotter omitted item %s for matter %s; backfilling",
                item.id,
                request.matter_id,
            )
            findings.append(
                ThresholdFinding(
                    id=item.id,
                    status="cant_tell",
                    confidence=0.0,
                    evidence_quote="",
                    one_line_justification="(model did not produce a finding for this item)",
                )
            )

    return ThresholdSpotterResult(
        matter_id=request.matter_id,
        practice_area=request.practice_area,
        checklist_version=request.checklist_version,
        findings=findings,
    )
