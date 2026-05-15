"""Shared pydantic schemas for the pre-review analysis pipeline.

These mirror the typed contracts in packages/types/src/analysis.ts. Any
change here must keep the field names + types aligned with the TS side —
the worker enforces schema on every response and fails closed if it drifts.
"""

from typing import Literal

from pydantic import BaseModel, Field

from .domain_config import DomainConfig

# ----- PR-A — research depth + doctrinal-frame state -----

ResearchDepth = Literal["quick_take", "client_advice", "filing_grade", "bet_the_company"]
StageLabel = Literal["intake", "stage_0", "stage_1", "stage_2a", "stage_2b", "stage_3"]


class AlternativeRegime(BaseModel):
    regime: str
    prior: float = Field(ge=0.0, le=1.0)


class DoctrinalFrameState(BaseModel):
    primary_regime: str
    alternative_regimes: list[AlternativeRegime] = []
    last_updated_by_stage: StageLabel
    flip_count: int = Field(ge=0, default=0)


class FrameFlipProposal(BaseModel):
    from_frame: str | None = None
    to_frame: str
    evidence_quote: str
    evidence_citation: str | None = None
    rationale: str
    confidence: float = Field(ge=0.0, le=1.0)


class PipelineContext(BaseModel):
    """Carried on every skill request; skills may emit a frame flip on the response."""

    research_depth: ResearchDepth = "client_advice"
    doctrinal_frame: DoctrinalFrameState | None = None


# ----- Stage 0 — threshold spotter -----

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
    # PR12 §15 — per-organization domain config. Optional + defaults
    # to empty; the prompt renderer no-ops when there's no content.
    domain_config: DomainConfig | None = None
    # PR-A — pipeline context: research_depth + carried doctrinal_frame.
    context: PipelineContext = PipelineContext()


class ThresholdEvidenceChannel(BaseModel):
    # PR-10 — three-strategy negative-result discipline. When the
    # spotter returns not_raised for a high-severity threshold, it
    # must articulate three independent evidence channels checked.
    # how-lawyers-think Part IV §3 / V.18.
    channel: Literal["explicit_text", "temporal", "conduct", "absence_of_signal"]
    evidence: str
    checked: bool


class ThresholdFinding(BaseModel):
    id: str
    status: Literal["raised", "not_raised", "cant_tell"]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quote: str
    one_line_justification: str
    # PR-10 — required for high-severity 'not_raised' findings.
    # Worker downgrades to 'cant_tell' if fewer than 3 channels are
    # checked. Optional for medium/low and for raised/cant_tell.
    not_raised_basis: list[ThresholdEvidenceChannel] = Field(default_factory=list)


class ThresholdSpotterResult(BaseModel):
    matter_id: str
    practice_area: str
    checklist_version: str
    findings: list[ThresholdFinding]
    # PR-A — opt-in proposal that the carried doctrinal_frame is wrong.
    # Worker writes to matter_frame_flips when present.
    frame_flip_proposal: FrameFlipProposal | None = None
    # PR-6 — out-of-distribution detection. Model assesses whether the
    # matter was routed to the right practice area; on misroute,
    # suggests where it should go.
    practice_area_confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    suggested_reroute: str | None = None
    reroute_rationale: str | None = None


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
    # PR-A — pipeline context.
    context: PipelineContext = PipelineContext()


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
    frame_flip_proposal: FrameFlipProposal | None = None
