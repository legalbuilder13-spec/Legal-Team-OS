import hmac
import logging
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException

from .config import settings
from .context.salesforce import lookup_counterparty
from .schemas import ContextCard, ContextRequest, TriageRequest, TriageResult
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
