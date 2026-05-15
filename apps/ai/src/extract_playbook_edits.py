"""M7 — Extract proposed edits to playbooks from closed-matter outcomes.

Takes (playbook_excerpt, evidence_matters) groups and asks the model to
propose targeted edits to the playbook that would have made it more
accurate for the matters where it was applied.

The worker (apps/worker/src/handlers/mine-playbook-edits.ts) calls this
skill once per cron run, grouping evidence by Notion page. Output is a
flat list of edits; the worker writes them to playbook_edit_proposals
as 'pending'. An admin reviews + accepts on /admin/playbook-edit-proposals.

Conservative by design — mirrors the extract_terminology_diffs pattern:
an edit must be supportable from ≥1 evidence matter (lower bar than M5
because playbook content is naturally lower-volume than terminology
patterns), and the skill is told to filter aggressively for substantive
legal-domain changes.
"""

import json
import logging

from pydantic import BaseModel

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


class EvidenceMatter(BaseModel):
    matter_id: str
    matter_title: str
    matter_summary: str


class PlaybookCandidate(BaseModel):
    notion_page_id: str
    playbook_id: str | None = None
    playbook_title: str
    playbook_excerpt: str
    evidence_matters: list[EvidenceMatter]


class ExtractPlaybookEditsRequest(BaseModel):
    proposals: list[PlaybookCandidate]


class PlaybookEdit(BaseModel):
    notion_page_id: str
    section: str
    proposed_edit: str
    rationale: str
    evidence_matter_ids: list[str]


class ExtractPlaybookEditsResult(BaseModel):
    edits: list[PlaybookEdit]


SYSTEM_PROMPT = """You are analyzing playbooks that were applied to recently-closed legal matters and \
proposing targeted edits to those playbooks that would have made them more accurate or useful.

For each input group you will receive:
  - The current playbook content (excerpt from Notion)
  - One or more "evidence matters" — closed matters where this playbook matched in our pre-review \
    analysis pipeline, with the lawyer-accepted final summary for each.

Your job: propose edits to the playbook based on what those closed-matter summaries reveal. Each \
edit will appear in an admin queue for review — you do NOT apply edits yourself.

Each edit must specify:
  - section: A short label identifying WHERE in the playbook the edit applies (a heading, a topic, \
    or "general" if it spans the whole playbook). Use the playbook's own language; don't invent \
    sections that aren't there.
  - proposed_edit: The actual text of the edit. Be specific. "Add a sentence noting that X" or \
    "Replace 'always Y' with 'Y, unless Z'". Quote the playbook verbatim when proposing a swap.
  - rationale: One-sentence explanation of WHY this edit would have helped, grounded in the \
    evidence matters.
  - evidence_matter_ids: Which matters in the input motivated this edit. Must be a non-empty subset \
    of the matter_ids you received.

Strict rules:
- Only propose edits with clear evidentiary support from the matter summaries. If a summary doesn't \
suggest a playbook improvement, don't manufacture one.
- Don't propose stylistic edits (formatting, oxford commas, sentence length).
- Don't propose edits that contradict the playbook without evidence the playbook was wrong. If the \
playbook says X and the matters were consistent with X, no edit is needed.
- Empty edits list is the correct answer when the signal is thin. Most playbook-matter pairs will \
yield zero edits. Be ruthlessly conservative.
- Quote VERBATIM from the matter summary when justifying an edit. Don't paraphrase.
- Cap proposals at ~3 edits per playbook. If you find more, pick the most consequential."""


TOOL = {
    "name": "submit_playbook_edits",
    "description": (
        "Submit the proposed edits to playbooks derived from closed-matter outcomes."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "edits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "notion_page_id": {"type": "string"},
                        "section": {"type": "string", "minLength": 1, "maxLength": 200},
                        "proposed_edit": {"type": "string", "minLength": 10},
                        "rationale": {"type": "string", "minLength": 10},
                        "evidence_matter_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 1,
                        },
                    },
                    "required": [
                        "notion_page_id",
                        "section",
                        "proposed_edit",
                        "rationale",
                        "evidence_matter_ids",
                    ],
                },
            },
        },
        "required": ["edits"],
    },
}


def _build_user_prompt(request: ExtractPlaybookEditsRequest) -> str:
    parts: list[str] = [
        f"Playbook candidates to review: {len(request.proposals)}",
        "",
    ]
    for c in request.proposals:
        parts.append(f"\n=== Playbook: {c.playbook_title} ===")
        parts.append(f"notion_page_id={c.notion_page_id}")
        parts.append(f"playbook_id={c.playbook_id or '(not in registry)'}")
        parts.append("")
        parts.append("Current playbook content:")
        parts.append(c.playbook_excerpt.strip()[:4000])
        parts.append("")
        parts.append(f"Evidence matters ({len(c.evidence_matters)}):")
        for m in c.evidence_matters:
            parts.append(f"\n  [{m.matter_id}] {m.matter_title}")
            parts.append("  Final summary:")
            for line in m.matter_summary.strip()[:3000].split("\n"):
                parts.append(f"    {line}")
    return "\n".join(parts)


def extract_playbook_edits(
    request: ExtractPlaybookEditsRequest,
) -> ExtractPlaybookEditsResult:
    if not request.proposals:
        return ExtractPlaybookEditsResult(edits=[])

    # Validate every proposal has at least one evidence matter; the
    # worker shouldn't send empty groups, but defend against it so we
    # don't waste a model call on noise.
    request_proposals = [p for p in request.proposals if p.evidence_matters]
    if not request_proposals:
        return ExtractPlaybookEditsResult(edits=[])

    valid_matter_ids: set[str] = set()
    for p in request_proposals:
        for m in p.evidence_matters:
            valid_matter_ids.add(m.matter_id)
    valid_page_ids = {p.notion_page_id for p in request_proposals}

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
        tool_choice={"type": "tool", "name": "submit_playbook_edits"},
        messages=[
            {
                "role": "user",
                "content": _build_user_prompt(
                    ExtractPlaybookEditsRequest(proposals=request_proposals)
                ),
            }
        ],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "extract_playbook_edits missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Playbook-edits skill did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    edits: list[PlaybookEdit] = []
    for e in payload.get("edits", []):
        # Defensive validation: discard edits referencing pages or
        # matters not in the request. This catches the model
        # hallucinating IDs.
        if e.get("notion_page_id") not in valid_page_ids:
            logger.warning(
                "extract_playbook_edits dropping edit with unknown page_id=%s",
                e.get("notion_page_id"),
            )
            continue
        evidence_ids = [mid for mid in e.get("evidence_matter_ids", []) if mid in valid_matter_ids]
        if not evidence_ids:
            logger.warning(
                "extract_playbook_edits dropping edit with no valid evidence ids: %s",
                e.get("evidence_matter_ids"),
            )
            continue
        edits.append(
            PlaybookEdit(
                notion_page_id=e["notion_page_id"],
                section=e["section"],
                proposed_edit=e["proposed_edit"],
                rationale=e["rationale"],
                evidence_matter_ids=evidence_ids,
            )
        )

    return ExtractPlaybookEditsResult(edits=edits)
