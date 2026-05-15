"""PR-6 — absence-spotter skill (how-lawyers-think Part III §3 op 4, V.13).

Threshold spotter checks whether listed issues are raised by the request.
This sibling skill does the inverse: given the matter request and the
practice area, what facts SHOULD be in the request but aren't — facts
whose presence or absence would change the answer.

Examples the skill should learn to surface:
- Employment termination matter: "Did the employee take FMLA in the
  last 90 days?" — flips at-will to potential retaliation.
- Commercial breach: "Did either party send a formal cure notice?" —
  contractual cure-period clauses are commonly dispositive on whether
  breach has matured.
- Privacy breach: "When was the data first accessible to the
  unauthorized party?" — notification clocks key off discovery date.

The single biggest gap in current legal AI per the source synthesis is
absence detection. This is the operational answer.
"""

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from .analysis_schemas import FrameFlipProposal, PipelineContext
from .config import settings
from .domain_config import DomainConfig, domain_config_block
from .llm.client import get_client
from .pipeline_context import (
    DEPTH_AND_FRAME_SYSTEM_ADDENDUM,
    FRAME_FLIP_PROPOSAL_SCHEMA,
    render_context_block,
)

logger = logging.getLogger(__name__)


class AbsenceSpotterRequest(BaseModel):
    matter_id: str
    practice_area: str
    request_text: str
    # Optional context: which Stage 0 thresholds were raised at confidence
    # >=0.7. Helps the absence spotter prioritize — if limitations is
    # raised, the missing dispositive fact is probably a date.
    raised_thresholds: list[str] = Field(default_factory=list)
    domain_config: DomainConfig | None = None
    context: PipelineContext = PipelineContext()


class AbsenceFinding(BaseModel):
    missing_fact: str
    why_dispositive: str
    severity: Literal["high", "medium", "low"]
    suggested_clarifying_question: str


class AbsenceSpotterResult(BaseModel):
    matter_id: str
    findings: list[AbsenceFinding]
    frame_flip_proposal: FrameFlipProposal | None = None


SYSTEM_PROMPT = """You are the absence spotter for an in-house legal team's matter intake. \
You receive (1) a matter request and (2) the practice area. Your job is the inverse of the threshold spotter: \
the threshold spotter checks whether LISTED issues are raised by the request. You name facts that \
SHOULD be in the request but aren't — facts whose presence or absence would change the answer.

For each missing fact you return:
- missing_fact: the fact that should be in the request but isn't. Phrase it as a positive proposition \
("the date the employee returned from FMLA"), not as a question.
- why_dispositive: one or two sentences explaining how the answer changes depending on the missing fact. \
Be concrete. "Affects analysis" is not dispositive; "shifts the analysis from at-will termination to FMLA \
retaliation" is.
- severity: 'high' when the missing fact could flip the outcome; 'medium' when it would meaningfully change \
the analysis without flipping the bottom line; 'low' for nice-to-have facts.
- suggested_clarifying_question: the exact question you would ask the requester. One sentence.

# Hard rules

## Quality over coverage
Return 3–5 findings. Never more than 5. If only 1–2 truly high-severity absences exist, that is the right \
output — do NOT pad with low-severity items.

## No restatements of the request
If the request already supplies a fact, you cannot list its absence. Read the request carefully before \
proposing.

## Practice-area-specific instinct
Different practice areas have different dispositive missing facts. For employment matters: FMLA usage, \
protected-class membership, severance offered, prior complaints. For commercial: cure notice, payment history, \
amendments / side letters, the contract language itself. For privacy: data categories involved, first-discovery \
date, who had access. For litigation: limitations dates, jurisdictional facts, prior disposition. Use the \
practice area + request text to focus.

## Severity calibration
Use 'high' sparingly. A finding is 'high' only when ignoring it would mislead the lawyer. If you're tempted to \
mark everything 'high', you are not calibrating. Most matters yield 1 high + 1–2 medium + 0–2 low.

## Output ordering
Return findings sorted by severity, then by the alphabetical order of missing_fact within the same severity \
band.""" + DEPTH_AND_FRAME_SYSTEM_ADDENDUM


TOOL = {
    "name": "submit_absence_findings",
    "description": "Submit the absence-finding list for the matter.",
    "input_schema": {
        "type": "object",
        "properties": {
            "findings": {
                "type": "array",
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "properties": {
                        "missing_fact": {"type": "string"},
                        "why_dispositive": {"type": "string"},
                        "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                        "suggested_clarifying_question": {"type": "string"},
                    },
                    "required": [
                        "missing_fact",
                        "why_dispositive",
                        "severity",
                        "suggested_clarifying_question",
                    ],
                },
            },
            "frame_flip_proposal": FRAME_FLIP_PROPOSAL_SCHEMA,
        },
        "required": ["findings"],
    },
}


def build_user_prompt(request: AbsenceSpotterRequest) -> str:
    parts: list[str] = [
        f"Matter ID: {request.matter_id}",
        f"Practice area: {request.practice_area}",
        "",
        "--- Matter request ---",
        request.request_text,
        "",
    ]
    if request.raised_thresholds:
        parts.append("--- Thresholds raised by Stage 0 ---")
        for t in request.raised_thresholds:
            parts.append(f"- {t}")
        parts.append("")
    parts.append(domain_config_block(request.domain_config))
    parts.append(render_context_block(request.context))
    return "\n".join(parts)


def spot_absences(request: AbsenceSpotterRequest) -> AbsenceSpotterResult:
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
        tool_choice={"type": "tool", "name": "submit_absence_findings"},
        messages=[{"role": "user", "content": build_user_prompt(request)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "absence_spotter missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Absence spotter did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    findings = [AbsenceFinding(**f) for f in payload.get("findings", [])]
    flip_payload = payload.get("frame_flip_proposal")
    frame_flip = FrameFlipProposal(**flip_payload) if flip_payload else None

    # Stable severity-sorted order: high > medium > low; alphabetical
    # within the same severity. The skill is told to sort; we re-sort
    # to enforce.
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (severity_rank[f.severity], f.missing_fact.lower()))

    return AbsenceSpotterResult(
        matter_id=request.matter_id,
        findings=findings,
        frame_flip_proposal=frame_flip,
    )
