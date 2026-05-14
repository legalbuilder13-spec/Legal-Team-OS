"""Shared pydantic schemas for the pre-review analysis pipeline.

These mirror the typed contracts in packages/types/src/analysis.ts. Any
change here must keep the field names + types aligned with the TS side —
the worker enforces schema on every response and fails closed if it drifts.
"""

from typing import Literal

from pydantic import BaseModel, Field

# ----- Stage 0 — threshold spotter -----


class ThresholdItem(BaseModel):
    id: str
    prompt: str
    severity_if_raised: Literal["high", "medium", "low"]
    doc_anchor: str | None = None


class ThresholdSpotterRequest(BaseModel):
    matter_id: str
    practice_area: str
    request_text: str
    checklist_version: str
    items: list[ThresholdItem]


class ThresholdFinding(BaseModel):
    id: str
    status: Literal["raised", "not_raised", "cant_tell"]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quote: str
    one_line_justification: str


class ThresholdSpotterResult(BaseModel):
    matter_id: str
    practice_area: str
    checklist_version: str
    findings: list[ThresholdFinding]


# ----- Stage 1 — guidance relevance grader -----


GuidanceSource = Literal["notion_playbook", "notion_kb", "notion_saved_matter"]


class GuidanceCandidate(BaseModel):
    source: GuidanceSource
    title: str
    url: str | None = None
    notion_page_id: str | None = None
    excerpt: str
    retrieved_at: str


class GuidanceGraderRequest(BaseModel):
    matter_id: str
    request_text: str
    practice_area: str
    candidates: list[GuidanceCandidate]


class GuidanceGrade(BaseModel):
    candidate_index: int
    on_point_score: float = Field(ge=0.0, le=1.0)
    jurisdiction_match: bool
    fact_pattern_overlap: float = Field(ge=0.0, le=1.0)
    age_concern: bool
    citation_anchor: str | None = None
    one_line_rationale: str


class GuidanceHeadline(BaseModel):
    summary: str
    citation: str
    source_url: str | None = None


class GuidanceGraderResult(BaseModel):
    matter_id: str
    verdict: Literal["matched", "related_only", "no_hit"]
    grades: list[GuidanceGrade]
    top_match_index: int | None = None
    headline_answer: GuidanceHeadline | None = None
    notes_for_lawyer: str | None = None
