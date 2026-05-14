"""M2 — Matter compression skill.

Consolidates a closed matter's stages + sources + lawyer decisions
into a single executive-summary memo. The output becomes the matter's
"episodic memory" for future K-NN retrieval (matter_summaries
table) and is more semantically dense than the raw intake text.

Output is markdown so it renders cleanly in the matter detail page
and in Notion if mirrored. Embedded via Voyage in the worker after
the LLM call; the same 1024-dim vector slot used by matters.embedding
is reused in the matter_summaries table.

Hermes-equivalent: /compress, but persistent and addressable.
"""

import json
import logging

from pydantic import BaseModel, Field

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


class StageRecord(BaseModel):
    stage_name: str
    confidence: str | None = None
    lawyer_decision: str | None = None
    lawyer_decision_reason: str | None = None
    output_summary: str  # 1-2 paragraphs from the stage's outputJson


class SourceRecord(BaseModel):
    citation: str
    verification_status: str | None = None
    raw_excerpt: str


class CompactMatterRequest(BaseModel):
    matter_id: str
    matter_short_id: str | None = None
    title: str
    practice_area: str | None = None
    jurisdictions: list[str] = []
    request_text: str
    counterparty_name: str | None = None
    stages: list[StageRecord]
    sources: list[SourceRecord]
    closed_at: str | None = None


class CompactMatterResult(BaseModel):
    matter_id: str
    summary_md: str = Field(min_length=50)
    headline: str  # 1-sentence top-line, useful as a list-row preview


SYSTEM_PROMPT = """You are consolidating a closed legal matter into an executive-memory \
summary. Future matters that look similar will retrieve this summary as the primary \
signal — it must capture WHAT HAPPENED, WHY, and WHAT TO REPLICATE, not just the inputs.

Output is markdown, 250-500 words. Structure:

## Headline
One sentence: what the matter was about + how it resolved.

## Issue
2-3 sentences: the legal question that drove the matter. State it operationally, not in \
abstract terms. Include the specific operative facts (jurisdiction, dollar amount, \
counterparty type) that mattered.

## Resolution
The conclusion the lawyer reached + the authority that anchored it. Cite the operative \
provision / case / regulation by name. Note whether the conclusion was HIGH / MEDIUM / LOW \
confidence.

## Reasoning that mattered
The 2-4 specific reasoning steps that drove the conclusion. NOT a list of every stage that \
ran — only the ones whose output the lawyer accepted as material. Include what the AI got \
right and any place the lawyer materially revised the AI's draft.

## What to replicate next time
1-3 bullets: specific things a future matter on this fact pattern should do the same way. \
Examples: "Apply the §X exemption analysis when employee count < 50"; "Cite Smith v. Jones \
before the materiality threshold question because it's controlling in this circuit"; \
"Ask for counterparty's audited financials when liability cap > $5M."

## What to watch for
0-2 bullets: edge cases or pitfalls. Include lawyer rejections you saw (with reason if given) \
because rejections reveal where the analysis is fragile.

Style rules:
- Be specific. "Reviewed contract clauses" is useless; "Found liability cap of $2M v. \
counterparty's request for $10M; closed at $4M mutual aggregate" is useful.
- Cite by name, not by stage number.
- Include dollar amounts, dates, jurisdictions where they're operative.
- Skip any stage that didn't matter to the outcome.
- Don't invent. If a field is missing in the input, leave the section short or omit it.

Then return:
- headline: a 1-sentence top-line summary (≤ 200 chars) that could show up in a search list."""


TOOL = {
    "name": "submit_summary",
    "description": "Submit the consolidated matter summary in markdown.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary_md": {"type": "string", "minLength": 50},
            "headline": {"type": "string", "maxLength": 250},
        },
        "required": ["summary_md", "headline"],
    },
}


def _build_user_prompt(request: CompactMatterRequest) -> str:
    parts: list[str] = [
        f"Matter: {request.title}",
        f"Short ID: {request.matter_short_id or '-'}",
        f"Practice area: {request.practice_area or '-'}",
        (
            f"Jurisdictions: {', '.join(request.jurisdictions)}"
            if request.jurisdictions
            else "Jurisdictions: -"
        ),
        f"Counterparty: {request.counterparty_name or '-'}",
        f"Closed at: {request.closed_at or '-'}",
        "",
        "--- Original request ---",
        request.request_text.strip()[:2000],
        "",
        f"--- Stages ({len(request.stages)}) ---",
    ]
    for s in request.stages:
        parts.append(
            f"\n[{s.stage_name}] confidence={s.confidence or '-'} "
            f"decision={s.lawyer_decision or '-'}"
        )
        if s.lawyer_decision_reason:
            parts.append(f"  reason: {s.lawyer_decision_reason}")
        parts.append(f"  output: {s.output_summary.strip()[:1500]}")

    if request.sources:
        parts.append(f"\n--- Sources ({len(request.sources)}) ---")
        for src in request.sources[:30]:
            parts.append(
                f"  · {src.citation}  ({src.verification_status or '-'})"
            )
            if src.raw_excerpt:
                excerpt = src.raw_excerpt.strip().replace("\n", " ")[:300]
                parts.append(f"    excerpt: {excerpt}")

    return "\n".join(parts)


def compact_matter(request: CompactMatterRequest) -> CompactMatterResult:
    if not request.stages:
        # Nothing happened on this matter beyond intake. Return a thin
        # summary derived from the request text — still useful as a
        # retrieval signal but no LLM call.
        headline = (request.title or "Untitled matter")[:240]
        body = (
            f"## Headline\n{headline}\n\n"
            "## Issue\n"
            f"{request.request_text.strip()[:1000]}\n\n"
            "## Resolution\n"
            "No analysis stages ran on this matter; closed without resolution detail."
        )
        return CompactMatterResult(
            matter_id=request.matter_id,
            summary_md=body,
            headline=headline,
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
        tool_choice={"type": "tool", "name": "submit_summary"},
        messages=[{"role": "user", "content": _build_user_prompt(request)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "compact_matter missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Compact-matter skill did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    return CompactMatterResult(
        matter_id=request.matter_id,
        summary_md=payload["summary_md"],
        headline=payload["headline"],
    )
