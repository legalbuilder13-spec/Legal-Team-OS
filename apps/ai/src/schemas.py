from typing import Literal

from pydantic import BaseModel, Field

PracticeArea = Literal[
    "commercial",
    "employment",
    "privacy",
    "litigation",
    "corporate",
    "regulatory",
    "ip",
    "real_estate",
    "other",
]

Priority = Literal["high", "medium", "low"]


class PlaybookContext(BaseModel):
    practice_area: str
    title: str
    body: str


class PriorMatter(BaseModel):
    title: str
    summary: str | None = None
    practice_area: str
    priority: str | None = None


class TriageRequest(BaseModel):
    matter_id: str
    request_text: str
    requester_email: str | None = None
    requester_name: str | None = None
    channel: Literal["slack", "web"]
    playbooks: list[PlaybookContext] = []
    prior_matters: list[PriorMatter] = []


class TriageResult(BaseModel):
    matter_id: str
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1)
    practice_area: PracticeArea
    priority: Priority
    counterparty_name: str | None = None
    reasoning: str


class ContextRequest(BaseModel):
    matter_id: str
    counterparty_name: str | None = None
    counterparty_domain: str | None = None


class ContextCard(BaseModel):
    source: Literal["salesforce", "slack_history", "manual"]
    fetched_at: str
    data: dict
