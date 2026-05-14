"""M5 — Extract domain_config proposals from lawyer revisions.

Takes pairs of (original stage output text, lawyer's revised text) and
extracts recurring swaps the org should encode in their domain_config:
terminology rules (term A → term B), verb rules (verb X → verb Y),
high-scrutiny jurisdiction additions.

The worker calls this skill with N pairs at a time. Output is a list
of proposals; the worker writes them to domain_config_proposals as
pending. An admin reviews + applies via /admin/domain-config.

This is intentionally conservative: a swap must appear in ≥2
revisions to be proposed. The skill is told to filter aggressively.
"""

import json
import logging

from pydantic import BaseModel

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


class RevisionPair(BaseModel):
    stage_id: str
    stage_name: str
    practice_area: str | None = None
    original_text: str
    revised_text: str


class ExtractDiffsRequest(BaseModel):
    organization_id: str | None = None
    revisions: list[RevisionPair]


class ProposalEvidence(BaseModel):
    stage_id: str
    original_excerpt: str
    revised_excerpt: str


class Proposal(BaseModel):
    patch_path: str  # 'terminology_rules' | 'verb_rules' | 'high_scrutiny_jurisdictions'
    patch_value: dict
    rationale: str
    evidence: list[ProposalEvidence]


class ExtractDiffsResult(BaseModel):
    organization_id: str | None = None
    revision_count: int
    proposals: list[Proposal]


SYSTEM_PROMPT = """You are analyzing pairs of (AI-generated legal text, lawyer's revised version) to \
extract domain_config patches the lawyer's organization should adopt. Each patch will appear in a \
queue for admin review — you do NOT apply patches yourself.

Patch types you can propose:

1. terminology_rules — when the lawyer consistently swaps one TERM (noun) for another. Patch shape:
   {"preferred": "<term lawyer uses>", "avoid": "<term AI uses>", "rationale": "<reason>"}
   Example: AI writes "employee classification", lawyer revises to "worker classification" three times \
   → propose preferred="worker classification", avoid="employee classification".

2. verb_rules — when the lawyer consistently swaps one VERB for another. Patch shape:
   {"prefer": "<verb lawyer uses>", "avoid": "<verb AI uses>", "context": "<when>"}
   Example: AI writes "ensures compliance", lawyer revises to "verifies compliance" repeatedly → \
   propose prefer="verifies", avoid="ensures", context="around compliance/audit statements".

3. high_scrutiny_jurisdictions — when the lawyer consistently adds caveats or elevates risk language \
   for a specific jurisdiction. Patch shape:
   {"jurisdiction": "<name>", "rationale": "<reason>", "appliesToPracticeAreas": ["<area>", ...]}

Strict rules:
- A proposal must be backed by ≥2 distinct revisions (different stage_ids). Singletons are noise.
- Quote VERBATIM excerpts in evidence. Don't paraphrase the lawyer's revision.
- If you see <2 supportable patterns across all revisions, return an empty proposals list. Empty is \
the correct answer when the signal is too thin.
- Don't propose stylistic preferences (oxford commas, sentence length). Only changes that reflect \
substantive legal-domain choices.
- Patch values must match the JSON shape exactly. Validation will reject malformed patches.

Be ruthlessly conservative. Bad proposals waste admin time and erode trust."""


TOOL = {
    "name": "submit_proposals",
    "description": "Submit the domain_config patches derived from lawyer revisions.",
    "input_schema": {
        "type": "object",
        "properties": {
            "proposals": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "patch_path": {
                            "type": "string",
                            "enum": [
                                "terminology_rules",
                                "verb_rules",
                                "high_scrutiny_jurisdictions",
                            ],
                        },
                        "patch_value": {"type": "object"},
                        "rationale": {"type": "string", "minLength": 10},
                        "evidence": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "stage_id": {"type": "string"},
                                    "original_excerpt": {"type": "string"},
                                    "revised_excerpt": {"type": "string"},
                                },
                                "required": [
                                    "stage_id",
                                    "original_excerpt",
                                    "revised_excerpt",
                                ],
                            },
                            "minItems": 2,
                        },
                    },
                    "required": ["patch_path", "patch_value", "rationale", "evidence"],
                },
            },
        },
        "required": ["proposals"],
    },
}


def _build_user_prompt(request: ExtractDiffsRequest) -> str:
    parts: list[str] = [
        f"Organization: {request.organization_id or 'default'}",
        f"Revisions analyzed: {len(request.revisions)}",
        "",
        "--- Revision pairs ---",
    ]
    for r in request.revisions:
        parts.append(
            f"\n[{r.stage_id}] stage={r.stage_name} practice_area={r.practice_area or '-'}"
        )
        parts.append("ORIGINAL (AI):")
        parts.append(r.original_text.strip()[:2000])
        parts.append("REVISED (lawyer):")
        parts.append(r.revised_text.strip()[:2000])
    return "\n".join(parts)


def extract_terminology_diffs(request: ExtractDiffsRequest) -> ExtractDiffsResult:
    if len(request.revisions) < 2:
        # Need at least two revisions to spot a recurring pattern.
        return ExtractDiffsResult(
            organization_id=request.organization_id,
            revision_count=len(request.revisions),
            proposals=[],
        )

    client = get_client()
    response = client.messages.create(  # type: ignore[call-overload]
        model=settings.anthropic_model,
        max_tokens=3072,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[TOOL],
        tool_choice={"type": "tool", "name": "submit_proposals"},
        messages=[{"role": "user", "content": _build_user_prompt(request)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "extract_terminology_diffs missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Diff-extraction skill did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    proposals: list[Proposal] = []
    for p in payload.get("proposals", []):
        # Defensive: ≥2 evidence rows enforced server-side too.
        if len(p.get("evidence", [])) < 2:
            continue
        proposals.append(
            Proposal(
                patch_path=p["patch_path"],
                patch_value=p["patch_value"],
                rationale=p["rationale"],
                evidence=[ProposalEvidence(**e) for e in p["evidence"]],
            )
        )

    return ExtractDiffsResult(
        organization_id=request.organization_id,
        revision_count=len(request.revisions),
        proposals=proposals,
    )
