"""M1 — Rejection-reason clustering skill.

Takes a list of lawyer rejection reasons (each tied to a stage_name +
practice_area + matter context) and groups them into themed clusters.
Each cluster proposes a follow-up action: either a new playbook draft,
or a domain_config rule patch. 'none' means the cluster surfaces a
pattern but no automatic action is appropriate (e.g. one-off lawyer
preference, or pattern is too vague).

The model NEVER auto-creates the artifact. Output is a proposal that
an admin reviews in /admin/rejection-themes. The whole point of the
mining loop is to surface patterns lawyers wouldn't otherwise spot;
final action stays human-attributed for audit trail integrity.
"""

import json
import logging

from pydantic import BaseModel, Field

from .config import settings
from .llm.client import get_client

logger = logging.getLogger(__name__)


class RejectionInput(BaseModel):
    audit_log_id: str
    matter_id: str | None = None
    stage_name: str
    practice_area: str | None = None
    worker_confidence: str | None = None
    reason: str
    decided_at: str


class ClusterRejectionsRequest(BaseModel):
    organization_id: str | None = None
    rejections: list[RejectionInput]


class RepresentativeReason(BaseModel):
    audit_log_id: str
    matter_id: str | None = None
    reason: str
    worker_confidence: str | None = None
    decided_at: str


class ProposedPlaybookPayload(BaseModel):
    kind: str = "playbook"
    title: str
    body: str
    practice_area: str | None = None


class ProposedDomainConfigPayload(BaseModel):
    kind: str = "domain_config"
    patch_path: str  # e.g. 'verb_rules', 'terminology_rules'
    patch_value: dict | list  # JSON-serializable
    rationale: str


class Cluster(BaseModel):
    stage_name: str
    practice_area: str | None = None
    label: str = Field(min_length=3, max_length=120)
    summary: str = Field(min_length=10)
    member_audit_log_ids: list[str]
    representative_reasons: list[RepresentativeReason]
    proposal_target: str  # 'playbook' | 'domain_config' | 'none'
    proposed_payload: dict  # ProposedPlaybookPayload | ProposedDomainConfigPayload | {}


class ClusterRejectionsResult(BaseModel):
    organization_id: str | None = None
    rejection_count: int
    clusters: list[Cluster]


SYSTEM_PROMPT = """You are an analyst reviewing lawyer rejection reasons from an in-house legal team's \
pre-review analysis pipeline. Each rejection captures why a lawyer rejected (or escalated) an \
AI-produced stage output — statutory analysis, case-law research, or deconstruct/IRAC memo.

Your job is to GROUP rejections into themed clusters and propose follow-up actions. The output \
becomes a proposal queue for a human admin; you do not auto-create artifacts.

Clustering rules:
- Group rejections only when they share a recurring root cause, not surface similarity. Two \
rejections that both say "wrong jurisdiction" but for different practice areas are two clusters, \
not one. Two rejections that say "missed the materiality threshold" and "didn't catch the \$10M \
cap" are the same cluster.
- Each cluster must have ≥2 members. Singleton rejections are noise; drop them.
- Each cluster spans one stage_name + (optionally) one practice_area. Don't mix statutory and \
case-law rejections in one cluster.
- Cap clusters at ~8 total. If you'd produce more, drop the smallest.

For each cluster you produce:
- label: 3-10 word phrase. Examples: "Missed materiality threshold", "Wrong jurisdiction priority", \
"Statute citation but no operative-provision quote".
- summary: 1-2 sentence narrative explaining the root cause and why the skill keeps missing it.
- member_audit_log_ids: the audit_log_id values from the rejections in this cluster.
- representative_reasons: up to 5 of the verbatim rejection rows that best exemplify the cluster.

Then propose a follow-up action via proposal_target + proposed_payload:

1. proposal_target='playbook' when the cluster suggests there's a recurring fact pattern that \
deserves a hand-written playbook entry. proposed_payload = ProposedPlaybookPayload with:
- title: the playbook title (e.g. "California meal-break premium pay — non-exempt workers")
- body: a draft body the lawyer can edit. 3-6 short paragraphs covering: when this playbook \
applies, the controlling rule, the operative-fact triggers, and the mirror-image argument.
- practice_area: matched to the cluster's practice_area.

2. proposal_target='domain_config' when the cluster suggests an org-wide rule the AI keeps \
violating. proposed_payload = ProposedDomainConfigPayload with:
- patch_path: 'verb_rules', 'terminology_rules', 'high_scrutiny_jurisdictions', or \
'domain_risk_taxonomy'.
- patch_value: a JSON snippet matching the §15 domain_config shape (see context). Examples: \
{"prefer": "verifies", "avoid": "ensures"} for a verb_rules entry; \
{"name": "California", "applies_to_practice_areas": ["employment"]} for high_scrutiny_jurisdictions.
- rationale: 1 sentence explaining how the rejections justify this patch.

3. proposal_target='none' when the cluster is real but no automated artifact is appropriate \
(e.g. recurring preference variation across lawyers, or pattern is too vague to act on). \
proposed_payload = {}.

Be conservative. Bad proposals waste admin time and erode trust in the mining loop. A cluster \
with no clear action should use 'none'. A vague label that could mean anything is worse than \
no label — skip the cluster instead.

Domain config patch shape reference (the patch_value snippet's keys must match these EXACTLY \
or the patch will be rejected at validation time):
- verb_rules entry: {"prefer": "<verb>", "avoid": "<verb>", "context": "<short reason>"}
- terminology_rules entry: {"preferred": "<term>", "avoid": "<term>", "rationale": "<short reason>"}
- high_scrutiny_jurisdictions entry: {"jurisdiction": "<jurisdiction name>", \
"rationale": "<short reason>", "appliesToPracticeAreas": ["<practice_area>", ...]}
- domain_risk_taxonomy entry: {"categoryId": "<slug>", "label": "<human label>", \
"examplesFlag": ["<keyword>", ...], "defaultSeverity": "high"|"medium"|"low"}

patch_value can be a single object or an array of objects matching the shape above; the server \
will append every element to the existing list at patch_path."""


TOOL = {
    "name": "submit_clusters",
    "description": "Submit the rejection clusters and per-cluster follow-up proposals.",
    "input_schema": {
        "type": "object",
        "properties": {
            "clusters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "stage_name": {"type": "string"},
                        "practice_area": {"type": ["string", "null"]},
                        "label": {"type": "string", "minLength": 3, "maxLength": 120},
                        "summary": {"type": "string", "minLength": 10},
                        "member_audit_log_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "minItems": 2,
                        },
                        "representative_reasons": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "audit_log_id": {"type": "string"},
                                    "matter_id": {"type": ["string", "null"]},
                                    "reason": {"type": "string"},
                                    "worker_confidence": {"type": ["string", "null"]},
                                    "decided_at": {"type": "string"},
                                },
                                "required": [
                                    "audit_log_id",
                                    "matter_id",
                                    "reason",
                                    "worker_confidence",
                                    "decided_at",
                                ],
                            },
                            "minItems": 1,
                            "maxItems": 5,
                        },
                        "proposal_target": {
                            "type": "string",
                            "enum": ["playbook", "domain_config", "none"],
                        },
                        "proposed_payload": {"type": "object"},
                    },
                    "required": [
                        "stage_name",
                        "practice_area",
                        "label",
                        "summary",
                        "member_audit_log_ids",
                        "representative_reasons",
                        "proposal_target",
                        "proposed_payload",
                    ],
                },
            },
        },
        "required": ["clusters"],
    },
}


def _build_user_prompt(request: ClusterRejectionsRequest) -> str:
    parts: list[str] = [
        f"Organization: {request.organization_id or 'default'}",
        f"Total rejections to cluster: {len(request.rejections)}",
        "",
        "--- Rejection rows (audit_log) ---",
    ]
    for r in request.rejections:
        parts.append(
            f"[{r.audit_log_id}] stage={r.stage_name} "
            f"practice_area={r.practice_area or '-'} "
            f"confidence={r.worker_confidence or '-'} "
            f"decided_at={r.decided_at}"
        )
        parts.append(f"  reason: {r.reason}")
    return "\n".join(parts)


def cluster_rejections(request: ClusterRejectionsRequest) -> ClusterRejectionsResult:
    # Fast-path: no rejections, no clusters. No LLM call.
    if not request.rejections:
        return ClusterRejectionsResult(
            organization_id=request.organization_id,
            rejection_count=0,
            clusters=[],
        )

    # Fast-path: <2 rejections can't form a cluster.
    if len(request.rejections) < 2:
        return ClusterRejectionsResult(
            organization_id=request.organization_id,
            rejection_count=len(request.rejections),
            clusters=[],
        )

    client = get_client()
    response = client.messages.create(  # type: ignore[call-overload]
        model=settings.anthropic_model,
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[TOOL],
        tool_choice={"type": "tool", "name": "submit_clusters"},
        messages=[{"role": "user", "content": _build_user_prompt(request)}],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        logger.error(
            "cluster_rejections missing tool_use: id=%s stop_reason=%s",
            response.id,
            response.stop_reason,
        )
        raise RuntimeError("Cluster-rejections skill did not return a tool_use block")

    payload = tool_use.input
    if isinstance(payload, str):
        payload = json.loads(payload)

    raw_clusters = payload.get("clusters", [])
    clusters: list[Cluster] = []
    for c in raw_clusters:
        # Defensive: enforce the same gates the prompt asks for. If the
        # model returns a singleton or empty payload for a non-'none'
        # target, drop the cluster rather than write a low-quality row.
        if len(c.get("member_audit_log_ids", [])) < 2:
            continue
        target = c.get("proposal_target", "none")
        proposed = c.get("proposed_payload") or {}
        if target == "playbook" and not (proposed.get("title") and proposed.get("body")):
            target = "none"
            proposed = {}
        if target == "domain_config" and not (
            proposed.get("patch_path") and "patch_value" in proposed
        ):
            target = "none"
            proposed = {}
        clusters.append(
            Cluster(
                stage_name=c["stage_name"],
                practice_area=c.get("practice_area"),
                label=c["label"],
                summary=c["summary"],
                member_audit_log_ids=c["member_audit_log_ids"],
                representative_reasons=[
                    RepresentativeReason(**r) for r in c["representative_reasons"]
                ],
                proposal_target=target,
                proposed_payload=proposed,
            )
        )

    return ClusterRejectionsResult(
        organization_id=request.organization_id,
        rejection_count=len(request.rejections),
        clusters=clusters,
    )
