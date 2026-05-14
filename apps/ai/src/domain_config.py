"""PR12 §15 — domain-config shape + prompt-rendering helpers.

Mirrors packages/types/src/domain-config.ts. The worker passes a
domain_config dict to every skill request; this module gives the
skills a typed view + a helper that turns the config into a
prompt-ready text block, or an empty string when the config has no
content.
"""

from typing import Literal

from pydantic import BaseModel, Field


class TerminologyRule(BaseModel):
    preferred: str
    avoid: str
    rationale: str | None = None


class VerbRule(BaseModel):
    prefer: str
    avoid: str
    context: str | None = None


class HighScrutinyJurisdiction(BaseModel):
    jurisdiction: str
    rationale: str | None = None
    applies_to_practice_areas: list[str] = Field(default_factory=list)


class DomainRiskCategory(BaseModel):
    category_id: str
    label: str
    examples_flag: list[str] = Field(default_factory=list)
    default_severity: Literal["high", "medium", "low"]


class DomainConfig(BaseModel):
    factual_baseline_facts: list[str] = Field(default_factory=list)
    terminology_rules: list[TerminologyRule] = Field(default_factory=list)
    verb_rules: list[VerbRule] = Field(default_factory=list)
    high_scrutiny_jurisdictions: list[HighScrutinyJurisdiction] = Field(default_factory=list)
    domain_risk_taxonomy: list[DomainRiskCategory] = Field(default_factory=list)


def domain_config_block(cfg: DomainConfig | None) -> str:
    """Render the domain config as a prompt block.

    Returns an empty string when the config has no content — the
    skills can unconditionally append `domain_config_block(...)` to
    their user prompt without polluting the context window when the
    org hasn't customized anything.
    """
    if cfg is None:
        return ""
    has_content = (
        cfg.factual_baseline_facts
        or cfg.terminology_rules
        or cfg.verb_rules
        or cfg.high_scrutiny_jurisdictions
        or cfg.domain_risk_taxonomy
    )
    if not has_content:
        return ""

    parts: list[str] = ["", "--- Organization domain configuration (PRD §15) ---"]

    if cfg.factual_baseline_facts:
        parts.append("Factual baseline (standing facts about the organization):")
        for f in cfg.factual_baseline_facts:
            parts.append(f"  - {f}")

    if cfg.terminology_rules:
        parts.append("")
        parts.append("Terminology rules — use the preferred term; avoid the alternative:")
        for tr in cfg.terminology_rules:
            line = f"  prefer: {tr.preferred!r}  ·  avoid: {tr.avoid!r}"
            if tr.rationale:
                line += f"  ({tr.rationale})"
            parts.append(line)

    if cfg.verb_rules:
        parts.append("")
        parts.append(
            "Verb rules — when describing what the organization does, prefer the first verb; "
            "the second verb may create exposure or misframing:"
        )
        for vr in cfg.verb_rules:
            line = f"  prefer: {vr.prefer!r}  ·  avoid: {vr.avoid!r}"
            if vr.context:
                line += f"  ({vr.context})"
            parts.append(line)

    if cfg.high_scrutiny_jurisdictions:
        parts.append("")
        parts.append(
            "High-scrutiny jurisdictions — extra care for any analysis touching these:"
        )
        for j in cfg.high_scrutiny_jurisdictions:
            tail = ""
            if j.applies_to_practice_areas:
                tail = f"  [areas: {', '.join(j.applies_to_practice_areas)}]"
            parts.append(
                f"  - {j.jurisdiction}: {j.rationale or '(no rationale provided)'}{tail}"
            )

    if cfg.domain_risk_taxonomy:
        parts.append("")
        parts.append(
            "Domain risk taxonomy — every output should classify against these categories. "
            "Flag each as 'risk-flagged' or 'clear' explicitly; do not leave any blank:"
        )
        for c in cfg.domain_risk_taxonomy:
            parts.append(
                f"  - [{c.category_id}] {c.label}  (default severity: {c.default_severity})"
            )

    return "\n".join(parts)
