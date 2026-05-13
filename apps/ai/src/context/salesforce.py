import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from ..config import settings
from ..schemas import ContextCard

logger = logging.getLogger(__name__)

_access_token: str | None = None


async def _get_access_token() -> str | None:
    global _access_token
    if _access_token:
        return _access_token
    if not all(
        [
            settings.salesforce_instance_url,
            settings.salesforce_client_id,
            settings.salesforce_client_secret,
            settings.salesforce_username,
            settings.salesforce_password,
        ]
    ):
        return None

    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.post(
            f"{settings.salesforce_instance_url}/services/oauth2/token",
            data={
                "grant_type": "password",
                "client_id": settings.salesforce_client_id,
                "client_secret": settings.salesforce_client_secret,
                "username": settings.salesforce_username,
                "password": settings.salesforce_password,
            },
        )
    if resp.status_code != 200:
        logger.error("salesforce auth failed: %s", resp.text)
        return None
    _access_token = resp.json()["access_token"]
    return _access_token


async def _query_soql(client: httpx.AsyncClient, token: str, soql: str) -> list[dict[str, Any]]:
    """Execute a SOQL query and return the records array (empty on failure)."""
    resp = await client.get(
        f"{settings.salesforce_instance_url}/services/data/v60.0/query",
        params={"q": soql},
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        logger.error("salesforce query failed (%s): %s", soql[:80], resp.text[:200])
        return []
    return resp.json().get("records", [])


async def _fetch_related(
    client: httpx.AsyncClient, token: str, account_id: str
) -> dict[str, Any]:
    """Pull opportunities, open cases, and recent contact activity for an account."""
    escaped = account_id.replace("'", "\\'")
    opps_soql = (
        "SELECT Id, Name, StageName, Amount, CloseDate, IsClosed, IsWon "
        f"FROM Opportunity WHERE AccountId = '{escaped}' "
        "ORDER BY CloseDate DESC LIMIT 5"
    )
    cases_soql = (
        "SELECT Id, CaseNumber, Subject, Status, Priority, CreatedDate "
        f"FROM Case WHERE AccountId = '{escaped}' AND IsClosed = false "
        "ORDER BY CreatedDate DESC LIMIT 5"
    )
    contacts_soql = (
        "SELECT Id, Name, Title, Email, LastActivityDate "
        f"FROM Contact WHERE AccountId = '{escaped}' "
        "ORDER BY LastActivityDate DESC NULLS LAST LIMIT 5"
    )
    opportunities = await _query_soql(client, token, opps_soql)
    cases = await _query_soql(client, token, cases_soql)
    contacts = await _query_soql(client, token, contacts_soql)
    return {
        "opportunities": opportunities,
        "open_cases": cases,
        "contacts": contacts,
    }


async def lookup_counterparty(name: str | None, domain: str | None) -> ContextCard | None:
    if not name and not domain:
        return None

    token = await _get_access_token()
    if not token or not settings.salesforce_instance_url:
        logger.info("Salesforce not configured, returning empty context")
        return ContextCard(
            source="salesforce",
            fetched_at=datetime.now(UTC).isoformat(),
            data={"configured": False, "name": name, "domain": domain},
        )

    where = []
    if name:
        escaped = name.replace("'", "\\'")
        where.append(f"Name LIKE '%{escaped}%'")
    if domain:
        escaped = domain.replace("'", "\\'")
        where.append(f"Website LIKE '%{escaped}%'")
    accounts_soql = (
        "SELECT Id, Name, Website, Owner.Name, Industry, AnnualRevenue "
        f"FROM Account WHERE {' OR '.join(where)} LIMIT 5"
    )

    async with httpx.AsyncClient(timeout=15.0) as http:
        records = await _query_soql(http, token, accounts_soql)
        # If exactly one account matched, pull related opportunities, cases,
        # and contacts. Multi-match ambiguity → skip enrichment (would be
        # misleading to attach related data when the account is uncertain).
        related: dict[str, Any] = {}
        if len(records) == 1 and records[0].get("Id"):
            related = await _fetch_related(http, token, records[0]["Id"])

    return ContextCard(
        source="salesforce",
        fetched_at=datetime.now(UTC).isoformat(),
        data={
            "records": records,
            "name": name,
            "domain": domain,
            **related,
        },
    )
