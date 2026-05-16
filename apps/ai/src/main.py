import hmac
import logging
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException

from .absence_spotter import (
    AbsenceSpotterRequest,
    AbsenceSpotterResult,
    spot_absences,
)
from .analysis_schemas import (
    GuidanceGraderRequest,
    GuidanceGraderResult,
    ThresholdSpotterRequest,
    ThresholdSpotterResult,
)
from .analyze_clause import AnalyzeClauseRequest, AnalyzeClauseResult, analyze_clause
from .case_law_research import CaseLawRequest, CaseLawResult, research_case_law
from .cluster_rejections import (
    ClusterRejectionsRequest,
    ClusterRejectionsResult,
    cluster_rejections,
)
from .compact_matter import (
    CompactMatterRequest,
    CompactMatterResult,
    compact_matter,
)
from .compile_rule import CompileRuleRequest, CompileRuleResult, compile_rule
from .config import settings
from .context.salesforce import lookup_counterparty
from .deconstruct_draft import (
    DeconstructRequest,
    DeconstructResult,
    deconstruct_and_draft,
)
from .enrich_counterparty import EnrichRequest, EnrichResult, enrich_counterparty
from .extract_playbook_edits import (
    ExtractPlaybookEditsRequest,
    ExtractPlaybookEditsResult,
    extract_playbook_edits,
)
from .extract_template_clauses import (
    ExtractClausesRequest,
    ExtractClausesResult,
    extract_template_clauses,
)
from .extract_terminology_diffs import (
    ExtractDiffsRequest,
    ExtractDiffsResult,
    extract_terminology_diffs,
)
from .guidance_grader import grade_guidance
from .parse_document import ParseRequest, ParseResult, parse_document
from .schemas import ContextCard, ContextRequest, TriageRequest, TriageResult
from .statute_analysis import (
    StatuteAnalysisRequest,
    StatuteAnalysisResult,
    analyze_statute,
)
from .threshold_spotter import spot_thresholds
from .triage import triage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Legal AI Service", version="0.1.0")

ALLOW_UNAUTHED = os.getenv("AI_SERVICE_ALLOW_UNAUTHED") == "1"


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    if settings.ai_service_token is None:
        if ALLOW_UNAUTHED:
            return
        raise HTTPException(
            status_code=500,
            detail="AI_SERVICE_TOKEN not configured. Set it or AI_SERVICE_ALLOW_UNAUTHED=1 for local dev.",
        )
    expected = f"Bearer {settings.ai_service_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/triage", response_model=TriageResult, dependencies=[Depends(require_token)])
def post_triage(request: TriageRequest) -> TriageResult:
    logger.info("triage request matter_id=%s", request.matter_id)
    return triage(request)


@app.post("/context", response_model=ContextCard | None, dependencies=[Depends(require_token)])
async def post_context(request: ContextRequest) -> ContextCard | None:
    logger.info("context request matter_id=%s", request.matter_id)
    return await lookup_counterparty(request.counterparty_name, request.counterparty_domain)


@app.post(
    "/enrich-counterparty",
    response_model=EnrichResult,
    dependencies=[Depends(require_token)],
)
def post_enrich_counterparty(request: EnrichRequest) -> EnrichResult:
    logger.info(
        "enrich request counterparty_id=%s name=%s matter_count=%d",
        request.counterparty_id,
        request.counterparty_name,
        len(request.matters),
    )
    return enrich_counterparty(request)


@app.post(
    "/parse-document",
    response_model=ParseResult,
    dependencies=[Depends(require_token)],
)
def post_parse_document(request: ParseRequest) -> ParseResult:
    logger.info(
        "parse request document_id=%s filename=%s mime=%s",
        request.document_id,
        request.filename,
        request.mime_type,
    )
    return parse_document(request)


@app.post(
    "/analyze-clause",
    response_model=AnalyzeClauseResult,
    dependencies=[Depends(require_token)],
)
def post_analyze_clause(request: AnalyzeClauseRequest) -> AnalyzeClauseResult:
    logger.info(
        "analyze_clause clause_id=%s positions=%d",
        request.clause_id,
        len(request.positions),
    )
    return analyze_clause(request)


@app.post(
    "/compile-rule",
    response_model=CompileRuleResult,
    dependencies=[Depends(require_token)],
)
def post_compile_rule(request: CompileRuleRequest) -> CompileRuleResult:
    logger.info(
        "compile_rule rule_id=%s kind=%s text_len=%d",
        request.rule_id,
        request.kind,
        len(request.natural_text),
    )
    return compile_rule(request)


@app.post(
    "/threshold-spotter",
    response_model=ThresholdSpotterResult,
    dependencies=[Depends(require_token)],
)
def post_threshold_spotter(request: ThresholdSpotterRequest) -> ThresholdSpotterResult:
    logger.info(
        "threshold_spotter matter_id=%s practice_area=%s items=%d",
        request.matter_id,
        request.practice_area,
        len(request.items),
    )
    return spot_thresholds(request)


@app.post(
    "/guidance-grader",
    response_model=GuidanceGraderResult,
    dependencies=[Depends(require_token)],
)
def post_guidance_grader(request: GuidanceGraderRequest) -> GuidanceGraderResult:
    logger.info(
        "guidance_grader matter_id=%s candidates=%d",
        request.matter_id,
        len(request.candidates),
    )
    return grade_guidance(request)


@app.post(
    "/absence-spotter",
    response_model=AbsenceSpotterResult,
    dependencies=[Depends(require_token)],
)
def post_absence_spotter(request: AbsenceSpotterRequest) -> AbsenceSpotterResult:
    # PR-6 — absence-detection skill. Sibling to threshold-spotter; runs
    # in parallel with Stage 1. See how-lawyers-think Part III §3 op 4.
    logger.info(
        "absence_spotter matter_id=%s practice_area=%s thresholds=%d",
        request.matter_id,
        request.practice_area,
        len(request.raised_thresholds),
    )
    return spot_absences(request)


@app.post(
    "/statute-analysis",
    response_model=StatuteAnalysisResult,
    dependencies=[Depends(require_token)],
)
def post_statute_analysis(request: StatuteAnalysisRequest) -> StatuteAnalysisResult:
    logger.info(
        "statute_analysis matter_id=%s jurisdiction=%s sources=%d",
        request.matter_id,
        request.jurisdiction,
        len(request.sources),
    )
    return analyze_statute(request)


@app.post(
    "/case-law-research",
    response_model=CaseLawResult,
    dependencies=[Depends(require_token)],
)
def post_case_law_research(request: CaseLawRequest) -> CaseLawResult:
    logger.info(
        "case_law_research matter_id=%s jurisdiction=%s candidates=%d",
        request.matter_id,
        request.jurisdiction,
        len(request.candidates),
    )
    return research_case_law(request)


@app.post(
    "/deconstruct",
    response_model=DeconstructResult,
    dependencies=[Depends(require_token)],
)
def post_deconstruct(request: DeconstructRequest) -> DeconstructResult:
    logger.info(
        "deconstruct matter_id=%s inventory_items=%d statutory=%s case_law=%s",
        request.matter_id,
        len(request.inventory_items),
        request.prior.statutory_summary is not None,
        request.prior.case_law_summary is not None,
    )
    return deconstruct_and_draft(request)


@app.post(
    "/cluster-rejections",
    response_model=ClusterRejectionsResult,
    dependencies=[Depends(require_token)],
)
def post_cluster_rejections(request: ClusterRejectionsRequest) -> ClusterRejectionsResult:
    logger.info(
        "cluster_rejections org=%s rejections=%d",
        request.organization_id or "default",
        len(request.rejections),
    )
    return cluster_rejections(request)


@app.post(
    "/compact-matter",
    response_model=CompactMatterResult,
    dependencies=[Depends(require_token)],
)
def post_compact_matter(request: CompactMatterRequest) -> CompactMatterResult:
    logger.info(
        "compact_matter matter=%s stages=%d sources=%d",
        request.matter_id,
        len(request.stages),
        len(request.sources),
    )
    return compact_matter(request)


@app.post(
    "/extract-terminology-diffs",
    response_model=ExtractDiffsResult,
    dependencies=[Depends(require_token)],
)
def post_extract_terminology_diffs(request: ExtractDiffsRequest) -> ExtractDiffsResult:
    logger.info(
        "extract_terminology_diffs org=%s revisions=%d",
        request.organization_id or "default",
        len(request.revisions),
    )
    return extract_terminology_diffs(request)


@app.post(
    "/extract-template-clauses",
    response_model=ExtractClausesResult,
    dependencies=[Depends(require_token)],
)
def post_extract_template_clauses(
    request: ExtractClausesRequest,
) -> ExtractClausesResult:
    logger.info(
        "extract_template_clauses template=%s practice=%s body_chars=%d",
        request.template_id,
        request.practice_area,
        len(request.body or ""),
    )
    return extract_template_clauses(request)


@app.post(
    "/extract-playbook-edits",
    response_model=ExtractPlaybookEditsResult,
    dependencies=[Depends(require_token)],
)
def post_extract_playbook_edits(
    request: ExtractPlaybookEditsRequest,
) -> ExtractPlaybookEditsResult:
    logger.info(
        "extract_playbook_edits proposals=%d total_evidence=%d",
        len(request.proposals),
        sum(len(p.evidence_matters) for p in request.proposals),
    )
    return extract_playbook_edits(request)
