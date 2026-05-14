"""Phase 3 — case-law research skill.

Reads the matter request + a set of candidate opinions (retrieved by
the worker via CourtListener's 3 independent strategies — full-text
search, jurisdiction filter, citator traversal) and returns the
structured §11 analysis: controlling authority, persuasive authority,
analogous cases, anti-analogous cases (adversarial doubling), and a
mirror-image argument.

The skill never verifies its own output. The worker re-checks every
citation against CourtListener's citation-lookup endpoint AFTER this
returns; cites that fail verification are dropped from the rendered
output. This satisfies PRD §11.2 / Part V #19 — the verification
source is independent of the source that produced the citation.

Hard rules the prompt enforces:
- Adversarial doubling: anti_analogous_cases MUST NOT be empty. An
  analysis without the strongest opposing reading is rejected.
- Every cite the skill includes must appear in the supplied
  candidate_opinions list. The skill is not asked to invent cites; the
  worker pre-retrieved them.
- Holdings must be supported by verbatim language from the supplied
  snippets where available. Where not, the skill says so.
- Treatment status comes from the candidate metadata, not the model's
  guess.
"""

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


# ----- Request / response schemas -----


class CaseCandidate(BaseModel):
    opinion_id: str
    citation: str
    case_name: str
    court: str
    date_filed: str | None = None
    absolute_url: str
    snippet: str
    # Worker-provided treatment from the citator. The skill must NOT
    # second-guess this — if status='overruled', the skill must treat
    # the case as overruled (and surface it as a cautionary tale or
    # drop it). If status='unverified', the skill must flag it.
    treatment_status: Literal[
        "good_law", "negative_history", "overruled", "distinguished",
        "unverified", "unfindable",
    ]
    cited_by_count: int | None = None
    # Worker tells the skill which retrieval strategy surfaced this
    # candidate. The skill is not required to use this; it's surfaced
    # in the trace so the lawyer sees how broad the retrieval was.
    retrieval_strategy: Literal["full_text", "jurisdiction_filter", "citator_traversal"]


class CaseLawRequest(BaseModel):
    matter_id: str
    request_text: str
    jurisdiction: str
    practice_area: str
    candidate_doctrines: list[str] = []
    candidates: list[CaseCandidate]


CourtLevel = Literal[
    "scotus", "circuit", "district", "state_high", "state_intermediate",
    "state_trial", "agency", "other",
]


class CaseSummary(BaseModel):
    cite: str
    case_name: str
    court_level: CourtLevel
    jurisdiction: str
    holding: str
    why_relevant: str
    treatment: Literal[
        "good_law", "negative_history", "overruled", "distinguished",
        "unverified",
    ]
    depth: Literal["majority", "concurrence", "dissent", "dicta"]
    # The candidate this summary corresponds to. The worker uses this
    # to attach the source row and to confirm the citation came from
    # the retrieved set.
    opinion_id: str


class AnalogousCase(BaseModel):
    case: CaseSummary
    analogy_strength: float = Field(ge=0.0, le=1.0)
    factual_overlap: str


class AntiAnalogousCase(BaseModel):
    case: CaseSummary
    why_distinguishable: str
    severity_for_matter: Literal["case_killer", "significant", "manageable"]


class CaseLawResult(BaseModel):
    matter_id: str
    controlling_authority: list[CaseSummary]
    persuasive_authority: list[CaseSummary]
    circuit_split_present: bool
    split_summary: str | None = None
    analogous_cases: list[AnalogousCase]
    anti_analogous_cases: list[AntiAnalogousCase]
    mirror_image_argument: str
    confidence_self_assessment: Literal["HIGH", "MEDIUM", "LOW"]
    confidence_basis: str
    verify_flags: list[str] = Field(default_factory=list, max_length=3)
    # Negative-result accounting per PRD §14.1 stopping rules. When
    # all three retrieval strategies turn up nothing useful the skill
    # says so explicitly rather than confabulating.
    negative_result_strategies: list[
        Literal["full_text", "jurisdiction_filter", "citator_traversal"]
    ] = Field(default_factory=list)


# ----- Prompt -----


SYSTEM_PROMPT = """You are the case-law research skill for an in-house legal team's research tool. You are given \
(1) a matter request, (2) a set of candidate opinions the worker has already retrieved from CourtListener via \
three independent strategies (full-text search, jurisdiction-filtered search, citator traversal of an anchor \
case), and (3) the jurisdiction and practice area.

You produce a structured case-law analysis following PRD §11. Your output is reviewed by a lawyer. The worker \
will re-verify every citation you return through CourtListener's citation-lookup endpoint AFTER you return; \
cites that fail verification are dropped from the rendered output. Never invent a citation that is not in the \
candidate list.

# Hard rules

## You may only cite from the candidate list
Every cite you produce MUST correspond to one of the candidates in `candidates`. Use the candidate's `opinion_id` \
to anchor each CaseSummary. If you want to discuss a case that isn't in the candidates, write the discussion \
into `mirror_image_argument` or `confidence_basis` as narrative — not as a CaseSummary.

## Adversarial doubling — MANDATORY
`anti_analogous_cases` MUST NOT be empty. Every analysis must surface the strongest opposing reading: cases \
that, if controlling or persuasive, would hurt the matter's apparent position. If you genuinely cannot find an \
anti-analogous case in the candidates, write the strongest hypothetical anti-analogy in `mirror_image_argument` \
and explain why the candidate set is insufficient.

## Treatment status comes from the candidate, not from you
Each candidate has a `treatment_status` field set by the worker's citator call. Use that value. Do not infer or \
override treatment based on the snippet — the candidate set already had treatment normalized.

## Holdings must be supported by the snippet
The `holding` for each CaseSummary must be derivable from the supplied snippet OR you must flag that the snippet \
is too short to support a confident holding. Do not write holdings from training memory.

## Circuit splits
If two or more candidates from different circuits reach different holdings on the same issue, set \
`circuit_split_present=true` and write a 1-2 sentence `split_summary` naming the split.

## Confidence ratings
- HIGH only when controlling authority is on-point AND treatment is good_law AND the analysis would survive an \
opposing brief.
- MEDIUM when only persuasive authority is available, or when relevant authority is mixed.
- LOW when no on-point authority was retrieved, or the only matches have overruled/negative treatment.

LOW is honest; it tells the lawyer to broaden the search or escalate.

## Verify flags
Maximum 3. Use for: candidates whose snippet is too short, treatment statuses you want the lawyer to double-check, \
or holdings you couldn't confirm from the snippet.

## Negative results
If a retrieval strategy turned up no useful candidates, add it to `negative_result_strategies`. PRD §14.1 requires \
three independent negative strategies before declaring "no authority on point.\""""


TOOL = {
    "name": "submit_case_law_analysis",
    "description": "Submit the structured case-law analysis for the matter.",
    "input_schema": CaseLawResult.model_json_schema(),
}


def build_user_prompt(req: CaseLawRequest) -> str:
    parts: list[str] = [
        f"Matter ID: {req.matter_id}",
        f"Jurisdiction: {req.jurisdiction}",
        f"Practice area: {req.practice_area}",
        "",
        "--- Matter request ---",
        req.request_text,
        "",
    ]
    if req.candidate_doctrines:
        parts.append("--- Candidate doctrines (lawyer-supplied) ---")
        for d in req.candidate_doctrines:
            parts.append(f"- {d}")
        parts.append("")
    parts.append(f"--- Candidate opinions ({len(req.candidates)} from 3 retrieval strategies) ---")
    if not req.candidates:
        parts.append("(no candidates — all three retrieval strategies returned empty; mark all three as negative)")
    for i, c in enumerate(req.candidates):
        parts.append("")
        parts.append(f"[Candidate {i}] opinion_id={c.opinion_id} citation={c.citation}")
        parts.append(f"  case: {c.case_name}")
        parts.append(f"  court: {c.court} ({c.date_filed or 'undated'})")
        parts.append(f"  treatment: {c.treatment_status} (cited_by={c.cited_by_count or 0})")
        parts.append(f"  retrieved_via: {c.retrieval_strategy}")
        parts.append(f"  url: {c.absolute_url}")
        snippet = c.snippet[:1200]
        parts.append(f"  snippet: {snippet}")
    return "\n".join(parts)


def research_case_law(req: CaseLawRequest) -> CaseLawResult:
    if not req.candidates:
        # All three strategies returned empty; return an explicit
        # negative-result stub. PRD §14.1 — negative results are real
        # findings, not pipeline failures.
        return CaseLawResult(
            matter_id=req.matter_id,
            controlling_authority=[],
            persuasive_authority=[],
            circuit_split_present=False,
            split_summary=None,
            analogous_cases=[],
            anti_analogous_cases=[],
            mirror_image_argument=(
                "No candidate authority was retrieved. A complete adversarial reading "
                "cannot be produced without authority on either side; lawyer should broaden "
                "the search terms or invoke a different tool."
            ),
            confidence_self_assessment="LOW",
            confidence_basis="Three independent retrieval strategies returned no candidates.",
            verify_flags=[],
            negative_result_strategies=["full_text", "jurisdiction_filter", "citator_traversal"],
        )

    client = get_client()
    response = client.messages.create(  # type: ignore[call-overload]
        model=settings.anthropic_model,
        max_tokens=8192,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[TOOL],
        tool_choice={"type": "tool", "name": "submit_case_law_analysis"},
        messages=[{"role": "user", "content": build_user_prompt(req)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "case_law_research missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Case-law research did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)
    payload["matter_id"] = req.matter_id
    return CaseLawResult.model_validate(payload)
