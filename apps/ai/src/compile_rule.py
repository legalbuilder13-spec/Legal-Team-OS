import json
import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)

COMPILER_VERSION = "v1-anthropic-2026-05"

# Per-kind operator + field documentation. The compiler prompt injects
# the section matching the rule kind so the LLM knows exactly what
# fields and operators it can target. Keeps compiler output within the
# evaluator's known surface area.

KIND_FIELD_HINTS = {
    "sla": """\
Available fields:
- matter.practice_area: one of commercial, employment, privacy, litigation,
  corporate, regulatory, ip, real_estate, other
- matter.priority: high / medium / low
- matter.counterparty_name: string
- matter.counterparty_domain: string
- counterparty.industry: string (Salesforce industry value)
- counterparty.annual_revenue: number

Action: { "sla_hours": <integer 1-2160> }
""",
    "routing": """\
Available fields:
- matter.practice_area, matter.priority, matter.counterparty_name,
  matter.counterparty_domain (as above)
- counterparty.industry, counterparty.annual_revenue (as above)
- requester.role: attorney / legal_ops / admin / requester
- requester.department: string

Action: {
  "assignee_id": <uuid> (optional),
  "assignee_practice_area": <practice area> (optional),
  "sla_hours": <integer 1-2160> (optional)
}
At least one of these must be present.
""",
    "triage": """\
Available fields:
- matter.request_text: full text (use 'contains', 'matches', 'starts_with')
- requester.email, requester.department

Action: {
  "set_practice_area": <practice area> (optional),
  "set_priority": high/medium/low (optional),
  "posture_override": <practice area> (optional, e.g. force 'litigation' for adversarial posture)
}
""",
    "playbook_trigger": """\
Available fields:
- clause.text: clause body
- clause.heading_path: clause heading path

Action: {
  "topic": <string>,
  "flag_severity": STANDARD / MODIFIED / FLAGGED
}
""",
}

COMPILE_SYSTEM_PROMPT = """You are a rule compiler. Translate the attorney's English rule \
into a structured DSL that a deterministic evaluator can run.

Output structure:
{
  "when": <Condition>,
  "then": <Action — kind-specific>,
  "fallback_llm": <bool — true ONLY if the rule has semantics the deterministic evaluator
                  can't capture; the runtime will then ask an LLM at evaluation time>
}

Condition grammar:
- Leaf: { "field": "<dotted.path>", "op": "<operator>", "value": <string|number|boolean|array> }
- All: { "all": [Condition, ...] }
- Any: { "any": [Condition, ...] }
- Not: { "not": Condition }
- Fallback: { "fallback_llm": true, "reason": "<why deterministic eval can't capture this>" }

Operators: == != > >= < <= contains starts_with ends_with matches in not_in exists is_empty

When to set fallback_llm: only when the rule's *semantics* genuinely require an LLM — e.g.
"matters that look urgent based on tone" or "anything that smells like a regulatory threat".
Concrete numeric thresholds and exact-match enums should ALWAYS compile to deterministic
conditions, never fallback_llm.

Be conservative about field names: only use fields explicitly listed in the kind hints. If
the attorney references a field that isn't available, set fallback_llm=true with a reason.

Examples (kind: sla):
- "High priority matters resolve in 24 hours"
  → { when: { field: "matter.priority", op: "==", value: "high" },
      then: { sla_hours: 24 }, fallback_llm: false }
- "Any privacy matter from EU customers gets 4 hours"
  → { when: { all: [
        { field: "matter.practice_area", op: "==", value: "privacy" },
        { field: "matter.counterparty_domain", op: "ends_with", value: ".eu" }
      ] }, then: { sla_hours: 4 }, fallback_llm: false }

Always return all required fields. Be precise about operator choice."""


COMPILE_TOOL = {
    "name": "submit_compiled_rule",
    "description": "Submit the compiled rule DSL.",
    "input_schema": {
        "type": "object",
        "properties": {
            "when": {
                "type": "object",
                "description": "Condition tree. See system prompt for grammar.",
            },
            "then": {
                "type": "object",
                "description": "Action — fields depend on rule kind.",
            },
            "fallback_llm": {"type": "boolean"},
            "fallback_reason": {"type": ["string", "null"]},
            "warnings": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Notes for the operator about edge cases or assumptions.",
            },
        },
        "required": ["when", "then", "fallback_llm", "fallback_reason", "warnings"],
    },
}


class CompileRuleRequest(BaseModel):
    rule_id: str
    kind: Literal["sla", "routing", "triage", "playbook_trigger"]
    natural_text: str = Field(min_length=1)
    scope: dict[str, Any] = {}


class CompileRuleResult(BaseModel):
    rule_id: str
    compiler_version: str = COMPILER_VERSION
    compiled: dict[str, Any]
    fallback_llm: bool
    fallback_reason: str | None = None
    warnings: list[str] = []
    error: str | None = None


def compile_rule(request: CompileRuleRequest) -> CompileRuleResult:
    client = get_client()
    field_hints = KIND_FIELD_HINTS[request.kind]
    user_prompt = (
        f"Rule kind: {request.kind}\n\n"
        f"{field_hints}\n"
        f"Scope: {json.dumps(request.scope) if request.scope else '(none)'}\n\n"
        f"Attorney's English rule:\n{request.natural_text}\n"
    )

    try:
        response = client.messages.create(  # type: ignore[call-overload]
            model=settings.anthropic_model,
            max_tokens=2048,
            system=[
                {
                    "type": "text",
                    "text": COMPILE_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[COMPILE_TOOL],
            tool_choice={"type": "tool", "name": "submit_compiled_rule"},
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as exc:
        logger.exception("compile_rule LLM call failed")
        return CompileRuleResult(
            rule_id=request.rule_id,
            compiled={},
            fallback_llm=True,
            fallback_reason="compiler unavailable",
            error=str(exc),
        )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        return CompileRuleResult(
            rule_id=request.rule_id,
            compiled={},
            fallback_llm=True,
            fallback_reason="compiler returned no tool_use block",
            error="missing tool_use",
        )
    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    compiled = {
        "when": payload["when"],
        "then": payload["then"],
        "fallback_llm": payload["fallback_llm"],
    }
    return CompileRuleResult(
        rule_id=request.rule_id,
        compiled=compiled,
        fallback_llm=payload["fallback_llm"],
        fallback_reason=payload.get("fallback_reason"),
        warnings=payload.get("warnings", []),
    )
