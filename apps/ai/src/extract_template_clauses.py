"""PR #6 — Extract reusable clauses from a monolithic template body.

A template like a vendor MSA is typically a sequence of ~10-30 distinct
clauses (governing law, indemnification, confidentiality, term, etc.).
This skill identifies those boundaries and proposes each clause as a
candidate for the shared clause library. The worker writes proposals
to clause_extractions; an admin reviews + accepts in /admin/clauses.

Conservative by design: the prompt instructs Claude to favor splitting
on clear semantic boundaries (numbered sections, bold headings, distinct
topics) and to label each clause with a short canonical name + suggested
jurisdictions. If the template doesn't decompose cleanly (a paragraph
of prose without sections), the skill returns an empty list rather
than guessing.
"""

import json
import logging

from pydantic import BaseModel

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


class ExtractClausesRequest(BaseModel):
    template_id: str
    template_name: str
    practice_area: str
    matter_type: str | None = None
    body: str


class ProposedClause(BaseModel):
    name: str  # short canonical name, e.g. "Governing Law", "Mutual Indemnification"
    body: str  # verbatim text from the template
    suggested_jurisdictions: list[str] = []  # e.g. ["US", "CA"] or [] for universal
    rationale: str  # why this is a good reusable clause vs. template-specific


class ExtractClausesResult(BaseModel):
    template_id: str
    proposed_clauses: list[ProposedClause]


SYSTEM_PROMPT = """You are decomposing a legal template (contract, MSA, BAA, etc.) into reusable clauses \
that can live in a shared clause library. The library lets the firm update its standard governing-law \
position once and have all 12 templates that use it pick up the change.

Each proposed clause must be:
- Self-contained (readable without the surrounding template)
- Reusable (the same clause text could plausibly appear in another template of similar type)
- Verbatim from the source body (you do not rewrite — only split + name)

For each clause:
- name: short canonical name in title case, e.g. "Governing Law", "Mutual Indemnification", "Term and Termination"
- body: the EXACT text from the template (no paraphrase)
- suggested_jurisdictions: array of jurisdiction codes (e.g. ["US", "CA", "NY"]) if the \
  clause is jurisdiction-specific. Use ["*"] or [] for clauses that apply universally.
- rationale: 1 sentence explaining why this clause is reusable

Strict rules:
- DO NOT split if the template is a single contiguous prose paragraph without natural breaks. Return an empty list.
- DO NOT propose a clause shorter than 50 characters — that's not a clause, it's a sentence fragment.
- DO NOT include preamble, signature blocks, or boilerplate definitions sections as separate clauses.
- DO NOT modify the body text. Only split.
- A heavily template-specific clause (mentioning the counterparty by name, or with bracketed placeholders \
  unique to this template) is a SIGNAL not to extract — it's not reusable. Skip it.

Be ruthlessly conservative. Bad clause proposals waste lawyer review time."""


TOOL = {
    "name": "submit_clauses",
    "description": "Submit the reusable clauses extracted from this template.",
    "input_schema": {
        "type": "object",
        "properties": {
            "proposed_clauses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "minLength": 3, "maxLength": 80},
                        "body": {"type": "string", "minLength": 50},
                        "suggested_jurisdictions": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "rationale": {"type": "string", "minLength": 10},
                    },
                    "required": ["name", "body", "rationale"],
                },
            },
        },
        "required": ["proposed_clauses"],
    },
}


def _build_user_prompt(request: ExtractClausesRequest) -> str:
    matter_type = f" ({request.matter_type})" if request.matter_type else ""
    return (
        f"Template: {request.template_name}{matter_type}\n"
        f"Practice area: {request.practice_area}\n"
        f"\n"
        f"--- Template body ---\n{request.body}\n--- end body ---\n"
        f"\n"
        f"Decompose this into reusable clauses. Return verbatim splits only."
    )


def extract_template_clauses(
    request: ExtractClausesRequest,
) -> ExtractClausesResult:
    body = (request.body or "").strip()
    if len(body) < 200:
        # Too short to be meaningfully decomposable.
        return ExtractClausesResult(template_id=request.template_id, proposed_clauses=[])

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
        tool_choice={"type": "tool", "name": "submit_clauses"},
        messages=[{"role": "user", "content": _build_user_prompt(request)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "extract_template_clauses missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Clause-extraction skill did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    proposed: list[ProposedClause] = []
    for c in payload.get("proposed_clauses", []):
        body_text = (c.get("body") or "").strip()
        # Defensive: enforce length floor server-side too.
        if len(body_text) < 50:
            continue
        proposed.append(
            ProposedClause(
                name=c["name"],
                body=body_text,
                suggested_jurisdictions=c.get("suggested_jurisdictions", []) or [],
                rationale=c["rationale"],
            )
        )

    return ExtractClausesResult(
        template_id=request.template_id, proposed_clauses=proposed
    )
