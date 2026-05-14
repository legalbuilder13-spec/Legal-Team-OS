"""Stage 2a — statutory & regulatory analysis skill.

Implements the core of PRD §8 against text the worker has already fetched
from a primary source (Cornell LII, eCFR, Justia, etc.). The skill reads
the statute text + the matter request and returns a typed structured
analysis: operative provisions with verbatim quotes, definitions,
applicability, ambiguities (classified), canons applied, textualist +
purposivist readings with the gap surfaced, notable absences, and a
self-audit. The worker post-processes confidence + screenshot-and-compare
verification.

Hard rules the prompt enforces:
- Verbatim quotes must be findable in the supplied source text. The
  worker re-checks this; quoted strings that aren't in the source are
  rejected and the stage is forced to LOW confidence.
- Both textualist and purposivist readings are required. The gap
  between them is the lawyer's confidence band.
- Ambiguities are classified explicitly (semantic / syntactic / latent /
  vagueness) per how-lawyers-think.md Part II.5 step 9.
- Adversarial doubling: every reading must surface its strongest
  opposing reading, not silently pick one.
"""

import json
import logging

from pydantic import BaseModel, Field
from typing import Literal

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


# ----- Request / response schemas (mirror packages/types) -----


class StatuteSource(BaseModel):
    citation: str
    url: str
    source_type: Literal["cornell_lii", "ecfr", "justia", "generic"]
    fetched_at: str
    raw_text: str  # text the skill must trace every quote to
    hash: str


class StatuteAnalysisRequest(BaseModel):
    matter_id: str
    request_text: str
    jurisdiction: str
    practice_area: str
    sources: list[StatuteSource]
    # Lawyer can pre-narrow the analysis by candidate statute citation;
    # the skill is told these are the focus rather than the whole text.
    focus_citations: list[str] = []


AmbiguityType = Literal["semantic", "syntactic", "latent", "vagueness"]


class ParsedOperator(BaseModel):
    token: Literal[
        "shall", "may", "must", "and", "or", "unless", "except", "subject_to",
        "notwithstanding", "if", "upon", "provided_that", "means", "includes",
    ]
    role: str  # "mandatory" | "permissive" | "conjunctive" | etc.
    subject: str
    object: str


class OperativeProvision(BaseModel):
    citation: str
    quoted_text: str  # verbatim from raw_text; worker verifies
    who_subject: str
    what_required: str
    when_applies: str | None = None
    parsed_operators: list[ParsedOperator] = []
    source_hash: str  # which source row this quote came from


class StatuteDefinition(BaseModel):
    term: str
    definition_quoted: str
    scope_effect: Literal["narrows", "expands", "clarifies", "neutral"]
    source_hash: str


class StatuteAmbiguity(BaseModel):
    type: AmbiguityType
    text: str  # the ambiguous statutory text
    alternative_readings: list[str]
    why_ambiguous: str


class CanonApplication(BaseModel):
    canon_id: str  # 'plain_meaning', 'whole_act', 'surplusage', 'ejusdem_generis', etc.
    supports_reading: Literal["A", "B", "neutral"]
    one_line_rationale: str
    weight: Literal["high", "medium", "low"]  # PRD §8.7 Gluck/Bressman defaults


class CanonConflict(BaseModel):
    canons: list[str]
    reading_a_one_line: str
    reading_b_one_line: str
    preferred: Literal["A", "B", "unresolved"]
    reasoning: str


class NotableAbsence(BaseModel):
    item: str  # e.g., "no private right of action"
    significance: str


class SelfAudit(BaseModel):
    quotation_check_passed: bool
    section_number_check_passed: bool
    gap_check_passed: bool  # i.e., output noted what statute is silent on
    source_mixing_check_passed: bool
    flags: list[str]


class StatuteAnalysisResult(BaseModel):
    matter_id: str
    operative_provisions: list[OperativeProvision]
    definitions_used: list[StatuteDefinition]
    applicability_to_facts: str
    ambiguities: list[StatuteAmbiguity]
    canons_applied: list[CanonApplication]
    canon_conflicts: list[CanonConflict] = []
    textualist_reading: str
    purposivist_reading: str
    gap_between_readings: str
    mirror_image_argument: str  # adversarial doubling, PRD §10.6 / II.6
    notable_absences: list[NotableAbsence]
    confidence_self_assessment: Literal["HIGH", "MEDIUM", "LOW"]
    confidence_basis: str
    verify_flags: list[str] = Field(default_factory=list, max_length=3)
    self_audit: SelfAudit


# ----- Prompt -----


SYSTEM_PROMPT = """You are the statutory & regulatory analysis skill for an in-house legal team's research tool. \
You are given (1) a matter request, (2) the full text of one or more primary-source statutory or regulatory \
provisions the lawyer wants analyzed, and (3) the jurisdiction and practice area.

You produce a structured analysis following the methodology in the project's PRD §8. Your output is reviewed \
by a lawyer; never deliver an analysis built on guesses.

# Hard rules

## The Quoting Rule
Every string you put in `quoted_text` MUST be verbatim from the supplied source text (raw_text of one of the \
sources). The worker re-checks this with exact-string matching after you return. If you cannot find a verbatim \
passage that supports a claim, do not claim it — flag it under verify_flags instead, or drop the claim.

## Two readings + the gap
You must produce BOTH a textualist reading (ordinary public meaning at enactment, semantic + structural context) \
AND a purposivist reading (the statute as a purposive instrument addressing a mischief). Then describe the gap \
between them in one or two sentences. A lawyer-facing analysis with only one reading is rejected by the worker.

## Mirror-image argument
Every analysis must include the strongest reading AGAINST the matter's apparent position — the mirror-image \
argument. An empty or trivial mirror_image_argument is rejected.

## Ambiguity classification
For each ambiguity you spot, classify by type:
- semantic — discrete alternative meanings of a word
- syntactic — sentence-structure ambiguity (last-antecedent / series-qualifier)
- latent — clear on its face, ambiguous when applied to these facts
- vagueness — fuzzy edges of a continuous concept

Do not paper over ambiguity. Flagging genuine ambiguity is a USEFUL output, not a defect.

## Canon weighting (Gluck/Bressman empirical defaults)
- HIGH weight: whole-act, surplusage, definitions
- MEDIUM weight: noscitur a sociis, ejusdem generis, plain meaning, in pari materia
- LOW weight: expressio unius, consistent-usage canon
- Substantive canons (lenity, federalism clear-statement, constitutional avoidance): situational; flag and weight \
explicitly per matter.

When canons conflict, surface the conflict in canon_conflicts with both readings. Do not silently pick a side.

## Confidence
- HIGH only when text is clear AND verified verbatim AND no live ambiguity.
- MEDIUM when one or more ambiguities exist OR provisions you wanted weren't supplied.
- LOW when the text doesn't support a confident answer to the matter request. Lawyer-facing delivery is blocked \
on LOW; honesty here saves rework.

## Verify flags
Use sparingly — at most 3. Format each as "[claim] against [specific source]". If you're tempted to file more than \
3, you're under-grounding; reconsider what you're asserting.

## Self-audit (mandatory)
Before returning, run the self-audit checklist:
- quotation_check: every quoted passage traced to a supplied source?
- section_number_check: every cite has a real anchor in the sources?
- gap_check: did you note what the statute is silent on?
- source_mixing_check: did you avoid presenting summary/inferred language as quoted statute?

If any check fails, set its boolean to false and add a flags entry explaining why."""


TOOL = {
    "name": "submit_statute_analysis",
    "description": "Submit the structured statutory analysis for the matter.",
    "input_schema": StatuteAnalysisResult.model_json_schema(),
}


def build_user_prompt(req: StatuteAnalysisRequest) -> str:
    parts: list[str] = [
        f"Matter ID: {req.matter_id}",
        f"Jurisdiction: {req.jurisdiction}",
        f"Practice area: {req.practice_area}",
        "",
        "--- Matter request ---",
        req.request_text,
        "",
    ]
    if req.focus_citations:
        parts.append("--- Focus on these citations ---")
        for c in req.focus_citations:
            parts.append(f"- {c}")
        parts.append("")
    parts.append(f"--- Primary source text ({len(req.sources)} sources) ---")
    for s in req.sources:
        parts.append("")
        parts.append(f"[citation] {s.citation}")
        parts.append(f"[url] {s.url}")
        parts.append(f"[source] {s.source_type}")
        parts.append(f"[fetched_at] {s.fetched_at}")
        parts.append(f"[hash] {s.hash}")
        parts.append("[text]")
        # The full raw_text is included — the model needs the complete
        # provision to do whole-act / surplusage / ambiguity analysis.
        # The worker bounds source length upstream.
        parts.append(s.raw_text)
    return "\n".join(parts)


def analyze_statute(req: StatuteAnalysisRequest) -> StatuteAnalysisResult:
    if not req.sources:
        # No sources fetched — the skill cannot run. Return a stub that
        # the worker flags as LOW + escalates.
        return StatuteAnalysisResult(
            matter_id=req.matter_id,
            operative_provisions=[],
            definitions_used=[],
            applicability_to_facts="No primary source text was supplied; statutory analysis cannot proceed.",
            ambiguities=[],
            canons_applied=[],
            canon_conflicts=[],
            textualist_reading="",
            purposivist_reading="",
            gap_between_readings="",
            mirror_image_argument="",
            notable_absences=[],
            confidence_self_assessment="LOW",
            confidence_basis="No primary source text supplied.",
            verify_flags=[],
            self_audit=SelfAudit(
                quotation_check_passed=True,
                section_number_check_passed=True,
                gap_check_passed=True,
                source_mixing_check_passed=True,
                flags=["no_sources_supplied"],
            ),
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
        tool_choice={"type": "tool", "name": "submit_statute_analysis"},
        messages=[{"role": "user", "content": build_user_prompt(req)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "statute_analysis missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Statute analysis did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)
    payload["matter_id"] = req.matter_id

    return StatuteAnalysisResult.model_validate(payload)
