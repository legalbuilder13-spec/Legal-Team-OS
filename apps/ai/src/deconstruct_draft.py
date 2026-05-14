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

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


# ----- Request: prior stage context the worker assembles -----


class InventoryItemInput(BaseModel):
    id: str
    category: str
    label: str
    description: str


class PriorStageContext(BaseModel):
    # Worker-passed compact summaries of prior stages. The skill is
    # told NOT to redo statutory/case-law work — just use these as
    # the rule + authority nodes in the tree.
    pre_merits_flags: list[dict] = []  # high-severity raised items
    guidance_top_match: dict | None = None
    statutory_summary: dict | None = None  # operative provisions + ambiguities + readings
    case_law_summary: dict | None = None  # controlling + anti-analogous + mirror image


class DeconstructRequest(BaseModel):
    matter_id: str
    request_text: str
    jurisdiction: str
    practice_area: str
    inventory_version: str
    inventory_items: list[InventoryItemInput]
    prior: PriorStageContext


# ----- Response: tree nodes + memo -----


NodeType = Literal['rule', 'standard', 'factor', 'right', 'evidence', 'threshold']
NodeStatus = Literal[
    'open',
    'closed_by_rule',
    'closed_by_stipulation',
    'closed_not_dispositive',
    'deferred',
]


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


class DeconstructResult(BaseModel):
    matter_id: str
    nodes: list[DeconstructionNode]
    memo: IRACMemo
    inventory_categories_addressed: list[str]
    inventory_items_pruned: list[str]
    verify_flags: list[str] = Field(default_factory=list, max_length=3)


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

## Inventory pruning
The inventory_items list is candidate issues for the practice area. Most won't be relevant to this matter. Prune \
ruthlessly — only create nodes for issues that the facts and prior stages put in play. Record what you pruned in \
inventory_items_pruned. Record what you kept in inventory_categories_addressed.

## Decomposition by node type
- 'rule' → state the elements, decompose into element-level children
- 'standard' → enumerate balancing factors as children (e.g., reasonableness factors)
- 'factor' → leaf, weighted; not further decomposed
- 'right' → Hohfeldian — which jural position (claim / privilege / power / immunity), against whom
- 'evidence' → Wigmorean trace from evidence → interim probandum → ultimate probandum
- 'threshold' → jurisdiction/limitations/etc., resolved or deferred

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
or assertions you couldn't anchor to a prior stage."""


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
    if req.prior.statutory_summary:
        parts.append("--- Statutory analysis (Stage 2a) ---")
        s = req.prior.statutory_summary
        if s.get('operative_provisions'):
            parts.append("Operative provisions:")
            for p in s['operative_provisions']:
                parts.append(f"  - {p.get('citation')}: {p.get('quoted_text', '')[:160]}")
        if s.get('ambiguities'):
            parts.append(f"Ambiguities: {len(s['ambiguities'])}")
        if s.get('textualist_reading'):
            parts.append(f"Textualist: {s['textualist_reading'][:300]}")
        if s.get('purposivist_reading'):
            parts.append(f"Purposivist: {s['purposivist_reading'][:300]}")
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
