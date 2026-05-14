import hmac
import logging
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException

from .analyze_clause import AnalyzeClauseRequest, AnalyzeClauseResult, analyze_clause
from .analysis_schemas import (
    GuidanceGraderRequest,
    GuidanceGraderResult,
    ThresholdSpotterRequest,
    ThresholdSpotterResult,
)
from .compile_rule import CompileRuleRequest, CompileRuleResult, compile_rule
from .config import settings
from .context.salesforce import lookup_counterparty
from .enrich_counterparty import EnrichRequest, EnrichResult, enrich_counterparty
from .guidance_grader import grade_guidance
from .parse_document import ParseRequest, ParseResult, parse_document
from .schemas import ContextCard, ContextRequest, TriageRequest, TriageResult
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
