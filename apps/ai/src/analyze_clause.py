import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)

MODEL_VERSION = "v1-anthropic-2026-05"

ANALYZE_SYSTEM_PROMPT = """You are an in-house attorney reviewing a counterparty-supplied \
contract clause-by-clause. For each clause, you compare it against your team's playbook \
positions and assign exactly one of three tags:

- STANDARD: the clause matches our standard position, or is substantively equivalent. No \
attorney action required.
- MODIFIED: the clause deviates from our standard position but falls within our acceptable \
range. Note the deviation; suggest a preferred alternative redline if useful.
- FLAGGED: the clause materially deviates from our standard position OR triggers a \
flagged_condition. Attorney attention required. Provide a clear redline that brings the \
clause back to acceptable territory.

Use the provided playbook_position as your reference. If multiple positions are provided, \
pick the single best-matching one (by topic) and tag against it. If NO playbook position \
applies to this clause (it covers a topic the playbook doesn't address), tag STANDARD with \
reasoning explaining the clause is out-of-scope of the playbook.

Be conservative: when in doubt between MODIFIED and FLAGGED, pick FLAGGED. The cost of an \
unnecessary attorney glance is much lower than a missed material deviation.

CITATIONS: when your reasoning relies on a specific source, cite it. Use citations for:
- playbook_position: cite the position you tagged against (identifier = position id)
- prior_matter: cite a similar past matter if its outcome informed your tag (identifier = \
the matter short_id; include a 1-sentence excerpt of how it was resolved)
- knowledge_article: cite an internal policy/guidance article if it bears on this clause \
(identifier = the article id; include a 1-sentence excerpt)

Cite only what materially informed the analysis. Better to have 1-2 strong citations than \
5 weak ones. Do NOT cite sources you weren't actually given in the input."""

ANALYZE_TOOL = {
    "name": "submit_analysis",
    "description": "Submit the clause analysis.",
    "input_schema": {
        "type": "object",
        "properties": {
            "tag": {"type": "string", "enum": ["STANDARD", "MODIFIED", "FLAGGED"]},
            "selected_position_id": {
                "type": ["string", "null"],
                "description": "ID of the playbook position used; null if no position applied.",
            },
            "reasoning": {
                "type": "string",
                "description": "1-3 sentences explaining the tag.",
            },
            "suggested_redline": {
                "type": ["string", "null"],
                "description": "Proposed clause text; null for STANDARD when no change is needed.",
            },
            "citations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "source": {
                            "type": "string",
                            "enum": [
                                "playbook_position",
                                "prior_matter",
                                "knowledge_article",
                            ],
                        },
                        "identifier": {"type": "string"},
                        "excerpt": {"type": ["string", "null"]},
                    },
                    "required": ["source", "identifier"],
                },
            },
        },
        "required": ["tag", "selected_position_id", "reasoning", "suggested_redline", "citations"],
    },
}


class PlaybookPositionInput(BaseModel):
    id: str
    topic: str
    trigger: str
    standard_position: str
    acceptable_range: str | None = None
    flagged_conditions: str | None = None
    suggested_redline: str | None = None
    citation: str | None = None


class PriorMatterInput(BaseModel):
    id: str  # short_id for human-readable citation
    title: str
    summary: str | None = None
    practice_area: str | None = None
    outcome: str | None = None  # e.g. how the clause was resolved


class KnowledgeArticleInput(BaseModel):
    id: str  # slug or short id
    title: str
    body: str
    tags: list[str] = []


class AnalyzeClauseRequest(BaseModel):
    clause_id: str
    clause_text: str = Field(min_length=1)
    heading_path: str | None = None
    matter_context: str | None = None
    practice_area: str | None = None
    positions: list[PlaybookPositionInput]
    # F2 multi-source citation
    prior_matters: list[PriorMatterInput] = []
    knowledge_articles: list[KnowledgeArticleInput] = []


class Citation(BaseModel):
    source: Literal["playbook_position", "prior_matter", "knowledge_article"]
    identifier: str
    excerpt: str | None = None


class AnalyzeClauseResult(BaseModel):
    clause_id: str
    tag: Literal["STANDARD", "MODIFIED", "FLAGGED"]
    selected_position_id: str | None = None
    reasoning: str = Field(min_length=1)
    suggested_redline: str | None = None
    citations: list[Citation] = []
    model_version: str = MODEL_VERSION


def _build_user_prompt(request: AnalyzeClauseRequest) -> str:
    parts: list[str] = []
    if request.matter_context:
        parts.append("--- Matter context ---")
        parts.append(request.matter_context)
        parts.append("")
    if request.practice_area:
        parts.append(f"Practice area: {request.practice_area}")
        parts.append("")

    if request.positions:
        parts.append(f"--- Playbook positions ({len(request.positions)}) ---")
        for p in request.positions:
            parts.append(f"\nPosition {p.id}: {p.topic}")
            parts.append(f"  trigger: {p.trigger}")
            parts.append(f"  standard: {p.standard_position}")
            if p.acceptable_range:
                parts.append(f"  acceptable range: {p.acceptable_range}")
            if p.flagged_conditions:
                parts.append(f"  flagged conditions: {p.flagged_conditions}")
            if p.suggested_redline:
                parts.append(f"  template redline: {p.suggested_redline}")
            if p.citation:
                parts.append(f"  rationale: {p.citation}")
    else:
        parts.append("--- No playbook positions available for this practice area ---")
        parts.append("Tag STANDARD and note in reasoning that the playbook does not cover this topic.")

    if request.prior_matters:
        parts.append("")
        parts.append(f"--- Prior similar matters ({len(request.prior_matters)}) ---")
        for pm in request.prior_matters:
            line = f"\n[{pm.id}] {pm.title}"
            if pm.practice_area:
                line += f" ({pm.practice_area})"
            parts.append(line)
            if pm.summary:
                parts.append(f"  summary: {pm.summary[:300]}")
            if pm.outcome:
                parts.append(f"  outcome: {pm.outcome[:300]}")

    if request.knowledge_articles:
        parts.append("")
        parts.append(f"--- Knowledge base articles ({len(request.knowledge_articles)}) ---")
        for ka in request.knowledge_articles:
            tags = f" [{', '.join(ka.tags)}]" if ka.tags else ""
            parts.append(f"\n[{ka.id}]{tags} {ka.title}")
            parts.append(f"  {ka.body[:500]}")

    parts.append("")
    parts.append("--- Clause to analyze ---")
    if request.heading_path:
        parts.append(f"Heading: {request.heading_path}")
    parts.append(request.clause_text)

    return "\n".join(parts)


def analyze_clause(request: AnalyzeClauseRequest) -> AnalyzeClauseResult:
    client = get_client()
    user_prompt = _build_user_prompt(request)

    response = client.messages.create(  # type: ignore[call-overload]
        model=settings.anthropic_model,
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": ANALYZE_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[ANALYZE_TOOL],
        tool_choice={"type": "tool", "name": "submit_analysis"},
        messages=[{"role": "user", "content": user_prompt}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        raise RuntimeError("analyze_clause model did not return a tool_use block")
    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    selected_id = payload.get("selected_position_id")
    # Validate selected_position_id refers to one of the provided positions
    if selected_id is not None:
        position_ids = {p.id for p in request.positions}
        if selected_id not in position_ids:
            logger.warning(
                "analyze_clause returned position_id %s not in provided set; nulling out",
                selected_id,
            )
            selected_id = None

    return AnalyzeClauseResult(
        clause_id=request.clause_id,
        tag=payload["tag"],
        selected_position_id=selected_id,
        reasoning=payload["reasoning"],
        suggested_redline=payload.get("suggested_redline"),
        citations=[Citation(**c) for c in payload.get("citations", [])],
    )
