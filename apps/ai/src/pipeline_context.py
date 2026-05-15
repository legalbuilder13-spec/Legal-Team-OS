"""PR-A — shared helpers for rendering pipeline context into prompts.

Every analysis skill receives a PipelineContext (research_depth +
optional doctrinal_frame). These helpers render the context as
prompt text and produce a system-prompt addendum teaching the model
how to behave by depth and how to propose a frame flip.
"""

from .analysis_schemas import PipelineContext

# Appended to every skill's system prompt. Teaches frame-flip etiquette
# and depth-conditioned behavior in language the model can act on.
DEPTH_AND_FRAME_SYSTEM_ADDENDUM = """\
---

ANALYSIS DEPTH AND DOCTRINAL FRAME (read carefully — applies to every output you produce)

You will receive a `research_depth` and an optional carried `doctrinal_frame` in the user message. \
Adjust your behavior accordingly.

Research depth — calibrate your hedging, verification, and assertiveness:
- `quick_take`: A Slack /legal triage request. One pass is fine. Hedge heavily on close calls. \
You are NOT being asked to file this; you are being asked to orient the lawyer.
- `client_advice`: The default. Standard discipline. Hedge when authority is genuinely split.
- `filing_grade`: Work product that will be filed or sent to a client. Do not hedge unnecessarily. \
Take a position when the law supports one. Surface every supporting authority you can ground.
- `bet_the_company`: Every assumption must be defensible. No claim without a verbatim quote. \
If you would not stake your reputation on it, drop confidence to LOW and say why explicitly.

Doctrinal frame — Bayesian state, not decoration:
The `doctrinal_frame.primary_regime` is the pipeline's current hypothesis about what governs \
this matter (e.g., "ERISA_preempted", "state_common_law_contract", "FAA_arbitration", \
"title_VII_disparate_treatment"). Earlier stages set it; later stages may revise it.

You MUST analyze under the carried frame. You MAY propose a flip — and you SHOULD when \
authority you encounter directly undermines the carried frame. Examples that trigger a flip:
- Stage 0 framed this as a state-law breach claim; you find the contract is governed by ERISA.
- Stage 0 framed this as merits; you find an arbitration clause that swallows the dispute.
- Earlier stage assumed federal jurisdiction; the parties are non-diverse.

When you propose a flip, set `frame_flip_proposal` with:
- `from_frame`: the carried primary_regime (or null if no frame was carried).
- `to_frame`: a short label for the regime you would substitute.
- `evidence_quote`: a VERBATIM string supporting the flip — the text that made you change your mind.
- `evidence_citation`: the cite, if you have one (USC section, case name, etc.).
- `rationale`: one to three sentences explaining why the new frame fits and the old doesn't.
- `confidence`: your confidence the flip is correct (0.0–1.0).

Do NOT silently reinterpret the question under a different frame. Either work the carried \
frame, or propose a flip and let the lawyer decide.

---

ESCALATION (PR-11) — when to raise your hand instead of producing output

You may emit `escalation_request` on your response when you encounter any of the following. Escalation \
is an expert move (see how-lawyers-think Part IV §6 / V.17), not a failure. Use sparingly; not every \
hard question warrants it.

Conditions that justify escalation:
- `practice_area_mismatch` — the routing is clearly wrong (HIPAA breach routed to commercial, etc.).
- `jurisdiction_outside_competence` — analysis requires a jurisdiction the firm's playbooks don't cover.
- `unresolvable_frame_flip` — you can't ground a frame flip you would otherwise propose; the lawyer \
  needs to make the doctrinal call.
- `too_many_missing_facts` — after absence-spotter resolution, three or more high-severity facts \
  remain unresolved.
- `authority_directly_contradicts_prior_stage` — you found a controlling authority that flatly \
  contradicts what an earlier stage relied on; this is more than a frame flip.
- `novel_legal_question` — no on-point authority within reasonable retrieval scope; the question is \
  genuinely novel.
- `verification_failure` — your own self-audit failed in a way you can't repair.

When you escalate, set `escalation_request` with:
- `reason`: one of the values above.
- `detail`: 1-3 sentences explaining what you encountered.
- `recommended_next_step`: what the lawyer should do (re-route, consult a senior, contact outside \
  counsel for jurisdiction X, etc.).

Producing a partial output AND escalating is fine. Producing a confident output when escalation is \
warranted is the failure mode — that's the abdication trap.
"""

# Output-schema fragment for escalation_request. Reused across every
# skill's TOOL input_schema so escalation can be raised uniformly.
ESCALATION_REQUEST_SCHEMA = {
    "type": ["object", "null"],
    "properties": {
        "reason": {
            "type": "string",
            "enum": [
                "practice_area_mismatch",
                "jurisdiction_outside_competence",
                "unresolvable_frame_flip",
                "too_many_missing_facts",
                "authority_directly_contradicts_prior_stage",
                "novel_legal_question",
                "verification_failure",
            ],
        },
        "detail": {"type": "string"},
        "recommended_next_step": {"type": "string"},
    },
    "required": ["reason", "detail", "recommended_next_step"],
}


# Output-schema fragment for frame_flip_proposal. Reused across every
# skill's TOOL input_schema so the wire shape stays identical.
FRAME_FLIP_PROPOSAL_SCHEMA = {
    "type": ["object", "null"],
    "properties": {
        "from_frame": {"type": ["string", "null"]},
        "to_frame": {"type": "string"},
        "evidence_quote": {"type": "string"},
        "evidence_citation": {"type": ["string", "null"]},
        "rationale": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
    },
    "required": ["to_frame", "evidence_quote", "rationale", "confidence"],
}


def render_context_block(ctx: PipelineContext) -> str:
    """Render the carried context as a prompt block. Always rendered,
    even when defaults — the model behaves better when told what it has."""
    parts: list[str] = ["", "--- Pipeline context ---"]
    parts.append(f"research_depth: {ctx.research_depth}")
    if ctx.doctrinal_frame is None:
        parts.append("doctrinal_frame: (none carried — you are establishing the frame)")
    else:
        f = ctx.doctrinal_frame
        parts.append(f"doctrinal_frame.primary_regime: {f.primary_regime}")
        parts.append(f"doctrinal_frame.last_updated_by_stage: {f.last_updated_by_stage}")
        parts.append(f"doctrinal_frame.flip_count: {f.flip_count}")
        if f.alternative_regimes:
            alts = ", ".join(f"{a.regime}(prior={a.prior:.2f})" for a in f.alternative_regimes)
            parts.append(f"doctrinal_frame.alternative_regimes: {alts}")
        else:
            parts.append("doctrinal_frame.alternative_regimes: (none)")
    return "\n".join(parts)
