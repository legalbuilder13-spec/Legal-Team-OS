"""Stage 1 — guidance relevance grader.

Given the matter request and a set of Notion-sourced candidates (playbook
entries, KB articles, saved-matter summaries), grade each candidate for
on-point-ness. The hardcoded gate in the worker then decides the verdict
('matched' if the top score crosses the threshold, 'related_only' if it's
in the middle band, 'no_hit' otherwise).

The model never decides the verdict itself — it just produces per-candidate
scores and (if asked) a one-paragraph headline answer. Verdict assignment
is hardcoded so the gating logic is auditable and tunable without prompt
changes.
"""

import json
import logging

from .analysis_schemas import (
    FrameFlipProposal,
    GuidanceGrade,
    GuidanceGraderRequest,
    GuidanceGraderResult,
    GuidanceHeadline,
)
from .config import settings
from .llm.client import get_client
from .pipeline_context import (
    DEPTH_AND_FRAME_SYSTEM_ADDENDUM,
    FRAME_FLIP_PROPOSAL_SCHEMA,
    render_context_block,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the guidance relevance grader for an in-house legal team's matter intake. You receive \
(1) a new matter request and (2) a set of candidate Notion pages (playbooks, KB articles, or saved-matter \
summaries) that a coarse keyword search has retrieved.

For each candidate you return a grade:
- on_point_score (0.0–1.0): how directly the candidate answers THIS request. \
0.9+ means the candidate is essentially the answer (an on-point playbook with the exact fact pattern). \
0.5–0.8 means the candidate is related but doesn't fully resolve the question. \
Below 0.5 means the candidate is incidentally relevant or off-topic.
- jurisdiction_match (bool): does the candidate's jurisdiction (if specified) match the matter's jurisdiction? \
If the candidate is jurisdiction-agnostic, return true.
- fact_pattern_overlap (0.0–1.0): how much of the matter's factual scenario is mirrored in the candidate.
- age_concern (bool): does the candidate appear stale enough that its position may have changed (>18 months old \
on a fast-moving topic, or visibly outdated language)?
- citation_anchor: if the candidate cites a specific statute / case / regulation that anchors its position, return \
that citation as a string; otherwise null.
- one_line_rationale: one short sentence explaining the score.

Then, IF AND ONLY IF the highest-scoring candidate has on_point_score >= 0.8 AND jurisdiction_match=true AND \
age_concern=false, you also produce a headline_answer summarizing what that candidate says applies to this matter \
in 2–4 sentences. Otherwise headline_answer is null and the worker will escalate to the lawyer.

Be conservative. False-positive matches (saying "we have a position on this" when we don't) waste lawyer time \
and erode trust. When in doubt, score lower.""" + DEPTH_AND_FRAME_SYSTEM_ADDENDUM

TOOL = {
    "name": "submit_grades",
    "description": "Submit the per-candidate grades and optional headline answer.",
    "input_schema": {
        "type": "object",
        "properties": {
            "grades": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "candidate_index": {"type": "integer", "minimum": 0},
                        "on_point_score": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                        "jurisdiction_match": {"type": "boolean"},
                        "fact_pattern_overlap": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                        "age_concern": {"type": "boolean"},
                        "citation_anchor": {"type": ["string", "null"]},
                        "one_line_rationale": {"type": "string"},
                    },
                    "required": [
                        "candidate_index",
                        "on_point_score",
                        "jurisdiction_match",
                        "fact_pattern_overlap",
                        "age_concern",
                        "citation_anchor",
                        "one_line_rationale",
                    ],
                },
            },
            "headline_answer": {
                "anyOf": [
                    {
                        "type": "object",
                        "properties": {
                            "summary": {"type": "string"},
                            "citation": {"type": "string"},
                            "source_url": {"type": ["string", "null"]},
                        },
                        "required": ["summary", "citation"],
                    },
                    {"type": "null"},
                ],
            },
            "notes_for_lawyer": {"type": ["string", "null"]},
            "frame_flip_proposal": FRAME_FLIP_PROPOSAL_SCHEMA,
        },
        "required": ["grades", "headline_answer", "notes_for_lawyer"],
    },
}


def build_user_prompt(request: GuidanceGraderRequest) -> str:
    parts: list[str] = [
        f"Matter ID: {request.matter_id}",
        f"Practice area: {request.practice_area}",
        "",
        "--- Matter request ---",
        request.request_text,
        "",
        f"--- Candidate guidance ({len(request.candidates)} pages) ---",
    ]
    if not request.candidates:
        parts.append("(no candidates retrieved)")
        return "\n".join(parts)

    for i, c in enumerate(request.candidates):
        parts.append(f"\n[Candidate {i}] source={c.source} title={c.title}")
        if c.url:
            parts.append(f"  url: {c.url}")
        parts.append(f"  retrieved_at: {c.retrieved_at}")
        excerpt = c.excerpt.strip()
        if len(excerpt) > 1500:
            excerpt = excerpt[:1500] + "…"
        parts.append(f"  excerpt:\n{excerpt}")
    parts.append(render_context_block(request.context))
    return "\n".join(parts)


def grade_guidance(request: GuidanceGraderRequest) -> GuidanceGraderResult:
    if not request.candidates:
        return GuidanceGraderResult(
            matter_id=request.matter_id,
            verdict="no_hit",
            grades=[],
            top_match_index=None,
            headline_answer=None,
            notes_for_lawyer="No candidate guidance retrieved from the workspace.",
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
        tool_choice={"type": "tool", "name": "submit_grades"},
        messages=[{"role": "user", "content": build_user_prompt(request)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "guidance_grader missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Guidance grader did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    grades = [GuidanceGrade(**g) for g in payload["grades"]]
    headline_raw = payload.get("headline_answer")
    headline = GuidanceHeadline(**headline_raw) if headline_raw else None
    flip_payload = payload.get("frame_flip_proposal")
    frame_flip = FrameFlipProposal(**flip_payload) if flip_payload else None

    # Hardcoded gating — verdict is decided in code, not by the model.
    # PRD §7.5 thresholds; tunable per organization in domain config.
    match_threshold = 0.8
    related_threshold = 0.5

    top_index: int | None = None
    top_score = -1.0
    for g in grades:
        if g.on_point_score > top_score:
            top_score = g.on_point_score
            top_index = g.candidate_index

    if top_index is None:
        verdict: str = "no_hit"
    else:
        top = grades[next(i for i, g in enumerate(grades) if g.candidate_index == top_index)]
        if (
            top.on_point_score >= match_threshold
            and top.jurisdiction_match
            and not top.age_concern
        ):
            verdict = "matched"
        elif top.on_point_score >= related_threshold:
            verdict = "related_only"
        else:
            verdict = "no_hit"

    # If the worker would not classify this as a match, suppress the
    # headline answer regardless of what the model produced. Fail closed.
    if verdict != "matched":
        headline = None

    return GuidanceGraderResult(
        matter_id=request.matter_id,
        verdict=verdict,  # type: ignore[arg-type]
        grades=grades,
        top_match_index=top_index,
        headline_answer=headline,
        notes_for_lawyer=payload.get("notes_for_lawyer"),
        frame_flip_proposal=frame_flip,
    )
