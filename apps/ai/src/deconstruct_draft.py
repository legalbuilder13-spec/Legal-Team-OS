"""Phase 4 — deconstruction + draft memo skill.

Reads everything the prior analysis stages produced (pre-merits flags,
guidance hits, statutory analysis, case-law analysis) plus the
practice-area inventory template, and produces:

1. A flat list of nodes representing the deconstruction tree per PRD
   §12 / how-lawyers-think Part VI. Nodes carry the doctrinal shape
   (rule / standard / factor / right / evidence), procedural posture,
   burden, standard of proof, standard of review, and status
   (open / closed_by_* / deferred). Flat-with-parent_id structure
   keeps the LLM-emit and the UI-render simple.

2. A short IRAC memo (≤500 words) with explicit confidence band,
   mirror-image argument, and "what I don't know" section.

The worker post-checks: threshold nodes at the top (PRD §D10), mirror
image present + non-trivial, confidence band present, no invented
citations (all cites must trace to inputs the worker passed in).
"""

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from .analysis_schemas import FrameFlipProposal, PipelineContext
from .config import settings
from .domain_config import DomainConfig, domain_config_block
from .llm.client import get_client
from .pipeline_context import DEPTH_AND_FRAME_SYSTEM_ADDENDUM, render_context_block

logger = logging.getLogger(__name__)


# ----- Request: prior stage context the worker assembles -----


class PJIAnchor(BaseModel):
    # PR-7 — pattern jury instruction anchor.
    source: str
    section: str
    operative_language: str
    url: str | None = None


class InventoryAnnotations(BaseModel):
    # PR-B — operational annotations from packages/types inventories.
    node_type: str | None = None
    burden_of_production: str | None = None
    burden_of_persuasion: str | None = None
    standard_of_proof: str | None = None
    default_posture: str | None = None
    appellate_standard_of_review: str | None = None
    schaffer_default: bool | None = None
    # PR-7 — PJI anchor for the operative language at trial.
    pji_anchor: PJIAnchor | None = None


class InventoryItemInput(BaseModel):
    id: str
    category: str
    label: str
    description: str
    # PR-B — optional annotations; defaults to None when the inventory
    # hasn't been annotated for this practice area yet. The skill
    # renders these into each leaf and applies Schaffer-default reasoning
    # when burdens are unspecified.
    annotations: InventoryAnnotations | None = None


class PriorStageContext(BaseModel):
    # Worker-passed compact summaries of prior stages. The skill is
    # told NOT to redo statutory/case-law work — just use these as
    # the rule + authority nodes in the tree.
    pre_merits_flags: list[dict] = []  # high-severity raised items
    guidance_top_match: dict | None = None
    # Back-compat single-jurisdiction field (PR1-PR4 callers). New
    # callers populate statutory_summaries[] instead.
    statutory_summary: dict | None = None
    # PR7 — multi-jurisdiction. One entry per jurisdiction that the
    # statutory tool ran against. Each entry includes a 'jurisdiction'
    # key + the compact operative_provisions / ambiguities / readings.
    statutory_summaries: list[dict] = []
    case_law_summary: dict | None = None


class DeconstructRequest(BaseModel):
    matter_id: str
    request_text: str
    # Joined string (back-compat) — e.g., "California / Texas / Federal".
    jurisdiction: str
    # PR7 — canonical list. Single-jurisdiction matters land here as a
    # one-element list.
    jurisdictions: list[str] = []
    practice_area: str
    inventory_version: str
    inventory_items: list[InventoryItemInput]
    prior: PriorStageContext
    # PR12 §15 — organization domain config blended into the prompt.
    domain_config: DomainConfig | None = None
    # PR-A — pipeline context (research_depth + carried doctrinal_frame).
    context: PipelineContext = PipelineContext()
    # PR-8 — contested-doctrines registry for this practice area. Skill
    # checks whether any tree node touches one and, if so, surfaces an
    # alternative frame rather than committing silently.
    contested_doctrines: list[ContestedDoctrineFrameInput] = Field(default_factory=list)


# ----- Response: tree nodes + memo -----


NodeType = Literal['rule', 'standard', 'factor', 'right', 'evidence', 'threshold']
# PR-9 — expanded status enum supports instantiate-then-prune. Every
# candidate inventory item enters the tree as 'open' and the skill must
# close each one explicitly. how-lawyers-think Part VI §D7.
NodeStatus = Literal[
    'open',
    'kept',
    'closed_by_rule',
    'closed_by_stipulation',
    'closed_not_dispositive',
    'closed_by_facts_absent',
    'closed_by_preemption',
    'deferred',
]


HohfeldPosition = Literal['claim_right', 'privilege', 'power', 'immunity']
HohfeldCorrelative = Literal['duty', 'no_right', 'liability', 'disability']


class HohfeldAnalysis(BaseModel):
    # PR-8 — required when node.type == 'right'. Disambiguates the
    # word "right" to one of Hohfeld's four jural positions, with the
    # correlative party and the conduct/relation it concerns.
    # how-lawyers-think Part VI §6.4.
    position: HohfeldPosition
    correlative_party: str
    with_respect_to: str
    correlative_relation: HohfeldCorrelative


class DeconstructionNode(BaseModel):
    id: str
    parent_id: str | None = None
    question: str
    type: NodeType
    status: NodeStatus
    jurisdiction: str | None = None
    # Decomposed per Part VI §D6: every leaf annotated with burden +
    # standard + posture.
    burden_of_production: str | None = None
    burden_of_persuasion: str | None = None
    standard_of_proof: Literal[
        'preponderance', 'clear_and_convincing', 'beyond_reasonable_doubt', 'n_a',
    ] | None = None
    procedural_posture: str | None = None
    standard_of_review: str | None = None
    facts_assigned: str | None = None
    facts_missing: str | None = None
    # Tie back to the source the node derives from (statute cite, case
    # cite, playbook id, etc.). Worker re-checks these are not invented.
    anchor_citation: str | None = None
    notes: str | None = None
    # PR-8 — Hohfeldian disambiguation. REQUIRED when type='right'.
    hohfeld: HohfeldAnalysis | None = None


class ContestedDoctrineFrameInput(BaseModel):
    # PR-8 — worker passes the contested-doctrines registry for the
    # practice area into the request so the skill knows which frames
    # to surface side-by-side.
    id: str
    label: str
    frames: list[str]
    trigger_keywords: list[str]
    canonical_source: str


class AlternativeFrame(BaseModel):
    # PR-8 — when the skill emits frame_choice_required=true, it also
    # supplies the alternative tree (or a summary of how the tree would
    # differ) so the lawyer can compare.
    frame_id: str
    frame_label: str
    one_paragraph_summary: str
    materially_different_nodes: list[str] = Field(default_factory=list)


class IRACMemo(BaseModel):
    issue: str
    rule: str
    application: str
    conclusion: str
    what_i_dont_know: str
    mirror_image_argument: str
    confidence_band: Literal['HIGH', 'MEDIUM', 'LOW', 'SPLIT']
    confidence_basis: str
    word_count: int = Field(le=600)  # buffer over PRD's ≤500 for inline citations


class JurisdictionHarmonization(BaseModel):
    # PR7 — emitted only when multiple jurisdictions ran. One entry
    # per issue that diverges across jurisdictions, plus a list of
    # issues where jurisdictions agree.
    agreement_summary: str
    divergences: list[dict]  # [{issue, by_jurisdiction: {state: holding}, materiality}]
    jurisdiction_specific_carveouts: list[dict]  # [{jurisdiction, carveout, citation}]


class DeconstructResult(BaseModel):
    matter_id: str
    nodes: list[DeconstructionNode]
    memo: IRACMemo
    inventory_categories_addressed: list[str]
    inventory_items_pruned: list[str]
    # PR7 — only populated when prior.statutory_summaries has > 1
    # jurisdiction. Single-jurisdiction matters return None.
    multi_jurisdiction_harmonization: JurisdictionHarmonization | None = None
    verify_flags: list[str] = Field(default_factory=list, max_length=3)
    # PR-A — optional frame flip when synthesis turns up authority
    # inconsistent with the carried doctrinal frame.
    frame_flip_proposal: FrameFlipProposal | None = None
    # PR-8 — when the tree touches a contested doctrine, the skill
    # surfaces the alternative frame rather than picking silently.
    # The lawyer accepts one frame; the skill is re-invoked with the
    # chosen frame locked in.
    frame_choice_required: bool = False
    alternative_frames: list[AlternativeFrame] = Field(default_factory=list)
    frame_choice_explanation: str | None = None


# ----- Prompt -----


SYSTEM_PROMPT = """You are the deconstruction + draft memo skill for an in-house legal team's research tool. You \
are given (1) the matter request, (2) compact summaries of prior analysis stages the pipeline has already run \
(pre-merits threshold flags, on-point playbook match if any, statutory analysis output, case-law analysis output), \
and (3) a per-practice-area inventory template listing candidate issues.

You produce two things:

1. **A deconstruction tree** as a flat list of nodes with parent_id references. Each node represents a question \
the analysis must answer. PRD §12.1 + how-lawyers-think Part VI define the shape: every node carries a doctrinal \
type (rule / standard / factor / right / evidence / threshold) and a status (open / closed_by_*).

2. **An IRAC memo** (≤500 words): Issue, Rule, Application, Conclusion + the explicit "what I don't know" \
section + mirror-image argument + confidence band.

# Hard rules

## Threshold-first ordering
Threshold nodes (limitations, standing, jurisdiction, preemption, arbitration, choice of law) MUST be at the top \
of the tree (parent_id=null OR parent_id pointing to another threshold node). Never bury a threshold below a \
merits node. This is PRD §D10 + Steel Co. v. Citizens for a Better Environment — a dispositive threshold makes \
merits analysis moot.

## Use prior stage outputs as the rule + authority layer
Do NOT redo statutory or case-law work. If the statutory stage already identified the operative provision, your \
'rule' node references that cite via anchor_citation. If case-law produced controlling authority, your relevant \
nodes inherit that. You are synthesizing, not researching.

## Instantiate-then-prune (PR-9 — supersedes prior "selective pickup")
The inventory_items list is the COMPLETE set of candidate issues for the practice area. EVERY inventory item \
MUST appear in your output as a node with a status. No silent omission. This forces the specialist's \
full-inventory move — running through the checklist — rather than picking only the items the request makes \
obvious.

Allowable statuses:
- 'kept' — node carried forward into the live decomposition. Add children, annotations, anchor citation.
- 'closed_by_rule' — a rule resolves the question without further fact-development.
- 'closed_by_stipulation' — undisputed or conceded by the parties.
- 'closed_not_dispositive' — present but does not affect the outcome.
- 'closed_by_facts_absent' — the facts that would make this relevant are not in the request.
- 'closed_by_preemption' — preempted by another regime (ERISA, Copyright §301, etc.).
- 'deferred' — material but cannot be resolved without more information; surface via verify_flags.

`inventory_items_pruned` (legacy field) lists IDs you closed for any reason. `inventory_categories_addressed` \
lists the categories with at least one 'kept' node.

## Decomposition by node type
- 'rule' → state the elements, decompose into element-level children
- 'standard' → enumerate balancing factors as children (e.g., reasonableness factors)
- 'factor' → leaf, weighted; not further decomposed
- 'right' → REQUIRED Hohfeldian disambiguation (PR-8). Populate node.hohfeld with:
    position ∈ {claim_right, privilege, power, immunity};
    correlative_party (who has the corresponding duty/no_right/liability/disability);
    with_respect_to (the conduct or relation at issue);
    correlative_relation ∈ {duty, no_right, liability, disability}.
  A 'right' node without hohfeld is not actionable — it conflates four distinct legal positions.
- 'evidence' → Wigmorean trace from evidence → interim probandum → ultimate probandum
- 'threshold' → jurisdiction/limitations/etc., resolved or deferred

## Contested-doctrine frame-check (PR-8)
If your tree touches a doctrine listed in `contested_doctrines`, you MUST surface the alternative \
decomposition frame rather than silently picking one. Set frame_choice_required=true, populate \
alternative_frames with one entry per competing frame (frame_id, frame_label, one_paragraph_summary, \
materially_different_nodes), and frame_choice_explanation: 2–4 sentences naming what the lawyer must \
decide and what changes downstream. Example: a negligence matter triggers torts_duty — emit the tree \
under restatement_third_duty_as_filter AND populate alternative_frames with the foreseeability_first \
alternative. The Goldberg/Zipursky lesson: a wrong frame poisons every downstream node.

## Annotation per leaf (PRD §D6)
Every leaf node MUST have: jurisdiction, procedural_posture, standard_of_review (where applicable), burden of \
production + persuasion, and standard_of_proof. Mid-tree nodes may omit if not yet dispositive.

## Memo discipline
- ≤500 words (we allow up to 600 to accommodate inline citations).
- 'rule' section must cite the operative authority from the statutory + case-law stages. No invented cites.
- 'what_i_dont_know' is mandatory and non-empty. Genuine uncertainty disclosed.
- 'mirror_image_argument' is mandatory and non-trivial (≥30 chars).
- 'confidence_band': HIGH only when both readings agree + controlling authority is on-point + no live ambiguity; \
MEDIUM when readings diverge or only persuasive authority available; LOW when pre-merits flags or verification \
failures upstream block confident delivery; SPLIT when authorities are in genuine conflict.

## Verify flags (max 3)
Use for: nodes whose facts you couldn't assign from the request, citations you want the lawyer to double-check, \
or assertions you couldn't anchor to a prior stage.

## Multi-jurisdiction harmonization (PRD §19.5)
When `prior.statutory_summaries` contains more than one entry (i.e., the statutory tool ran against multiple \
jurisdictions), you MUST also populate `multi_jurisdiction_harmonization`:
- `agreement_summary`: 1-3 sentences on where the jurisdictions agree.
- `divergences[]`: each entry is an issue where jurisdictions diverge, with the per-jurisdiction holding and a \
materiality label ("dispositive", "shifts-cost", "minor"). Cite the specific operative provision from each \
jurisdiction's summary that drives the divergence.
- `jurisdiction_specific_carveouts[]`: list jurisdiction-specific exemptions, carve-outs, or unique \
requirements that don't appear in the other jurisdictions.
When only one summary is present, return `multi_jurisdiction_harmonization=null` and treat the analysis as \
single-jurisdiction.""" + DEPTH_AND_FRAME_SYSTEM_ADDENDUM


TOOL = {
    "name": "submit_deconstruction",
    "description": "Submit the deconstruction tree + IRAC memo.",
    "input_schema": DeconstructResult.model_json_schema(),
}


def build_user_prompt(req: DeconstructRequest) -> str:
    parts: list[str] = [
        f"Matter ID: {req.matter_id}",
        f"Jurisdiction: {req.jurisdiction}",
        f"Practice area: {req.practice_area}",
        "",
        "--- Matter request ---",
        req.request_text,
        "",
    ]
    if req.prior.pre_merits_flags:
        parts.append("--- Pre-merits flags (Stage 0) ---")
        for f in req.prior.pre_merits_flags:
            parts.append(f"- [{f.get('id')}] {f.get('one_line_justification', '')}")
            if f.get('evidence_quote'):
                parts.append(f"    evidence: \"{f['evidence_quote']}\"")
        parts.append("")
    if req.prior.guidance_top_match:
        parts.append("--- Top guidance match (Stage 1) ---")
        g = req.prior.guidance_top_match
        parts.append(f"  {g.get('citation', '(no citation)')}")
        parts.append(f"  {g.get('summary', '')}")
        parts.append("")
    # PR7 — render statutory summaries grouped by jurisdiction. Falls
    # back to the back-compat single-summary path if statutory_summaries
    # is empty but statutory_summary is set.
    summaries = req.prior.statutory_summaries or (
        [req.prior.statutory_summary] if req.prior.statutory_summary else []
    )
    if summaries:
        parts.append(
            f"--- Statutory analysis ({len(summaries)} jurisdiction"
            f"{'s' if len(summaries) > 1 else ''}) ---"
        )
        for s in summaries:
            if not s:
                continue
            juris = s.get('jurisdiction', 'unspecified')
            parts.append(f"\n[Jurisdiction: {juris}]")
            if s.get('operative_provisions'):
                parts.append("  Operative provisions:")
                for p in s['operative_provisions']:
                    parts.append(f"    - {p.get('citation')}: {p.get('quoted_text', '')[:160]}")
            if s.get('ambiguities'):
                parts.append(f"  Ambiguities: {len(s['ambiguities'])}")
            if s.get('textualist_reading'):
                parts.append(f"  Textualist: {s['textualist_reading'][:300]}")
            if s.get('purposivist_reading'):
                parts.append(f"  Purposivist: {s['purposivist_reading'][:300]}")
        if len(summaries) > 1:
            parts.append("")
            parts.append(
                "MULTI-JURISDICTION: populate multi_jurisdiction_harmonization in your output."
            )
        parts.append("")
    if req.prior.case_law_summary:
        parts.append("--- Case-law analysis (Stage 2b) ---")
        c = req.prior.case_law_summary
        if c.get('controlling_authority'):
            parts.append("Controlling authority:")
            for ca in c['controlling_authority']:
                parts.append(f"  - {ca.get('cite')}: {ca.get('holding', '')[:200]}")
        if c.get('anti_analogous_cases'):
            parts.append(f"Anti-analogous cases surfaced: {len(c['anti_analogous_cases'])}")
        parts.append("")
    parts.append(f"--- Practice-area inventory ({len(req.inventory_items)} candidate issues) ---")
    for item in req.inventory_items:
        parts.append(f"- [{item.category}/{item.id}] {item.label}: {item.description[:160]}")
        if item.annotations:
            a = item.annotations
            ann_parts: list[str] = []
            if a.node_type:
                ann_parts.append(f"type={a.node_type}")
            if a.burden_of_persuasion:
                ann_parts.append(f"burden_persuasion={a.burden_of_persuasion}")
            if a.burden_of_production:
                ann_parts.append(f"burden_production={a.burden_of_production}")
            if a.standard_of_proof:
                ann_parts.append(f"std={a.standard_of_proof}")
            if a.default_posture:
                ann_parts.append(f"posture={a.default_posture}")
            if a.appellate_standard_of_review:
                ann_parts.append(f"review={a.appellate_standard_of_review}")
            if ann_parts:
                parts.append(f"    annotations: {', '.join(ann_parts)}")
            if a.pji_anchor:
                pji = a.pji_anchor
                parts.append(
                    f"    PJI {pji.source} {pji.section}: \"{pji.operative_language}\""
                )
    parts.append(domain_config_block(req.domain_config))
    if req.contested_doctrines:
        parts.append("")
        parts.append("--- Contested doctrines in this practice area (PR-8) ---")
        for cd in req.contested_doctrines:
            parts.append(
                f"- [{cd.id}] {cd.label} — frames: {', '.join(cd.frames)}"
            )
            parts.append(f"    triggers: {', '.join(cd.trigger_keywords)}")
            parts.append(f"    canonical: {cd.canonical_source}")
        parts.append(
            "When a tree node touches one of these, set frame_choice_required=true and populate "
            "alternative_frames."
        )
    parts.append(render_context_block(req.context))
    return "\n".join(parts)


def deconstruct_and_draft(req: DeconstructRequest) -> DeconstructResult:
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
        tool_choice={"type": "tool", "name": "submit_deconstruction"},
        messages=[{"role": "user", "content": build_user_prompt(req)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "deconstruct missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Deconstruct skill did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)
    payload["matter_id"] = req.matter_id
    return DeconstructResult.model_validate(payload)
