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
    EscalationRequest,
    FrameFlipProposal,
    ThresholdFinding,
    ThresholdSpotterRequest,
    ThresholdSpotterResult,
)
from .config import settings
from .domain_config import domain_config_block
from .llm.client import get_client
from .pipeline_context import (
    DEPTH_AND_FRAME_SYSTEM_ADDENDUM,
    ESCALATION_REQUEST_SCHEMA,
    FRAME_FLIP_PROPOSAL_SCHEMA,
    render_context_block,
)

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

# Three-strategy negative-result discipline (PR-10)
When you return status='not_raised' for an item where severity_if_raised is 'high', you MUST populate \
`not_raised_basis` with at least three independent evidence channels you checked:
- 'explicit_text' — references in the request text itself (verbatim quotes or paraphrased facts).
- 'temporal' — dates, sequences, or time-based signals (or their absence).
- 'conduct' — counterparty actions, party communications, or third-party signals (or their absence).
- 'absence_of_signal' — facts a competent requester would mention if this issue were in play.

For each channel, set `evidence` (one short sentence on what you looked for) and `checked` (true/false). \
If you cannot honestly mark three channels as checked, you do not have a high-confidence 'not_raised'. \
Downgrade to 'cant_tell' rather than overclaim.

Return findings for every item in the checklist. If the checklist is empty, return an empty findings array.

# Out-of-distribution detection (PR-6)
After producing findings, assess whether this matter is actually in the practice area it was routed to. \
Examples: a 'commercial' matter that's actually 80% a HIPAA breach belongs in 'privacy'; an 'employment' \
matter dominated by a stock-option vesting dispute belongs in 'corporate'. Return practice_area_confidence \
in [0,1] (1.0 = clearly correct area, 0.5 = mixed, <0.5 = misrouted). When confidence is below 0.6, set \
suggested_reroute to one of: commercial, employment, privacy, litigation, corporate, regulatory, ip, \
real_estate, other; otherwise null. reroute_rationale: one short sentence explaining the call.""" + DEPTH_AND_FRAME_SYSTEM_ADDENDUM

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
                        # PR-10 — required for high-severity not_raised.
                        "not_raised_basis": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "channel": {
                                        "type": "string",
                                        "enum": [
                                            "explicit_text",
                                            "temporal",
                                            "conduct",
                                            "absence_of_signal",
                                        ],
                                    },
                                    "evidence": {"type": "string"},
                                    "checked": {"type": "boolean"},
                                },
                                "required": ["channel", "evidence", "checked"],
                            },
                        },
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
            # PR-A — opt-in. Model emits when carried frame is wrong.
            "frame_flip_proposal": FRAME_FLIP_PROPOSAL_SCHEMA,
            # PR-6 — out-of-distribution detection.
            "practice_area_confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "suggested_reroute": {
                "type": ["string", "null"],
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
                    None,
                ],
            },
            "reroute_rationale": {"type": ["string", "null"]},
            "escalation_request": ESCALATION_REQUEST_SCHEMA,
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
    # PR-A — pipeline context (research_depth + carried doctrinal_frame).
    parts.append(render_context_block(request.context))
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
    flip_payload = payload.get("frame_flip_proposal")
    frame_flip = FrameFlipProposal(**flip_payload) if flip_payload else None

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

    esc_payload = payload.get("escalation_request")
    escalation = EscalationRequest(**esc_payload) if esc_payload else None

    return ThresholdSpotterResult(
        matter_id=request.matter_id,
        practice_area=request.practice_area,
        checklist_version=request.checklist_version,
        findings=findings,
        frame_flip_proposal=frame_flip,
        practice_area_confidence=float(payload.get("practice_area_confidence", 1.0)),
        suggested_reroute=payload.get("suggested_reroute"),
        reroute_rationale=payload.get("reroute_rationale"),
        escalation_request=escalation,
    )
